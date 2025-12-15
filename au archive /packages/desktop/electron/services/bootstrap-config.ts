/**
 * Bootstrap Config Service
 *
 * Stores configuration that must be read BEFORE the database is opened.
 * Uses a simple JSON file in the userData directory.
 *
 * This solves the chicken-egg problem: we cannot store the database path
 * inside the database itself.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface BootstrapConfig {
  databasePath?: string;
  version: number;
}

const CONFIG_VERSION = 1;
const CONFIG_FILENAME = 'bootstrap-config.json';

/**
 * Get the path to the bootstrap config file
 * Uses userData directory which is writable on all platforms
 */
function getConfigPath(): string {
  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  return path.join(userDataDir, CONFIG_FILENAME);
}

/**
 * Get default config values
 */
function getDefaultConfig(): BootstrapConfig {
  return {
    version: CONFIG_VERSION,
  };
}

/**
 * Read the bootstrap config from disk
 * Returns default config if file doesn't exist or is invalid
 */
export function readBootstrapConfig(): BootstrapConfig {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return getDefaultConfig();
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as BootstrapConfig;

    // Validate and migrate if needed
    if (!config.version) {
      config.version = CONFIG_VERSION;
    }

    return config;
  } catch (error) {
    console.error('Error reading bootstrap config, using defaults:', error);
    return getDefaultConfig();
  }
}

/**
 * Write the bootstrap config to disk
 */
export function writeBootstrapConfig(config: BootstrapConfig): void {
  const configPath = getConfigPath();

  try {
    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write atomically (write to temp file, then rename)
    const tempPath = configPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tempPath, configPath);

    console.log('Bootstrap config saved:', configPath);
  } catch (error) {
    console.error('Error writing bootstrap config:', error);
    throw error;
  }
}

/**
 * Get the custom database path from config
 * Returns undefined if using default location
 */
export function getCustomDatabasePath(): string | undefined {
  const config = readBootstrapConfig();
  return config.databasePath;
}

/**
 * Set a custom database path
 * Pass undefined to reset to default location
 */
export function setCustomDatabasePath(dbPath: string | undefined): void {
  const config = readBootstrapConfig();
  config.databasePath = dbPath;
  writeBootstrapConfig(config);
}

/**
 * Get the default database path
 * Uses userData directory which is writable on all platforms
 */
export function getDefaultDatabasePath(): string {
  const userDataDir = app.getPath('userData');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  return path.join(userDataDir, 'au-archive.db');
}

/**
 * Get the effective database path (custom or default)
 */
export function getEffectiveDatabasePath(): string {
  const customPath = getCustomDatabasePath();

  if (customPath) {
    // Ensure directory exists for custom path
    const dbDir = path.dirname(customPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    return customPath;
  }

  return getDefaultDatabasePath();
}
