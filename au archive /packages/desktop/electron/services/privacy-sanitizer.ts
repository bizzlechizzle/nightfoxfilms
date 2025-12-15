/**
 * Privacy Sanitizer Service
 *
 * Removes sensitive data from text before sending to cloud LLM providers.
 * Local providers (Ollama) receive unmodified text.
 *
 * Redaction targets:
 * - GPS coordinates (lat/lng pairs)
 * - Street addresses
 * - ZIP codes
 * - Phone numbers
 * - Email addresses (optional)
 *
 * @version 1.0
 * @see docs/plans/litellm-integration-plan.md - Phase 3
 */

import { getRawDatabase } from '../main/database';

// =============================================================================
// TYPES
// =============================================================================

export interface PrivacySettings {
  /** Master enable/disable for privacy sanitization */
  enabled: boolean;
  /** Redact GPS coordinates */
  redactGps: boolean;
  /** Redact street addresses */
  redactAddresses: boolean;
  /** Redact phone numbers */
  redactPhones: boolean;
  /** Redact email addresses */
  redactEmails: boolean;
  /** Location IDs to exclude from cloud processing entirely */
  excludedLocationIds: string[];
}

export interface SanitizationResult {
  /** Sanitized text */
  text: string;
  /** Number of redactions made */
  redactionCount: number;
  /** Types of data redacted */
  redactedTypes: string[];
}

// =============================================================================
// REGEX PATTERNS
// =============================================================================

/**
 * GPS coordinate patterns:
 * - Decimal degrees: 42.6526, -73.7562
 * - With optional spaces: 42.6526 , -73.7562
 * - Various precisions: 42.65, 42.652678
 */
const GPS_PATTERNS = [
  // Standard decimal degrees with comma separator
  /\b-?\d{1,3}\.\d{2,8},\s*-?\d{1,3}\.\d{2,8}\b/g,
  // Lat/Lng labels
  /\b(lat|latitude)[:\s]*-?\d{1,3}\.\d{2,8}/gi,
  /\b(lon|lng|longitude)[:\s]*-?\d{1,3}\.\d{2,8}/gi,
  // DMS format (degrees minutes seconds)
  /\b\d{1,3}°\s*\d{1,2}['′]\s*\d{1,2}(?:\.\d+)?["″]?\s*[NSEW]\b/gi,
];

/**
 * Street address patterns:
 * - House number + street name + type
 * - Various street suffixes
 */
const ADDRESS_PATTERNS = [
  // Standard US street address
  /\b\d{1,5}\s+(?:[NSEW]\.?\s+)?[\w\s]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Circle|Cir|Highway|Hwy|Route|Rt)\.?(?:\s+(?:Apt|Suite|Unit|#)\s*[\w\d-]+)?\b/gi,
  // PO Box
  /\bP\.?O\.?\s*Box\s+\d+\b/gi,
];

/**
 * ZIP code patterns:
 * - 5-digit: 12345
 * - 9-digit: 12345-6789
 */
const ZIPCODE_PATTERN = /\b\d{5}(?:-\d{4})?\b/g;

/**
 * Phone number patterns:
 * - (xxx) xxx-xxxx
 * - xxx-xxx-xxxx
 * - xxx.xxx.xxxx
 */
const PHONE_PATTERNS = [
  /\b\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g,
];

/**
 * Email pattern
 */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// =============================================================================
// SANITIZATION FUNCTIONS
// =============================================================================

/**
 * Sanitize text for cloud processing.
 * Removes sensitive data based on privacy settings.
 */
export function sanitizeForCloud(
  text: string,
  settings: PrivacySettings
): SanitizationResult {
  if (!settings.enabled) {
    return {
      text,
      redactionCount: 0,
      redactedTypes: [],
    };
  }

  let sanitized = text;
  let redactionCount = 0;
  const redactedTypes: string[] = [];

  // Redact GPS coordinates
  if (settings.redactGps) {
    for (const pattern of GPS_PATTERNS) {
      const matches = sanitized.match(pattern);
      if (matches) {
        redactionCount += matches.length;
        if (!redactedTypes.includes('GPS')) {
          redactedTypes.push('GPS');
        }
      }
      sanitized = sanitized.replace(pattern, '[GPS_REDACTED]');
    }
  }

  // Redact street addresses
  if (settings.redactAddresses) {
    for (const pattern of ADDRESS_PATTERNS) {
      const matches = sanitized.match(pattern);
      if (matches) {
        redactionCount += matches.length;
        if (!redactedTypes.includes('Address')) {
          redactedTypes.push('Address');
        }
      }
      sanitized = sanitized.replace(pattern, '[ADDRESS_REDACTED]');
    }

    // Redact ZIP codes
    const zipMatches = sanitized.match(ZIPCODE_PATTERN);
    if (zipMatches) {
      redactionCount += zipMatches.length;
      if (!redactedTypes.includes('ZIP')) {
        redactedTypes.push('ZIP');
      }
    }
    sanitized = sanitized.replace(ZIPCODE_PATTERN, '[ZIP_REDACTED]');
  }

  // Redact phone numbers
  if (settings.redactPhones) {
    for (const pattern of PHONE_PATTERNS) {
      const matches = sanitized.match(pattern);
      if (matches) {
        redactionCount += matches.length;
        if (!redactedTypes.includes('Phone')) {
          redactedTypes.push('Phone');
        }
      }
      sanitized = sanitized.replace(pattern, '[PHONE_REDACTED]');
    }
  }

  // Redact email addresses
  if (settings.redactEmails) {
    const emailMatches = sanitized.match(EMAIL_PATTERN);
    if (emailMatches) {
      redactionCount += emailMatches.length;
      if (!redactedTypes.includes('Email')) {
        redactedTypes.push('Email');
      }
    }
    sanitized = sanitized.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]');
  }

  return {
    text: sanitized,
    redactionCount,
    redactedTypes,
  };
}

/**
 * Check if a location is excluded from cloud processing.
 */
export function isLocationExcluded(
  locId: string,
  settings: PrivacySettings
): boolean {
  return settings.excludedLocationIds.includes(locId);
}

/**
 * Determine if a model is a cloud provider (requires sanitization).
 */
export function isCloudModel(modelName: string): boolean {
  const localPatterns = ['local', 'ollama', 'llama', 'qwen'];
  const lowerModel = modelName.toLowerCase();
  return !localPatterns.some((p) => lowerModel.includes(p));
}

// =============================================================================
// SETTINGS MANAGEMENT
// =============================================================================

/**
 * Get privacy settings from database.
 */
export async function getPrivacySettings(): Promise<PrivacySettings> {
  const db = getRawDatabase();

  const rows = db
    .prepare('SELECT key, value FROM litellm_settings WHERE key LIKE ?')
    .all('privacy_%') as { key: string; value: string }[];

  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    enabled: map.privacy_enabled !== 'false',
    redactGps: map.privacy_redact_gps !== 'false',
    redactAddresses: map.privacy_redact_addresses !== 'false',
    redactPhones: map.privacy_redact_phones === 'true',
    redactEmails: map.privacy_redact_emails === 'true',
    excludedLocationIds: JSON.parse(map.privacy_excluded_locations || '[]'),
  };
}

/**
 * Update privacy settings in database.
 */
export async function updatePrivacySettings(
  updates: Partial<PrivacySettings>
): Promise<void> {
  const db = getRawDatabase();
  const now = new Date().toISOString();

  const settingsMap: Record<string, string> = {};

  if (updates.enabled !== undefined) {
    settingsMap.privacy_enabled = String(updates.enabled);
  }
  if (updates.redactGps !== undefined) {
    settingsMap.privacy_redact_gps = String(updates.redactGps);
  }
  if (updates.redactAddresses !== undefined) {
    settingsMap.privacy_redact_addresses = String(updates.redactAddresses);
  }
  if (updates.redactPhones !== undefined) {
    settingsMap.privacy_redact_phones = String(updates.redactPhones);
  }
  if (updates.redactEmails !== undefined) {
    settingsMap.privacy_redact_emails = String(updates.redactEmails);
  }
  if (updates.excludedLocationIds !== undefined) {
    settingsMap.privacy_excluded_locations = JSON.stringify(
      updates.excludedLocationIds
    );
  }

  const stmt = db.prepare(`
    INSERT INTO litellm_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  for (const [key, value] of Object.entries(settingsMap)) {
    stmt.run(key, value, now);
  }
}

/**
 * Add a location to the exclusion list.
 */
export async function excludeLocation(locId: string): Promise<void> {
  const settings = await getPrivacySettings();
  if (!settings.excludedLocationIds.includes(locId)) {
    settings.excludedLocationIds.push(locId);
    await updatePrivacySettings({
      excludedLocationIds: settings.excludedLocationIds,
    });
  }
}

/**
 * Remove a location from the exclusion list.
 */
export async function includeLocation(locId: string): Promise<void> {
  const settings = await getPrivacySettings();
  const index = settings.excludedLocationIds.indexOf(locId);
  if (index !== -1) {
    settings.excludedLocationIds.splice(index, 1);
    await updatePrivacySettings({
      excludedLocationIds: settings.excludedLocationIds,
    });
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const PrivacySanitizer = {
  sanitize: sanitizeForCloud,
  isLocationExcluded,
  isCloudModel,
  getSettings: getPrivacySettings,
  updateSettings: updatePrivacySettings,
  excludeLocation,
  includeLocation,
};

export default PrivacySanitizer;
