/**
 * IPC Handlers for Reference Maps
 * Handles importing, listing, and deleting reference map files.
 */

import { ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { SqliteRefMapsRepository } from '../../repositories/sqlite-ref-maps-repository';
import { parseMapFile, getSupportedExtensions, isSupportedMapFile } from '../../services/map-parser-service';
import { RefMapMatcherService } from '../../services/ref-map-matcher-service';
import { RefMapDedupService, type DuplicateMatch, type DedupeResult } from '../../services/ref-map-dedup-service';
// Migration 42: Add geocoding and region services for GPS enrichment
import { GeocodingService } from '../../services/geocoding-service';
import { calculateRegionFields } from '../../services/region-service';
import { AddressNormalizer } from '../../services/address-normalizer';
// Centralized enrichment service - THE canonical way to enrich locations from GPS
import { LocationEnrichmentService } from '../../services/location-enrichment-service';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';

export function registerRefMapsHandlers(db: Kysely<Database>): void {
  const repository = new SqliteRefMapsRepository(db);
  const matcher = new RefMapMatcherService(db);
  const dedupService = new RefMapDedupService(db);
  // Migration 42: Geocoding service for enrichment reverse geocoding
  const geocodingService = new GeocodingService(db);
  // Centralized enrichment service - ensures GPS + address + region fields are always updated together
  const enrichmentService = new LocationEnrichmentService(db, geocodingService);

  /**
   * Select map files (dialog only, no import)
   * ADR-048: Now supports multi-selection
   * Used for preview flow before actual import
   */
  ipcMain.handle('refMaps:selectFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Reference Maps',
        filters: [
          { name: 'Map Files', extensions: ['kml', 'kmz', 'gpx', 'geojson', 'json', 'csv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile', 'multiSelections']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }

      return result.filePaths;
    } catch (error) {
      console.error('Error selecting map files:', error);
      return [];
    }
  });

  /**
   * Select and import a map file
   */
  ipcMain.handle('refMaps:import', async (_event, importedBy?: string) => {
    try {
      // Show file dialog
      const result = await dialog.showOpenDialog({
        title: 'Import Reference Map',
        filters: [
          { name: 'Map Files', extensions: ['kml', 'kmz', 'gpx', 'geojson', 'json', 'csv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = result.filePaths[0];

      // Verify it's a supported file
      if (!isSupportedMapFile(filePath)) {
        return {
          success: false,
          error: `Unsupported file type. Supported: ${getSupportedExtensions().join(', ')}`
        };
      }

      // Parse the file
      const parseResult = await parseMapFile(filePath);

      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error || 'Failed to parse map file'
        };
      }

      if (parseResult.points.length === 0) {
        return {
          success: false,
          error: 'No points found in map file'
        };
      }

      // Create the map record with points
      const mapName = path.basename(filePath, path.extname(filePath));
      const refMap = await repository.create({
        mapName,
        filePath,
        fileType: parseResult.fileType,
        importedBy,
        points: parseResult.points
      });

      return {
        success: true,
        map: {
          mapId: refMap.mapId,
          mapName: refMap.mapName,
          filePath: refMap.filePath,
          fileType: refMap.fileType,
          pointCount: refMap.pointCount,
          importedAt: refMap.importedAt,
          importedBy: refMap.importedBy
        },
        pointCount: parseResult.points.length
      };
    } catch (error) {
      console.error('Error importing reference map:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error importing map'
      };
    }
  });

  /**
   * Import a map file from a specific path (for drag-drop)
   */
  ipcMain.handle('refMaps:importFromPath', async (_event, filePath: string, importedBy?: string) => {
    try {
      // Verify file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      // Verify it's a supported file
      if (!isSupportedMapFile(filePath)) {
        return {
          success: false,
          error: `Unsupported file type. Supported: ${getSupportedExtensions().join(', ')}`
        };
      }

      // Parse the file
      const parseResult = await parseMapFile(filePath);

      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error || 'Failed to parse map file'
        };
      }

      if (parseResult.points.length === 0) {
        return {
          success: false,
          error: 'No points found in map file'
        };
      }

      // Create the map record with points
      const mapName = path.basename(filePath, path.extname(filePath));
      const refMap = await repository.create({
        mapName,
        filePath,
        fileType: parseResult.fileType,
        importedBy,
        points: parseResult.points
      });

      return {
        success: true,
        map: {
          mapId: refMap.mapId,
          mapName: refMap.mapName,
          filePath: refMap.filePath,
          fileType: refMap.fileType,
          pointCount: refMap.pointCount,
          importedAt: refMap.importedAt,
          importedBy: refMap.importedBy
        },
        pointCount: parseResult.points.length
      };
    } catch (error) {
      console.error('Error importing reference map from path:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error importing map'
      };
    }
  });

  /**
   * ADR-048: Batch import multiple map files
   * Used by onboarding Page 4 and Settings multi-select
   * Auto-skips duplicates when importing multiple files
   */
  ipcMain.handle('refMaps:importBatch', async (_event, filePaths: string[], importedBy?: string) => {
    const results: Array<{
      filePath: string;
      fileName: string;
      success: boolean;
      error?: string;
      mapId?: string;
      pointCount?: number;
    }> = [];

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);

      try {
        // Verify file exists
        if (!fs.existsSync(filePath)) {
          results.push({ filePath, fileName, success: false, error: 'File not found' });
          continue;
        }

        // Verify it's a supported file
        if (!isSupportedMapFile(filePath)) {
          results.push({ filePath, fileName, success: false, error: 'Unsupported file type' });
          continue;
        }

        // Parse the file
        const parseResult = await parseMapFile(filePath);

        if (!parseResult.success) {
          results.push({ filePath, fileName, success: false, error: parseResult.error || 'Failed to parse' });
          continue;
        }

        if (parseResult.points.length === 0) {
          results.push({ filePath, fileName, success: false, error: 'No points found' });
          continue;
        }

        // Run dedup check and filter duplicates
        const dedupResult = await dedupService.checkForDuplicates(parseResult.points);
        const pointsToImport = dedupResult.newPoints;

        if (pointsToImport.length === 0) {
          results.push({
            filePath,
            fileName,
            success: true,
            pointCount: 0,
            error: 'All points were duplicates'
          });
          continue;
        }

        // Create the map record with filtered points
        const mapName = path.basename(filePath, path.extname(filePath));
        const refMap = await repository.create({
          mapName,
          filePath,
          fileType: parseResult.fileType,
          importedBy,
          points: pointsToImport
        });

        results.push({
          filePath,
          fileName,
          success: true,
          mapId: refMap.mapId,
          pointCount: pointsToImport.length
        });
      } catch (error) {
        results.push({
          filePath,
          fileName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success && (r.pointCount ?? 0) > 0).length;
    const totalPoints = results.reduce((sum, r) => sum + (r.pointCount || 0), 0);
    const skippedCount = results.filter(r => r.success && r.pointCount === 0).length;
    const failedCount = results.filter(r => !r.success).length;

    return {
      success: failedCount === 0,
      results,
      totalPoints,
      successCount,
      skippedCount,
      failedCount
    };
  });

  /**
   * Get all reference maps (metadata only, no points)
   */
  ipcMain.handle('refMaps:findAll', async () => {
    try {
      const maps = await repository.findAll();
      return maps.map(m => ({
        mapId: m.mapId,
        mapName: m.mapName,
        filePath: m.filePath,
        fileType: m.fileType,
        pointCount: m.pointCount,
        importedAt: m.importedAt,
        importedBy: m.importedBy
      }));
    } catch (error) {
      console.error('Error finding all reference maps:', error);
      return [];
    }
  });

  /**
   * Get a specific map with all its points
   */
  ipcMain.handle('refMaps:findById', async (_event, mapId: string) => {
    try {
      const map = await repository.findByIdWithPoints(mapId);
      if (!map) return null;

      return {
        mapId: map.mapId,
        mapName: map.mapName,
        filePath: map.filePath,
        fileType: map.fileType,
        pointCount: map.pointCount,
        importedAt: map.importedAt,
        importedBy: map.importedBy,
        points: map.points.map(p => ({
          pointId: p.pointId,
          mapId: p.mapId,
          name: p.name,
          description: p.description,
          lat: p.lat,
          lng: p.lng,
          state: p.state,
          category: p.category,
          rawMetadata: p.rawMetadata
        }))
      };
    } catch (error) {
      console.error('Error finding reference map by ID:', error);
      return null;
    }
  });

  /**
   * OPT-037: Get reference points within map viewport bounds
   * Spatial query for Atlas - only loads visible reference points
   */
  ipcMain.handle('refMaps:getPointsInBounds', async (_event, bounds: { north: number; south: number; east: number; west: number }) => {
    try {
      if (!bounds || typeof bounds.north !== 'number' || typeof bounds.south !== 'number' ||
          typeof bounds.east !== 'number' || typeof bounds.west !== 'number') {
        throw new Error('Invalid bounds object');
      }
      const points = await repository.getPointsInBounds(bounds);
      return points.map(p => ({
        pointId: p.pointId,
        mapId: p.mapId,
        name: p.name,
        description: p.description,
        lat: p.lat,
        lng: p.lng,
        state: p.state,
        category: p.category,
        rawMetadata: p.rawMetadata,
      }));
    } catch (error) {
      console.error('Error getting reference points in bounds:', error);
      return [];
    }
  });

  /**
   * Get all points from all maps (for Atlas layer)
   * OPT-046: Removed O(N×M) findCataloguedRefPoints call that was blocking
   * main process for ~9 seconds. Catalogued filtering moved to Settings page.
   * OPT-049: Linked point filtering now done in SQL with LIMIT for performance.
   */
  ipcMain.handle('refMaps:getAllPoints', async () => {
    try {
      // OPT-049: Repository now handles linked filtering and limit in SQL
      // No JS filtering needed - query already returns only unlinked points
      const points = await repository.getAllPoints();

      return points.map(p => ({
        pointId: p.pointId,
        mapId: p.mapId,
        name: p.name,
        description: p.description,
        lat: p.lat,
        lng: p.lng,
        state: p.state,
        category: p.category,
        rawMetadata: p.rawMetadata
      }));
    } catch (error) {
      console.error('Error getting all reference map points:', error);
      return [];
    }
  });

  /**
   * Update a map's name
   */
  ipcMain.handle('refMaps:update', async (_event, mapId: string, updates: { mapName?: string }) => {
    try {
      const map = await repository.update(mapId, updates);
      if (!map) return null;

      return {
        mapId: map.mapId,
        mapName: map.mapName,
        filePath: map.filePath,
        fileType: map.fileType,
        pointCount: map.pointCount,
        importedAt: map.importedAt,
        importedBy: map.importedBy
      };
    } catch (error) {
      console.error('Error updating reference map:', error);
      return null;
    }
  });

  /**
   * Delete a reference map and all its points
   */
  ipcMain.handle('refMaps:delete', async (_event, mapId: string) => {
    try {
      await repository.delete(mapId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting reference map:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error deleting map'
      };
    }
  });

  /**
   * Get statistics about reference maps
   */
  ipcMain.handle('refMaps:getStats', async () => {
    try {
      const mapCount = await repository.count();
      const pointCount = await repository.countPoints();
      const categories = await repository.getCategories();
      const states = await repository.getStates();

      return {
        mapCount,
        pointCount,
        categories,
        states
      };
    } catch (error) {
      console.error('Error getting reference map stats:', error);
      return {
        mapCount: 0,
        pointCount: 0,
        categories: [],
        states: []
      };
    }
  });

  /**
   * Get supported file extensions
   */
  ipcMain.handle('refMaps:getSupportedExtensions', () => {
    return getSupportedExtensions();
  });

  /**
   * Preview import with deduplication check
   * Returns analysis without importing - user can then choose to proceed
   */
  ipcMain.handle('refMaps:previewImport', async (_event, filePath: string) => {
    try {
      // Verify file exists
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }

      // Verify it's a supported file
      if (!isSupportedMapFile(filePath)) {
        return {
          success: false,
          error: `Unsupported file type. Supported: ${getSupportedExtensions().join(', ')}`
        };
      }

      // Parse the file
      const parseResult = await parseMapFile(filePath);

      if (!parseResult.success) {
        return { success: false, error: parseResult.error || 'Failed to parse map file' };
      }

      if (parseResult.points.length === 0) {
        return { success: false, error: 'No points found in map file' };
      }

      // Run deduplication check
      const dedupResult = await dedupService.checkForDuplicates(parseResult.points);

      // Split catalogued matches into enrichment opportunities vs already catalogued
      // Enrichment = existing location has NO GPS, ref point has GPS
      const enrichmentOpportunities = dedupResult.cataloguedMatches.filter(m => m.existingHasGps === false);
      const alreadyCatalogued = dedupResult.cataloguedMatches.filter(m => m.existingHasGps !== false);

      // Build a map of coordinates to point index for enrichments
      const coordToIndex = new Map<string, number>();
      parseResult.points.forEach((p, i) => {
        coordToIndex.set(`${p.lat},${p.lng}`, i);
      });

      // Format matches for display
      const formatMatch = (m: DuplicateMatch) => ({
        type: m.type,
        matchType: m.matchType,
        newPointName: m.newPoint.name || 'Unnamed',
        newPointLat: m.newPoint.lat,
        newPointLng: m.newPoint.lng,
        newPointState: m.newPoint.state,
        existingName: m.existingName,
        existingId: m.existingId,
        existingState: m.existingState,
        existingHasGps: m.existingHasGps,
        nameSimilarity: m.nameSimilarity,
        distanceMeters: m.distanceMeters,
        mapName: m.mapName,
        needsConfirmation: m.needsConfirmation,
        // Migration 42: Point index for enrichment
        pointIndex: coordToIndex.get(`${m.newPoint.lat},${m.newPoint.lng}`),
      });

      // Build state breakdown for new points (top 5)
      const stateCounts = new Map<string, number>();
      for (const point of dedupResult.newPoints) {
        const state = point.state || 'Unknown';
        stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
      }
      const newPointsStateBreakdown = Array.from(stateCounts.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        success: true,
        fileName: path.basename(filePath),
        filePath,
        fileType: parseResult.fileType,
        totalPoints: dedupResult.totalParsed,
        newPoints: dedupResult.newPoints.length,
        newPointsStateBreakdown,
        // New: separate enrichment opportunities from already catalogued
        enrichmentCount: enrichmentOpportunities.length,
        enrichmentOpportunities: enrichmentOpportunities.slice(0, 20).map(formatMatch),
        // Existing: already catalogued (have GPS)
        cataloguedCount: alreadyCatalogued.length,
        cataloguedMatches: alreadyCatalogued.slice(0, 10).map(formatMatch),
        referenceCount: dedupResult.referenceMatches.length,
        referenceMatches: dedupResult.referenceMatches.slice(0, 10).map(formatMatch),
      };
    } catch (error) {
      console.error('Error previewing reference map import:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  /**
   * Import with deduplication options (after preview)
   * Migration 39: When skipDuplicates is true, merges names into AKA field
   * Migration 42: Handles enrichments - apply GPS to existing locations
   */
  ipcMain.handle('refMaps:importWithOptions', async (
    _event,
    filePath: string,
    options: {
      skipDuplicates: boolean;
      importedBy?: string;
      // Migration 42: Enrichments to apply during import
      enrichments?: Array<{
        existingLocId: string;
        pointIndex: number; // Index in parsed points array
      }>;
    }
  ) => {
    try {
      // Verify file exists
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }

      // Parse the file
      const parseResult = await parseMapFile(filePath);

      if (!parseResult.success) {
        return { success: false, error: parseResult.error || 'Failed to parse map file' };
      }

      let pointsToImport = parseResult.points;
      let mergedCount = 0;
      let enrichedCount = 0;
      // OPT-049: Track enriched point coordinates to filter from import
      // Points used for enrichment should NOT be imported as ref_map_points
      const enrichedCoords = new Set<string>();

      // If skipping duplicates, filter them and merge names into existing points
      if (options.skipDuplicates) {
        const dedupResult = await dedupService.checkForDuplicates(parseResult.points);

        // Merge names for reference matches (duplicates against existing ref_map_points)
        for (const match of dedupResult.referenceMatches) {
          if (match.newPoint.name && match.type === 'reference') {
            // Use the addOrMergePoint method to merge the name
            await dedupService.addOrMergePoint(
              '', // mapId not needed for merge-only
              match.newPoint.name,
              match.newPoint.lat,
              match.newPoint.lng,
              null, // description
              null, // state
              null, // category
              null  // rawMetadata
            );
            mergedCount++;
          }
        }

        pointsToImport = dedupResult.newPoints;
      }

      // Migration 42: Apply enrichments to existing locations
      // Uses centralized enrichment service for GPS + address + region updates
      // FIX: MAP-AUDIT-001 - Create linked ref_map_points for audit trail
      if (options.enrichments && options.enrichments.length > 0) {
        console.log(`[RefMaps] Processing ${options.enrichments.length} enrichments via centralized service...`);

        // Create a temporary map record for enrichment tracking (if any succeed)
        // This ensures we have a map_id to link enriched points to
        let enrichmentMapId: string | null = null;
        const enrichmentMapName = `${path.basename(filePath, path.extname(filePath))}_enrichments`;

        for (const enrichment of options.enrichments) {
          // Validate pointIndex is a number (not boolean or undefined)
          if (typeof enrichment.pointIndex !== 'number') {
            console.warn(`[RefMaps] Skipping enrichment for ${enrichment.existingLocId}: invalid pointIndex (${typeof enrichment.pointIndex})`);
            continue;
          }
          const point = parseResult.points[enrichment.pointIndex];
          if (!point) {
            console.warn(`[RefMaps] Skipping enrichment for ${enrichment.existingLocId}: point at index ${enrichment.pointIndex} not found`);
            continue;
          }

          // Use centralized enrichment service - handles geocoding, region calc, and database update
          const enrichResult = await enrichmentService.enrichFromGPS(enrichment.existingLocId, {
            lat: point.lat,
            lng: point.lng,
            source: 'ref_map_import',
            stateHint: point.state, // Fallback if geocode fails
          });

          if (enrichResult.success) {
            enrichedCount++;
            // OPT-049: Track this point's coordinates so we don't import it as a duplicate
            // The GPS data is now on the location - no need to also have it as a ref point
            enrichedCoords.add(`${point.lat},${point.lng}`);
            console.log(`[RefMaps] Enriched location ${enrichment.existingLocId}: GPS + address=${enrichResult.updated.address}, regions=${enrichResult.updated.regions} for "${point.name}"`);

            // FIX: MAP-AUDIT-001 - Create linked ref_map_point for audit trail
            // This records which map point was used to enrich which location
            try {
              // Lazy create the enrichment map record on first successful enrichment
              if (!enrichmentMapId) {
                const enrichmentMap = await repository.create({
                  mapName: enrichmentMapName,
                  filePath: `${filePath}#enrichments`,
                  fileType: parseResult.fileType,
                  importedBy: options.importedBy,
                  points: [], // Empty - we'll add linked points directly
                });
                enrichmentMapId = enrichmentMap.mapId;
                console.log(`[RefMaps] Created enrichment tracking map: ${enrichmentMapId}`);
              }

              // Create a ref_map_point that's already linked to the location
              const { generateId } = await import('../ipc-validation');
              const pointId = generateId();
              await db
                .insertInto('ref_map_points')
                .values({
                  point_id: pointId,
                  map_id: enrichmentMapId,
                  name: point.name,
                  description: point.description || null,
                  lat: point.lat,
                  lng: point.lng,
                  state: point.state || null,
                  category: point.category || null,
                  raw_metadata: point.rawMetadata ? JSON.stringify(point.rawMetadata) : null,
                  aka_names: null,
                  linked_locid: enrichment.existingLocId, // FIX: Set linked_locid immediately
                  linked_at: new Date().toISOString(),
                })
                .execute();
              console.log(`[RefMaps] Created linked ref_map_point ${pointId} → location ${enrichment.existingLocId}`);
            } catch (linkError) {
              // Non-fatal - enrichment succeeded, just audit trail failed
              console.warn(`[RefMaps] Failed to create linked ref_map_point for audit: ${linkError}`);
            }

            // Verification: Warn if GPS applied but regions failed
            if (!enrichResult.updated.regions) {
              console.warn(`[RefMaps] ⚠️ GPS applied but regions NOT updated for ${enrichment.existingLocId} ("${point.name}"). ` +
                `stateHint=${point.state}, check if geocoding failed and state couldn't be derived.`);
            }
          } else {
            console.warn(`[RefMaps] Enrichment failed for ${enrichment.existingLocId}: ${enrichResult.error}`);
          }
        }
      }

      // OPT-049: Filter out enriched points from import
      // These points have transferred their GPS to locations - importing them would create
      // duplicate pins on the map (location pin + ref point pin at same coords)
      if (enrichedCoords.size > 0) {
        const beforeCount = pointsToImport.length;
        pointsToImport = pointsToImport.filter(p => !enrichedCoords.has(`${p.lat},${p.lng}`));
        const filteredCount = beforeCount - pointsToImport.length;
        if (filteredCount > 0) {
          console.log(`[RefMaps] Filtered ${filteredCount} enriched points from import (GPS already applied to locations)`);
        }
      }

      if (pointsToImport.length === 0) {
        // Build message based on what happened
        let message = 'All points were duplicates - nothing imported';
        if (enrichedCount > 0 && mergedCount > 0) {
          message = `${enrichedCount} locations enriched with GPS, ${mergedCount} names merged`;
        } else if (enrichedCount > 0) {
          message = `${enrichedCount} location${enrichedCount > 1 ? 's' : ''} enriched with GPS`;
        } else if (mergedCount > 0) {
          message = `All points were duplicates - ${mergedCount} names merged into existing points`;
        }

        return {
          success: true,
          skippedAll: true,
          message,
          pointCount: 0,
          mergedCount,
          enrichedCount,
        };
      }

      // Create the map record with filtered points
      const mapName = path.basename(filePath, path.extname(filePath));
      const refMap = await repository.create({
        mapName,
        filePath,
        fileType: parseResult.fileType,
        importedBy: options.importedBy,
        points: pointsToImport
      });

      return {
        success: true,
        map: {
          mapId: refMap.mapId,
          mapName: refMap.mapName,
          filePath: refMap.filePath,
          fileType: refMap.fileType,
          pointCount: refMap.pointCount,
          importedAt: refMap.importedAt,
          importedBy: refMap.importedBy
        },
        pointCount: pointsToImport.length,
        skippedCount: parseResult.points.length - pointsToImport.length,
        mergedCount,
        enrichedCount,
      };
    } catch (error) {
      console.error('Error importing reference map with options:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error importing map'
      };
    }
  });

  /**
   * Find matching reference map points for a location name
   * Phase 2: Auto-matching during location creation
   */
  ipcMain.handle('refMaps:findMatches', async (
    _event,
    query: string,
    options?: { threshold?: number; limit?: number; state?: string | null }
  ) => {
    try {
      const matches = await matcher.findMatches(query, options);
      return matches.map(m => ({
        pointId: m.pointId,
        mapId: m.mapId,
        name: m.name,
        description: m.description,
        lat: m.lat,
        lng: m.lng,
        state: m.state,
        category: m.category,
        mapName: m.mapName,
        score: m.score
      }));
    } catch (error) {
      console.error('Error finding reference map matches:', error);
      return [];
    }
  });

  /**
   * Find reference points that are already catalogued as locations.
   * Returns matches that can be purged to keep the reference layer slim.
   */
  ipcMain.handle('refMaps:findCataloguedPoints', async () => {
    try {
      const matches = await dedupService.findCataloguedRefPoints();
      return {
        success: true,
        matches: matches.map(m => ({
          pointId: m.pointId,
          pointName: m.pointName,
          mapName: m.mapName,
          matchedLocid: m.matchedLocid,
          matchedLocName: m.matchedLocName,
          nameSimilarity: m.nameSimilarity,
          distanceMeters: m.distanceMeters,
        })),
        count: matches.length,
      };
    } catch (error) {
      console.error('Error finding catalogued reference points:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        matches: [],
        count: 0,
      };
    }
  });

  /**
   * Purge (delete) reference points that match catalogued locations.
   * Keeps the reference layer lean by removing points that are now in the database.
   */
  ipcMain.handle('refMaps:purgeCataloguedPoints', async () => {
    try {
      // Find all matches first
      const matches = await dedupService.findCataloguedRefPoints();

      if (matches.length === 0) {
        return {
          success: true,
          deleted: 0,
          message: 'No catalogued reference points found to purge',
        };
      }

      // Delete them
      const pointIds = matches.map(m => m.pointId);
      const deleted = await dedupService.deleteRefPoints(pointIds);

      return {
        success: true,
        deleted,
        message: `Purged ${deleted} reference points that were already catalogued`,
      };
    } catch (error) {
      console.error('Error purging catalogued reference points:', error);
      return {
        success: false,
        deleted: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Delete a single reference point by ID.
   * Used from map popup delete button.
   */
  ipcMain.handle('refMaps:deletePoint', async (_event, pointId: string) => {
    try {
      if (!pointId) {
        return { success: false, error: 'Point ID is required' };
      }

      const deleted = await dedupService.deleteRefPoints([pointId]);

      return {
        success: true,
        deleted,
      };
    } catch (error) {
      console.error('Error deleting reference point:', error);
      return {
        success: false,
        deleted: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Migration 39: Preview GPS-based deduplication within ref_map_points.
   * Shows what would be merged without making changes.
   */
  ipcMain.handle('refMaps:previewDedup', async () => {
    try {
      const preview = await dedupService.preview();
      return {
        success: true,
        ...preview,
      };
    } catch (error) {
      console.error('Error previewing deduplication:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Migration 39: Run GPS-based deduplication on ref_map_points.
   * Merges duplicate pins at the same GPS location (~10m precision).
   * Keeps the best name and stores alternates in aka_names field.
   */
  ipcMain.handle('refMaps:deduplicate', async () => {
    try {
      const stats = await dedupService.deduplicate();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error('Error running deduplication:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Migration 42: Apply GPS enrichment from a ref point to an existing location.
   * Updates the location's GPS fields and links the ref point (not deleted).
   * Used when a ref point matches a location that has no GPS.
   */
  ipcMain.handle('refMaps:applyEnrichment', async (
    _event,
    input: { locationId: string; refPointId: string }
  ) => {
    try {
      const { locationId, refPointId } = input;

      if (!locationId || !refPointId) {
        return { success: false, error: 'Location ID and ref point ID are required' };
      }

      // Get the ref point
      const refPoint = await db
        .selectFrom('ref_map_points')
        .select(['point_id', 'lat', 'lng', 'state', 'name'])
        .where('point_id', '=', refPointId)
        .executeTakeFirst();

      if (!refPoint) {
        return { success: false, error: 'Reference point not found' };
      }

      // Use centralized enrichment service for GPS + address + region updates
      // This ensures all fields are populated consistently
      const enrichResult = await enrichmentService.enrichFromGPS(locationId, {
        lat: refPoint.lat,
        lng: refPoint.lng,
        source: 'ref_map_import',
        stateHint: refPoint.state, // Fallback if geocode fails
      });

      if (!enrichResult.success) {
        return { success: false, error: enrichResult.error || 'Enrichment failed' };
      }

      // Link the ref point to the location (preserve provenance, don't delete)
      await db
        .updateTable('ref_map_points')
        .set({
          linked_locid: locationId,
          linked_at: new Date().toISOString(),
        })
        .where('point_id', '=', refPointId)
        .execute();

      console.log(`[RefMaps] Applied GPS enrichment: ${refPoint.name} → location ${locationId} (address=${enrichResult.updated.address}, regions=${enrichResult.updated.regions})`);

      // Verification: Warn if GPS applied but regions failed
      if (!enrichResult.updated.regions) {
        console.warn(`[RefMaps] ⚠️ GPS applied but regions NOT updated for ${locationId} ("${refPoint.name}"). ` +
          `stateHint=${refPoint.state}, check if geocoding failed and state couldn't be derived.`);
      }

      return {
        success: true,
        appliedGps: { lat: refPoint.lat, lng: refPoint.lng },
        state: enrichResult.address?.state || refPoint.state,
        enrichment: enrichResult, // Include full enrichment result for debugging
      };
    } catch (error) {
      console.error('Error applying GPS enrichment:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Migration 42: Batch apply GPS enrichment for multiple matches.
   * Only applies matches with 95%+ similarity (high confidence).
   * Uses centralized enrichment service for GPS + address + region updates.
   */
  ipcMain.handle('refMaps:applyAllEnrichments', async (
    _event,
    enrichments: Array<{ locationId: string; refPointId: string; nameSimilarity: number }>
  ) => {
    try {
      const BATCH_THRESHOLD = 95; // Only apply 95%+ matches
      const highConfidence = enrichments.filter(e => (e.nameSimilarity ?? 0) >= BATCH_THRESHOLD);

      if (highConfidence.length === 0) {
        return {
          success: true,
          applied: 0,
          skipped: enrichments.length,
          message: `No matches meet the ${BATCH_THRESHOLD}% threshold for batch apply`,
        };
      }

      let applied = 0;
      let addressUpdated = 0;
      let regionsUpdated = 0;

      for (const { locationId, refPointId } of highConfidence) {
        // Get the ref point
        const refPoint = await db
          .selectFrom('ref_map_points')
          .select(['point_id', 'lat', 'lng', 'state', 'name'])
          .where('point_id', '=', refPointId)
          .executeTakeFirst();

        if (!refPoint) continue;

        // Use centralized enrichment service for GPS + address + region updates
        const enrichResult = await enrichmentService.enrichFromGPS(locationId, {
          lat: refPoint.lat,
          lng: refPoint.lng,
          source: 'ref_map_import',
          stateHint: refPoint.state, // Fallback if geocode fails
        });

        if (!enrichResult.success) {
          console.warn(`[RefMaps] Enrichment failed for ${locationId}: ${enrichResult.error}`);
          continue;
        }

        // Link the ref point
        await db
          .updateTable('ref_map_points')
          .set({
            linked_locid: locationId,
            linked_at: new Date().toISOString(),
          })
          .where('point_id', '=', refPointId)
          .execute();

        applied++;
        if (enrichResult.updated.address) addressUpdated++;
        if (enrichResult.updated.regions) {
          regionsUpdated++;
        } else {
          // Verification: Warn if GPS applied but regions failed
          console.warn(`[RefMaps] ⚠️ GPS applied but regions NOT updated for ${locationId} ("${refPoint.name}"). ` +
            `stateHint=${refPoint.state}`);
        }
      }

      console.log(`[RefMaps] Batch applied ${applied} GPS enrichments (${addressUpdated} with address, ${regionsUpdated} with regions)`);

      // Verification summary: Warn if any enrichments failed to populate regions
      const regionGaps = applied - regionsUpdated;
      if (regionGaps > 0) {
        console.warn(`[RefMaps] ⚠️ ${regionGaps} locations received GPS but NO REGIONS. Check logs for details.`);
      }

      return {
        success: true,
        applied,
        skipped: enrichments.length - applied,
        addressUpdated,
        regionsUpdated,
      };
    } catch (error) {
      console.error('Error batch applying GPS enrichments:', error);
      return {
        success: false,
        applied: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Link a reference point to an existing location.
   * This marks the ref point as "used" without applying GPS enrichment.
   * Used when user manually associates a ref point with a location from the Atlas.
   */
  ipcMain.handle('refMaps:linkToLocation', async (
    _event,
    input: { pointId: string; locationId: string }
  ) => {
    try {
      const { pointId, locationId } = input;

      if (!pointId || !locationId) {
        return { success: false, error: 'Point ID and location ID are required' };
      }

      // Verify the ref point exists
      const refPoint = await db
        .selectFrom('ref_map_points')
        .select(['point_id', 'name'])
        .where('point_id', '=', pointId)
        .executeTakeFirst();

      if (!refPoint) {
        return { success: false, error: 'Reference point not found' };
      }

      // Verify the location exists
      const location = await db
        .selectFrom('locs')
        .select(['locid', 'locnam'])
        .where('locid', '=', locationId)
        .executeTakeFirst();

      if (!location) {
        return { success: false, error: 'Location not found' };
      }

      // Link the ref point to the location
      await db
        .updateTable('ref_map_points')
        .set({
          linked_locid: locationId,
          linked_at: new Date().toISOString(),
        })
        .where('point_id', '=', pointId)
        .execute();

      console.log(`[RefMaps] Linked ref point "${refPoint.name}" to location "${location.locnam}"`);

      return { success: true };
    } catch (error) {
      console.error('Error linking reference point to location:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
