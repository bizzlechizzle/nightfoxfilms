/**
 * BagIt Service - Self-Documenting Archive per RFC 8493
 *
 * Creates and maintains BagIt packages for each location so that
 * location folders can be understood 35+ years from now without the database.
 *
 * Per RFC 8493 (Library of Congress standard):
 * - bagit.txt: Version declaration
 * - bag-info.txt: Location metadata in key-value format
 * - manifest-sha256.txt: SHA256 checksums for all payload files
 * - tagmanifest-sha256.txt: SHA256 checksums for metadata files
 *
 * ADR-046: Files are stored in: [archive]/locations/[STATE]/[LOCID]/archive/
 * Sub-locations: [archive]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/archive/
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { LocationEntity } from '@au-archive/core';

// App version for Bag-Software-Agent field
const APP_VERSION = '0.1.0';

export type BagStatus = 'none' | 'valid' | 'complete' | 'incomplete' | 'invalid';

export interface BagValidationResult {
  status: BagStatus;
  error?: string;
  missingFiles?: string[];
  checksumErrors?: string[];
  payloadOxum?: { bytes: number; count: number };
}

export interface MediaFile {
  hash: string;
  path: string;
  type: 'image' | 'video' | 'document' | 'map';
  size: number;
}

/**
 * Location data needed for BagIt generation
 * ADR-046: Removed loc12/slocnam - use locid directly (16-char BLAKE3 hash)
 */
export interface BagLocation {
  locid: string;
  locnam: string;
  category?: string | null;
  access?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  address_county?: string | null;
  address_zipcode?: string | null;
  address_street?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  gps_source?: string | null;
  gps_verified_on_map?: number | null;
  gps_accuracy?: number | null;
  census_region?: string | null;
  census_division?: string | null;
  state_direction?: string | null;
  cultural_region?: string | null;
  notes?: string | null;
  locadd?: string | null; // Created date
  locup?: string | null;  // Updated date
}

/**
 * OPT-093: Sub-location data needed for BagIt generation
 * ADR-046: Each sub-location gets its own archive folder: sloc-[SUBID]/archive/
 */
export interface BagSubLocation {
  subid: string;
  subnam: string;
  ssubname?: string | null;
  category?: string | null;
  status?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  gps_source?: string | null;
  gps_verified_on_map?: number | null;
  gps_accuracy?: number | null;
  notes?: string | null;
  created_date?: string | null;
  modified_date?: string | null;
  // Parent location info (required for path construction)
  parentLocid: string;
  parentLocnam: string;
  parentCategory?: string | null;
  parentState?: string | null;
}

export class BagItService {
  constructor(private readonly archivePath: string) {}

  /**
   * Get the path to a location's archive folder
   * ADR-046: [archive]/locations/[STATE]/[LOCID]/archive/
   */
  getArchiveFolderPath(location: BagLocation): string {
    const state = (location.address_state || 'XX').toUpperCase();
    const locid = location.locid;

    return path.join(
      this.archivePath,
      'locations',
      state,
      locid,
      'archive'
    );
  }

  /**
   * Get the path to a location's root folder
   * ADR-046: [archive]/locations/[STATE]/[LOCID]/
   */
  getLocationFolderPath(location: BagLocation): string {
    const state = (location.address_state || 'XX').toUpperCase();
    const locid = location.locid;

    return path.join(
      this.archivePath,
      'locations',
      state,
      locid
    );
  }

  /**
   * Initialize a new BagIt package for a location
   * Called when a location is first created
   */
  async initializeBag(location: BagLocation): Promise<void> {
    const archiveDir = this.getArchiveFolderPath(location);

    // Create _archive directory
    await fs.mkdir(archiveDir, { recursive: true });

    // Generate all BagIt files
    await this.writeBagitTxt(archiveDir);
    await this.writeBagInfo(archiveDir, location, { bytes: 0, count: 0 });
    await this.writeManifest(archiveDir, []);
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Initialized bag for location: ${location.locnam} (${location.locid})`);
  }

  /**
   * Update bag-info.txt when location metadata changes
   * Does NOT update manifest (payload unchanged)
   */
  async updateBagInfo(location: BagLocation, mediaFiles: MediaFile[]): Promise<void> {
    const archiveDir = this.getArchiveFolderPath(location);

    // Ensure _archive directory exists
    await fs.mkdir(archiveDir, { recursive: true });

    // Calculate Payload-Oxum
    const payloadOxum = this.calculatePayloadOxum(mediaFiles);

    // Update bag-info.txt
    await this.writeBagInfo(archiveDir, location, payloadOxum);

    // Update tag manifest (bag-info.txt changed)
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Updated bag-info for location: ${location.locnam}`);
  }

  /**
   * Update manifest when files are added or removed
   * Called after media import or deletion
   */
  async updateManifest(location: BagLocation, mediaFiles: MediaFile[]): Promise<void> {
    const archiveDir = this.getArchiveFolderPath(location);

    // Ensure _archive directory exists
    await fs.mkdir(archiveDir, { recursive: true });

    // Ensure bagit.txt exists
    const bagitPath = path.join(archiveDir, 'bagit.txt');
    if (!fsSync.existsSync(bagitPath)) {
      await this.writeBagitTxt(archiveDir);
    }

    // Calculate Payload-Oxum
    const payloadOxum = this.calculatePayloadOxum(mediaFiles);

    // Update all files
    await this.writeBagInfo(archiveDir, location, payloadOxum);
    await this.writeManifest(archiveDir, mediaFiles);
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Updated manifest for location: ${location.locnam} (${mediaFiles.length} files)`);
  }

  /**
   * Regenerate all BagIt files from scratch
   * Called manually or after recovery
   */
  async regenerateBag(location: BagLocation, mediaFiles: MediaFile[]): Promise<void> {
    const archiveDir = this.getArchiveFolderPath(location);

    // Remove existing _archive folder if it exists
    try {
      await fs.rm(archiveDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }

    // Create fresh
    await fs.mkdir(archiveDir, { recursive: true });

    // Calculate Payload-Oxum
    const payloadOxum = this.calculatePayloadOxum(mediaFiles);

    // Generate all files
    await this.writeBagitTxt(archiveDir);
    await this.writeBagInfo(archiveDir, location, payloadOxum);
    await this.writeManifest(archiveDir, mediaFiles);
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Regenerated bag for location: ${location.locnam}`);
  }

  /**
   * Validate a BagIt package
   * Returns status and any errors found
   */
  async validateBag(location: BagLocation, mediaFiles: MediaFile[]): Promise<BagValidationResult> {
    const archiveDir = this.getArchiveFolderPath(location);

    // Check if _archive folder exists
    if (!fsSync.existsSync(archiveDir)) {
      return { status: 'none' };
    }

    // Check required files exist
    const requiredFiles = ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt'];
    const missingFiles: string[] = [];

    for (const file of requiredFiles) {
      if (!fsSync.existsSync(path.join(archiveDir, file))) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length > 0) {
      return {
        status: 'incomplete',
        error: `Missing required files: ${missingFiles.join(', ')}`,
        missingFiles,
      };
    }

    // Quick check: Payload-Oxum
    try {
      const bagInfoContent = await fs.readFile(path.join(archiveDir, 'bag-info.txt'), 'utf-8');
      const oxumMatch = bagInfoContent.match(/Payload-Oxum:\s*(\d+)\.(\d+)/);

      if (oxumMatch) {
        const expectedBytes = parseInt(oxumMatch[1], 10);
        const expectedCount = parseInt(oxumMatch[2], 10);
        const actual = this.calculatePayloadOxum(mediaFiles);

        if (actual.count !== expectedCount) {
          return {
            status: 'incomplete',
            error: `File count mismatch: expected ${expectedCount}, found ${actual.count}`,
            payloadOxum: actual,
          };
        }

        if (Math.abs(actual.bytes - expectedBytes) > 1024) {
          // Allow 1KB tolerance for rounding
          return {
            status: 'incomplete',
            error: `Payload size mismatch: expected ${expectedBytes}, found ${actual.bytes}`,
            payloadOxum: actual,
          };
        }
      }
    } catch {
      // Continue with full validation if quick check fails
    }

    // Full validation: Check all checksums in manifest
    const checksumErrors: string[] = [];

    try {
      const manifestContent = await fs.readFile(path.join(archiveDir, 'manifest-sha256.txt'), 'utf-8');
      const lines = manifestContent.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (!match) continue;

        const expectedHash = match[1];
        const relativePath = match[2];

        // Resolve relative path from _archive folder
        const absolutePath = path.resolve(archiveDir, relativePath);

        // Check file exists
        if (!fsSync.existsSync(absolutePath)) {
          checksumErrors.push(`Missing: ${relativePath}`);
          continue;
        }

        // Verify checksum (files are named by hash, so we can check filename)
        const filename = path.basename(absolutePath);
        const filenameHash = filename.replace(/\.[^.]+$/, ''); // Remove extension

        if (filenameHash !== expectedHash) {
          checksumErrors.push(`Hash mismatch: ${relativePath}`);
        }
      }
    } catch (err) {
      return {
        status: 'invalid',
        error: `Failed to read manifest: ${err}`,
      };
    }

    if (checksumErrors.length > 0) {
      return {
        status: 'invalid',
        error: `Checksum errors found`,
        checksumErrors,
      };
    }

    return {
      status: 'valid',
      payloadOxum: this.calculatePayloadOxum(mediaFiles),
    };
  }

  /**
   * Quick validation using Payload-Oxum only
   * Faster than full validation, good for scheduled checks
   */
  async quickValidate(location: BagLocation, mediaFiles: MediaFile[]): Promise<BagValidationResult> {
    const archiveDir = this.getArchiveFolderPath(location);

    // Check if _archive folder exists
    if (!fsSync.existsSync(archiveDir)) {
      return { status: 'none' };
    }

    // Check bag-info.txt exists
    const bagInfoPath = path.join(archiveDir, 'bag-info.txt');
    if (!fsSync.existsSync(bagInfoPath)) {
      return { status: 'incomplete', error: 'Missing bag-info.txt' };
    }

    try {
      const bagInfoContent = await fs.readFile(bagInfoPath, 'utf-8');
      const oxumMatch = bagInfoContent.match(/Payload-Oxum:\s*(\d+)\.(\d+)/);

      if (!oxumMatch) {
        return { status: 'complete' }; // No Payload-Oxum, can't quick validate
      }

      const expectedBytes = parseInt(oxumMatch[1], 10);
      const expectedCount = parseInt(oxumMatch[2], 10);
      const actual = this.calculatePayloadOxum(mediaFiles);

      if (actual.count !== expectedCount || Math.abs(actual.bytes - expectedBytes) > 1024) {
        return {
          status: 'incomplete',
          error: `Payload mismatch: expected ${expectedCount} files (${expectedBytes} bytes), found ${actual.count} files (${actual.bytes} bytes)`,
          payloadOxum: actual,
        };
      }

      return { status: 'valid', payloadOxum: actual };
    } catch (err) {
      return { status: 'invalid', error: `Failed to read bag-info: ${err}` };
    }
  }

  // ============ Sub-Location Methods (OPT-093 + ADR-046) ============

  /**
   * Get the path to a sub-location's archive folder
   * ADR-046: [archive]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/archive/
   */
  getSubLocationArchiveFolderPath(subLocation: BagSubLocation): string {
    const state = (subLocation.parentState || 'XX').toUpperCase();
    const locid = subLocation.parentLocid;
    const subid = subLocation.subid;

    return path.join(
      this.archivePath,
      'locations',
      state,
      locid,
      'data',
      `sloc-${subid}`,
      'archive'
    );
  }

  /**
   * Initialize a new BagIt package for a sub-location
   * OPT-093: Called when media is first imported to a sub-location
   */
  async initializeSubLocationBag(subLocation: BagSubLocation): Promise<void> {
    const archiveDir = this.getSubLocationArchiveFolderPath(subLocation);

    // Create archive directory
    await fs.mkdir(archiveDir, { recursive: true });

    // Generate all BagIt files
    await this.writeBagitTxt(archiveDir);
    await this.writeSubLocationBagInfo(archiveDir, subLocation, { bytes: 0, count: 0 });
    await this.writeManifest(archiveDir, []);
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Initialized bag for sub-location: ${subLocation.subnam} (${subLocation.subid})`);
  }

  /**
   * Update manifest when files are added or removed from a sub-location
   * OPT-093: Called after media import or deletion
   */
  async updateSubLocationManifest(subLocation: BagSubLocation, mediaFiles: MediaFile[]): Promise<void> {
    const archiveDir = this.getSubLocationArchiveFolderPath(subLocation);

    // Ensure archive directory exists
    await fs.mkdir(archiveDir, { recursive: true });

    // Ensure bagit.txt exists
    const bagitPath = path.join(archiveDir, 'bagit.txt');
    if (!fsSync.existsSync(bagitPath)) {
      await this.writeBagitTxt(archiveDir);
    }

    // Calculate Payload-Oxum
    const payloadOxum = this.calculatePayloadOxum(mediaFiles);

    // Update all files
    await this.writeSubLocationBagInfo(archiveDir, subLocation, payloadOxum);
    await this.writeManifest(archiveDir, mediaFiles);
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Updated manifest for sub-location: ${subLocation.subnam} (${mediaFiles.length} files)`);
  }

  /**
   * Regenerate all BagIt files for a sub-location from scratch
   * OPT-093: Called manually or after recovery
   */
  async regenerateSubLocationBag(subLocation: BagSubLocation, mediaFiles: MediaFile[]): Promise<void> {
    const archiveDir = this.getSubLocationArchiveFolderPath(subLocation);

    // Remove existing _archive-{sub12} folder if it exists
    try {
      await fs.rm(archiveDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }

    // Create fresh
    await fs.mkdir(archiveDir, { recursive: true });

    // Calculate Payload-Oxum
    const payloadOxum = this.calculatePayloadOxum(mediaFiles);

    // Generate all files
    await this.writeBagitTxt(archiveDir);
    await this.writeSubLocationBagInfo(archiveDir, subLocation, payloadOxum);
    await this.writeManifest(archiveDir, mediaFiles);
    await this.writeTagManifest(archiveDir);

    console.log(`[BagIt] Regenerated bag for sub-location: ${subLocation.subnam}`);
  }

  /**
   * Validate a sub-location's BagIt package
   * OPT-093: Returns status and any errors found
   */
  async validateSubLocationBag(subLocation: BagSubLocation, mediaFiles: MediaFile[]): Promise<BagValidationResult> {
    const archiveDir = this.getSubLocationArchiveFolderPath(subLocation);

    // Check if _archive-{sub12} folder exists
    if (!fsSync.existsSync(archiveDir)) {
      return { status: 'none' };
    }

    // Delegate to shared validation logic
    return this.validateBagAtPath(archiveDir, mediaFiles);
  }

  /**
   * Quick validation for a sub-location using Payload-Oxum only
   * OPT-093: Faster than full validation
   */
  async quickValidateSubLocation(subLocation: BagSubLocation, mediaFiles: MediaFile[]): Promise<BagValidationResult> {
    const archiveDir = this.getSubLocationArchiveFolderPath(subLocation);

    // Check if _archive-{sub12} folder exists
    if (!fsSync.existsSync(archiveDir)) {
      return { status: 'none' };
    }

    // Check bag-info.txt exists
    const bagInfoPath = path.join(archiveDir, 'bag-info.txt');
    if (!fsSync.existsSync(bagInfoPath)) {
      return { status: 'incomplete', error: 'Missing bag-info.txt' };
    }

    try {
      const bagInfoContent = await fs.readFile(bagInfoPath, 'utf-8');
      const oxumMatch = bagInfoContent.match(/Payload-Oxum:\s*(\d+)\.(\d+)/);

      if (!oxumMatch) {
        return { status: 'complete' }; // No Payload-Oxum, can't quick validate
      }

      const expectedBytes = parseInt(oxumMatch[1], 10);
      const expectedCount = parseInt(oxumMatch[2], 10);
      const actual = this.calculatePayloadOxum(mediaFiles);

      if (actual.count !== expectedCount || Math.abs(actual.bytes - expectedBytes) > 1024) {
        return {
          status: 'incomplete',
          error: `Payload mismatch: expected ${expectedCount} files (${expectedBytes} bytes), found ${actual.count} files (${actual.bytes} bytes)`,
          payloadOxum: actual,
        };
      }

      return { status: 'valid', payloadOxum: actual };
    } catch (err) {
      return { status: 'invalid', error: `Failed to read bag-info: ${err}` };
    }
  }

  /**
   * Write bag-info.txt for a sub-location
   * OPT-093: Sub-location specific metadata
   */
  private async writeSubLocationBagInfo(
    archiveDir: string,
    subLocation: BagSubLocation,
    payloadOxum: { bytes: number; count: number }
  ): Promise<void> {
    const now = new Date().toISOString();
    const baggingDate = now.split('T')[0]; // YYYY-MM-DD

    // ADR-046: Use subid/parentLocid (16-char BLAKE3 hashes) instead of sub12/parentLoc12
    const lines: string[] = [
      `Source-Organization: Abandoned Archive`,
      `Bagging-Date: ${baggingDate}`,
      `Bag-Software-Agent: Abandoned Archive v${APP_VERSION}`,
      `External-Identifier: ${subLocation.subid}`,
      `External-Description: ${subLocation.subnam}`,
      `Bag-Type: Sub-Location`,
      `Parent-Location-ID: ${subLocation.parentLocid}`,
      `Parent-Location-Name: ${subLocation.parentLocnam}`,
    ];

    // Sub-location metadata (optional fields)
    if (subLocation.category) lines.push(`SubLocation-Category: ${subLocation.category}`);
    if (subLocation.status) lines.push(`SubLocation-Status: ${subLocation.status}`);

    // GPS (sub-location may have its own GPS coordinates)
    if (subLocation.gps_lat !== null && subLocation.gps_lat !== undefined) {
      lines.push(`GPS-Latitude: ${subLocation.gps_lat.toFixed(6)}`);
    }
    if (subLocation.gps_lng !== null && subLocation.gps_lng !== undefined) {
      lines.push(`GPS-Longitude: ${subLocation.gps_lng.toFixed(6)}`);
    }
    if (subLocation.gps_source) lines.push(`GPS-Source: ${subLocation.gps_source}`);
    if (subLocation.gps_verified_on_map !== null && subLocation.gps_verified_on_map !== undefined) {
      lines.push(`GPS-Verified-On-Map: ${subLocation.gps_verified_on_map ? 'true' : 'false'}`);
    }
    if (subLocation.gps_accuracy !== null && subLocation.gps_accuracy !== undefined) {
      lines.push(`GPS-Accuracy-Meters: ${subLocation.gps_accuracy}`);
    }

    // Payload info
    lines.push(`Payload-Oxum: ${payloadOxum.bytes}.${payloadOxum.count}`);
    lines.push(`Bag-Count: 1 of 1`);

    // Notes (multi-line safe)
    if (subLocation.notes) {
      const escapedNotes = subLocation.notes.replace(/\n/g, ' ').substring(0, 1000);
      lines.push(`Internal-Sender-Description: ${escapedNotes}`);
    }

    const content = lines.join('\n') + '\n';
    await this.atomicWrite(path.join(archiveDir, 'bag-info.txt'), content);
  }

  /**
   * Shared validation logic for a BagIt package at a specific path
   * Used by both location and sub-location validation
   */
  private async validateBagAtPath(archiveDir: string, mediaFiles: MediaFile[]): Promise<BagValidationResult> {
    // Check required files exist
    const requiredFiles = ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt'];
    const missingFiles: string[] = [];

    for (const file of requiredFiles) {
      if (!fsSync.existsSync(path.join(archiveDir, file))) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length > 0) {
      return {
        status: 'incomplete',
        error: `Missing required files: ${missingFiles.join(', ')}`,
        missingFiles,
      };
    }

    // Quick check: Payload-Oxum
    try {
      const bagInfoContent = await fs.readFile(path.join(archiveDir, 'bag-info.txt'), 'utf-8');
      const oxumMatch = bagInfoContent.match(/Payload-Oxum:\s*(\d+)\.(\d+)/);

      if (oxumMatch) {
        const expectedBytes = parseInt(oxumMatch[1], 10);
        const expectedCount = parseInt(oxumMatch[2], 10);
        const actual = this.calculatePayloadOxum(mediaFiles);

        if (actual.count !== expectedCount) {
          return {
            status: 'incomplete',
            error: `File count mismatch: expected ${expectedCount}, found ${actual.count}`,
            payloadOxum: actual,
          };
        }

        if (Math.abs(actual.bytes - expectedBytes) > 1024) {
          return {
            status: 'incomplete',
            error: `Payload size mismatch: expected ${expectedBytes}, found ${actual.bytes}`,
            payloadOxum: actual,
          };
        }
      }
    } catch {
      // Continue with full validation if quick check fails
    }

    // Full validation: Check all checksums in manifest
    const checksumErrors: string[] = [];

    try {
      const manifestContent = await fs.readFile(path.join(archiveDir, 'manifest-sha256.txt'), 'utf-8');
      const lines = manifestContent.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (!match) continue;

        const expectedHash = match[1];
        const relativePath = match[2];

        // Resolve relative path from _archive folder
        const absolutePath = path.resolve(archiveDir, relativePath);

        // Check file exists
        if (!fsSync.existsSync(absolutePath)) {
          checksumErrors.push(`Missing: ${relativePath}`);
          continue;
        }

        // Verify checksum (files are named by hash, so we can check filename)
        const filename = path.basename(absolutePath);
        const filenameHash = filename.replace(/\.[^.]+$/, ''); // Remove extension

        if (filenameHash !== expectedHash) {
          checksumErrors.push(`Hash mismatch: ${relativePath}`);
        }
      }
    } catch (err) {
      return {
        status: 'invalid',
        error: `Failed to read manifest: ${err}`,
      };
    }

    if (checksumErrors.length > 0) {
      return {
        status: 'invalid',
        error: `Checksum errors found`,
        checksumErrors,
      };
    }

    return {
      status: 'valid',
      payloadOxum: this.calculatePayloadOxum(mediaFiles),
    };
  }

  // ============ Private Methods ============

  /**
   * Write bagit.txt - BagIt version declaration
   */
  private async writeBagitTxt(archiveDir: string): Promise<void> {
    const content = `BagIt-Version: 1.0
Tag-File-Character-Encoding: UTF-8
`;
    await this.atomicWrite(path.join(archiveDir, 'bagit.txt'), content);
  }

  /**
   * Write bag-info.txt - Location metadata
   */
  private async writeBagInfo(
    archiveDir: string,
    location: BagLocation,
    payloadOxum: { bytes: number; count: number }
  ): Promise<void> {
    const now = new Date().toISOString();
    const baggingDate = now.split('T')[0]; // YYYY-MM-DD

    // ADR-046: Use locid (16-char BLAKE3 hash) instead of loc12
    const lines: string[] = [
      `Source-Organization: Abandoned Archive`,
      `Bagging-Date: ${baggingDate}`,
      `Bag-Software-Agent: Abandoned Archive v${APP_VERSION}`,
      `External-Identifier: ${location.locid}`,
      `External-Description: ${location.locnam}`,
    ];

    // Location metadata (optional fields)
    if (location.category) lines.push(`Location-Category: ${location.category}`);
    if (location.access) lines.push(`Location-Access-Status: ${location.access}`);
    if (location.address_state) lines.push(`Location-State: ${location.address_state}`);
    if (location.address_city) lines.push(`Location-City: ${location.address_city}`);
    if (location.address_county) lines.push(`Location-County: ${location.address_county}`);
    if (location.address_zipcode) lines.push(`Location-Zipcode: ${location.address_zipcode}`);
    if (location.address_street) lines.push(`Location-Street: ${location.address_street}`);

    // GPS
    if (location.gps_lat !== null && location.gps_lat !== undefined) {
      lines.push(`GPS-Latitude: ${location.gps_lat.toFixed(6)}`);
    }
    if (location.gps_lng !== null && location.gps_lng !== undefined) {
      lines.push(`GPS-Longitude: ${location.gps_lng.toFixed(6)}`);
    }
    if (location.gps_source) lines.push(`GPS-Source: ${location.gps_source}`);
    if (location.gps_verified_on_map !== null && location.gps_verified_on_map !== undefined) {
      lines.push(`GPS-Verified-On-Map: ${location.gps_verified_on_map ? 'true' : 'false'}`);
    }
    if (location.gps_accuracy !== null && location.gps_accuracy !== undefined) {
      lines.push(`GPS-Accuracy-Meters: ${location.gps_accuracy}`);
    }

    // Regions
    if (location.census_region) lines.push(`Region-Census: ${location.census_region}`);
    if (location.census_division) lines.push(`Region-Division: ${location.census_division}`);
    if (location.state_direction) lines.push(`Region-State-Direction: ${location.state_direction}`);
    if (location.cultural_region) lines.push(`Region-Cultural: ${location.cultural_region}`);

    // Payload info
    lines.push(`Payload-Oxum: ${payloadOxum.bytes}.${payloadOxum.count}`);
    lines.push(`Bag-Count: 1 of 1`);

    // Notes (multi-line safe)
    if (location.notes) {
      // Escape newlines for bag-info.txt format
      const escapedNotes = location.notes.replace(/\n/g, ' ').substring(0, 1000);
      lines.push(`Internal-Sender-Description: ${escapedNotes}`);
    }

    const content = lines.join('\n') + '\n';
    await this.atomicWrite(path.join(archiveDir, 'bag-info.txt'), content);
  }

  /**
   * Write manifest-sha256.txt - Payload file checksums
   */
  private async writeManifest(archiveDir: string, mediaFiles: MediaFile[]): Promise<void> {
    const lines: string[] = [];

    for (const file of mediaFiles) {
      // Path relative to _archive folder
      const relativePath = path.relative(archiveDir, file.path);
      lines.push(`${file.hash}  ${relativePath}`);
    }

    // Sort for deterministic output
    lines.sort();

    const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    await this.atomicWrite(path.join(archiveDir, 'manifest-sha256.txt'), content);
  }

  /**
   * Write tagmanifest-sha256.txt - Checksums of metadata files
   */
  private async writeTagManifest(archiveDir: string): Promise<void> {
    const files = ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt'];
    const lines: string[] = [];

    for (const file of files) {
      const filePath = path.join(archiveDir, file);
      if (fsSync.existsSync(filePath)) {
        const hash = await this.calculateFileHash(filePath);
        lines.push(`${hash}  ${file}`);
      }
    }

    const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    await this.atomicWrite(path.join(archiveDir, 'tagmanifest-sha256.txt'), content);
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fsSync.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Calculate Payload-Oxum (total bytes and file count)
   */
  private calculatePayloadOxum(mediaFiles: MediaFile[]): { bytes: number; count: number } {
    let bytes = 0;
    for (const file of mediaFiles) {
      bytes += file.size;
    }
    return { bytes, count: mediaFiles.length };
  }

  /**
   * Atomic write - write to temp file then rename
   * Prevents corruption from interrupted writes
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;

    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (err) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  /**
   * Sanitize folder name for filesystem
   */
  private sanitizeFolderName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Generate short name from location name
   * Same logic as LocationEntity.generateShortName
   */
  private generateShortName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 30);
  }
}
