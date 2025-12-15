import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getConfigService } from './config-service';

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

// Default logging configuration (used before config is loaded)
const DEFAULT_LOG_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_FILES: 7,
};

/**
 * Structured logging service with automatic rotation
 * Keeps last N days, max configurable MB per file
 */
export class Logger {
  private logDir: string;
  private currentLogFile: string;

  private getLogConfig() {
    try {
      const config = getConfigService().get();
      return {
        MAX_FILE_SIZE: config.logging.maxFileSizeMB * 1024 * 1024,
        MAX_FILES: config.logging.maxFiles,
      };
    } catch {
      // Config not loaded yet, use defaults
      return DEFAULT_LOG_CONFIG;
    }
  }

  constructor() {
    // Always use userData for logs - it's a safe, writable location on all platforms
    // In development, this is ~/Library/Application Support/Electron (or similar)
    // In production, this is ~/Library/Application Support/Abandoned Archive
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.currentLogFile = path.join(this.logDir, 'au-archive.log');
    this.ensureLogDirectory();
    // Don't rotate in constructor - config may not be loaded yet
    // Rotation will happen on first write if needed
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.currentLogFile)) {
        return;
      }

      const { MAX_FILE_SIZE } = this.getLogConfig();
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size >= MAX_FILE_SIZE) {
        this.rotate();
      }

      this.cleanOldLogs();
    } catch (error) {
      console.error('Error rotating logs:', error);
    }
  }

  private rotate(): void {
    const { MAX_FILES } = this.getLogConfig();

    // Shift existing rotated logs
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const oldFile = path.join(this.logDir, `au-archive.log.${i}`);
      const newFile = path.join(this.logDir, `au-archive.log.${i + 1}`);

      if (fs.existsSync(oldFile)) {
        if (i === MAX_FILES - 1) {
          fs.unlinkSync(oldFile); // Delete oldest
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }

    // Rotate current log
    const rotatedFile = path.join(this.logDir, 'au-archive.log.1');
    if (fs.existsSync(this.currentLogFile)) {
      fs.renameSync(this.currentLogFile, rotatedFile);
    }
  }

  private cleanOldLogs(): void {
    const { MAX_FILES } = this.getLogConfig();

    const files = fs.readdirSync(this.logDir);
    const logFiles = files
      .filter((f) => f.startsWith('au-archive.log'))
      .map((f) => ({
        name: f,
        path: path.join(this.logDir, f),
        mtime: fs.statSync(path.join(this.logDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Keep only MAX_FILES + 1 (current + rotated)
    for (let i = MAX_FILES; i < logFiles.length; i++) {
      try {
        fs.unlinkSync(logFiles[i].path);
      } catch (error) {
        console.error('Error deleting old log:', error);
      }
    }
  }

  private writeLog(entry: LogEntry): void {
    try {
      this.rotateIfNeeded();

      const logLine =
        `[${entry.timestamp}] [${entry.level}] [${entry.component}] ${entry.message}` +
        (entry.context ? ` ${JSON.stringify(entry.context)}` : '') +
        (entry.stack ? `\n${entry.stack}` : '') +
        '\n';

      fs.appendFileSync(this.currentLogFile, logLine, 'utf-8');
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  error(component: string, message: string, error?: Error, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      component,
      message,
      context,
      stack: error?.stack,
    };
    this.writeLog(entry);
    console.error(`[${component}] ${message}`, error);
  }

  warn(component: string, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      component,
      message,
      context,
    };
    this.writeLog(entry);
    console.warn(`[${component}] ${message}`, context);
  }

  info(component: string, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      component,
      message,
      context,
    };
    this.writeLog(entry);
    console.log(`[${component}] ${message}`, context);
  }

  debug(component: string, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      component,
      message,
      context,
    };
    this.writeLog(entry);
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[${component}] ${message}`, context);
    }
  }

  getRecentLogs(count: number = 100): LogEntry[] {
    try {
      if (!fs.existsSync(this.currentLogFile)) {
        return [];
      }

      const content = fs.readFileSync(this.currentLogFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const recentLines = lines.slice(-count);

      return recentLines
        .map((line) => {
          try {
            const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (.+)$/);
            if (!match) return null;

            const [, timestamp, level, component, rest] = match;
            let message = rest;
            let context: Record<string, unknown> | undefined;

            // Try to extract JSON context
            const contextMatch = rest.match(/^(.+?) (\{.+\})$/);
            if (contextMatch) {
              message = contextMatch[1];
              try {
                context = JSON.parse(contextMatch[2]);
              } catch {
                // Invalid JSON, treat as part of message
              }
            }

            const entry: LogEntry = {
              timestamp,
              level: level as LogLevel,
              component,
              message,
            };
            if (context) {
              entry.context = context;
            }
            return entry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is LogEntry => entry !== null);
    } catch (error) {
      console.error('Error reading logs:', error);
      return [];
    }
  }

  getLogFilePath(): string {
    return this.currentLogFile;
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}
