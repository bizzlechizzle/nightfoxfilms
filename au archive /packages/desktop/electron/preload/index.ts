// CRITICAL: Use require() for electron in preload scripts
// ESM imports don't get converted to require() when electron is external
// This causes "Cannot use import statement outside a module" errors
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Types are import-only, they get stripped at compile time
import type { Location, LocationInput, LocationFilters } from '@au-archive/core';

const api = {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },
  platform: process.platform,

  locations: {
    findAll: (filters?: LocationFilters): Promise<Location[]> =>
      ipcRenderer.invoke('location:findAll', filters),
    findById: (id: string): Promise<Location | null> =>
      ipcRenderer.invoke('location:findById', id),
    create: (input: LocationInput): Promise<Location> =>
      ipcRenderer.invoke('location:create', input),
    update: (id: string, input: Partial<LocationInput>): Promise<Location> =>
      ipcRenderer.invoke('location:update', id, input),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke('location:delete', id),
    count: (filters?: LocationFilters): Promise<number> =>
      ipcRenderer.invoke('location:count', filters),
    random: (): Promise<Location | null> =>
      ipcRenderer.invoke('location:random'),
    undocumented: (): Promise<Location[]> =>
      ipcRenderer.invoke('location:undocumented'),
    historical: (): Promise<Location[]> =>
      ipcRenderer.invoke('location:historical'),
    favorites: (): Promise<Location[]> =>
      ipcRenderer.invoke('location:favorites'),
    toggleFavorite: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('location:toggleFavorite', id),
    // FIX 6.7: Proximity search - find locations within radius
    findNearby: (lat: number, lng: number, radiusKm: number): Promise<Array<Location & { distance: number }>> =>
      ipcRenderer.invoke('location:findNearby', lat, lng, radiusKm),
    // Kanye9: Check for duplicate locations by address
    checkDuplicates: (address: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    }): Promise<Array<{
      id: string;
      name: string;
      confidence: number;
      matchedFields: string[];
      address: {
        street?: string | null;
        city?: string | null;
        county?: string | null;
        state?: string | null;
        zipcode?: string | null;
      };
    }>> =>
      ipcRenderer.invoke('location:checkDuplicates', address),
    // DECISION-012: Backfill region fields for existing locations
    backfillRegions: (): Promise<{ updated: number; total: number }> =>
      ipcRenderer.invoke('location:backfillRegions'),
    // DECISION-017: Update cultural regions and verification status
    updateRegionData: (id: string, regionData: {
      culturalRegion: string | null;
      localCulturalRegionVerified: boolean;
      countryCulturalRegion: string | null;
      countryCulturalRegionVerified: boolean;
    }): Promise<void> =>
      ipcRenderer.invoke('location:updateRegionData', id, regionData),
    // Autocomplete helpers for Category/Class
    getDistinctCategories: (): Promise<string[]> =>
      ipcRenderer.invoke('location:getDistinctCategories'),
    getDistinctClasses: (): Promise<string[]> =>
      ipcRenderer.invoke('location:getDistinctClasses'),
    // Migration 34: Track location views with per-user tracking
    trackView: (id: string): Promise<number> =>
      ipcRenderer.invoke('location:trackView', id),
    // Migration 34: Get view statistics for a location
    getViewStats: (id: string): Promise<{
      totalViews: number;
      uniqueViewers: number;
      lastViewedAt: string | null;
      recentViewers: Array<{
        user_id: string;
        username: string;
        display_name: string | null;
        view_count: number;
        last_viewed_at: string;
      }>;
    }> =>
      ipcRenderer.invoke('location:getViewStats', id),
    // Migration 34: Get view history for a location
    getViewHistory: (id: string, limit?: number): Promise<Array<{
      view_id: string;
      locid: string;
      user_id: string;
      username?: string;
      display_name?: string;
      viewed_at: string;
    }>> =>
      ipcRenderer.invoke('location:getViewHistory', id, limit),
    // Dashboard: Recently viewed locations with hero thumbnails
    findRecentlyViewed: (limit?: number): Promise<Array<{
      locid: string;
      locnam: string;
      address?: { state?: string };
      heroThumbPath?: string;
    }>> =>
      ipcRenderer.invoke('location:findRecentlyViewed', limit),

    // Migration 38: Duplicate detection for pin-to-location conversion
    // ADR: ADR-pin-conversion-duplicate-prevention.md
    checkDuplicateByNameAndGps: (input: {
      name: string;
      lat?: number | null;
      lng?: number | null;
    }): Promise<{
      hasDuplicate: boolean;
      match?: {
        locationId: string;
        locnam: string;
        akanam: string | null;
        state: string | null;
        matchType: 'gps' | 'name';
        distanceMeters?: number;
        nameSimilarity?: number;
        matchedField?: 'locnam' | 'akanam';
        mediaCount: number;
      };
    }> =>
      ipcRenderer.invoke('location:checkDuplicateByNameAndGps', input),

    // Migration 38: Record that two names refer to different places
    addExclusion: (nameA: string, nameB: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('location:addExclusion', nameA, nameB),

    // Migration 38: Get count of stored exclusions
    getExclusionCount: (): Promise<number> =>
      ipcRenderer.invoke('location:getExclusionCount'),
  },

  stats: {
    topStates: (limit?: number): Promise<Array<{ state: string; count: number }>> =>
      ipcRenderer.invoke('stats:topStates', limit),
    topCategories: (limit?: number): Promise<Array<{ category: string; count: number }>> =>
      ipcRenderer.invoke('stats:topCategories', limit),
    // Dashboard: Top categories with hero thumbnails
    topCategoriesWithHero: (limit?: number): Promise<Array<{ category: string; count: number; heroThumbPath?: string }>> =>
      ipcRenderer.invoke('stats:topCategoriesWithHero', limit),
    // Dashboard: Top states with hero thumbnails
    topStatesWithHero: (limit?: number): Promise<Array<{ state: string; count: number; heroThumbPath?: string }>> =>
      ipcRenderer.invoke('stats:topStatesWithHero', limit),
    // Migration 25 - Phase 4: Per-user stats
    userContributions: (userId: string): Promise<{
      locationsCreated: number;
      locationsDocumented: number;
      locationsContributed: number;
      totalLocationsInvolved: number;
      imagesImported: number;
      videosImported: number;
      documentsImported: number;
      totalMediaImported: number;
    }> =>
      ipcRenderer.invoke('stats:userContributions', userId),
    topContributors: (limit?: number): Promise<{
      topCreators: Array<{ userId: string; username: string; displayName: string | null; count: number }>;
      topDocumenters: Array<{ userId: string; username: string; displayName: string | null; count: number }>;
      topImporters: Array<{ userId: string; username: string; displayName: string | null; count: number }>;
    }> =>
      ipcRenderer.invoke('stats:topContributors', limit),
    allUserStats: (): Promise<Array<{
      userId: string;
      username: string;
      displayName: string | null;
      locationsCreated: number;
      locationsDocumented: number;
      locationsContributed: number;
      mediaImported: number;
      lastLogin: string | null;
    }>> =>
      ipcRenderer.invoke('stats:allUserStats'),
  },

  settings: {
    get: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('settings:get', key),
    getAll: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('settings:getAll'),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke('settings:set', key, value),
  },

  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },

  geocode: {
    reverse: (lat: number, lng: number): Promise<{
      lat: number;
      lng: number;
      displayName: string;
      address: {
        street?: string;
        houseNumber?: string;
        city?: string;
        county?: string;
        state?: string;
        stateCode?: string;
        zipcode?: string;
        country?: string;
        countryCode?: string;
      };
      confidence: 'high' | 'medium' | 'low';
      source: 'nominatim' | 'cache';
    } | null> =>
      ipcRenderer.invoke('geocode:reverse', lat, lng),
    forward: (address: string): Promise<{
      lat: number;
      lng: number;
      displayName: string;
      address: {
        street?: string;
        city?: string;
        county?: string;
        state?: string;
        stateCode?: string;
        zipcode?: string;
      };
      confidence: 'high' | 'medium' | 'low';
      source: 'nominatim' | 'cache';
    } | null> =>
      ipcRenderer.invoke('geocode:forward', address),
    // Kanye9: Cascade geocoding - tries multiple strategies (full → city → zipcode → county → state)
    forwardCascade: (address: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    }): Promise<{
      lat: number;
      lng: number;
      displayName: string;
      address: {
        street?: string;
        city?: string;
        county?: string;
        state?: string;
        stateCode?: string;
        zipcode?: string;
      };
      confidence: 'high' | 'medium' | 'low';
      source: 'nominatim' | 'cache';
      cascadeTier: number;
      cascadeDescription: string;
      cascadeQuery: string;
      expectedAccuracy: string;
    } | null> =>
      ipcRenderer.invoke('geocode:forwardCascade', address),
    clearCache: (daysOld?: number): Promise<{ deleted: number }> =>
      ipcRenderer.invoke('geocode:clearCache', daysOld),
  },

  // Kanye11: Address parsing with libpostal
  address: {
    // Check if libpostal is available
    libpostalStatus: (): Promise<{
      available: boolean;
      source: string;
      message: string;
    }> =>
      ipcRenderer.invoke('address:libpostalStatus'),

    // Parse address using libpostal (or regex fallback)
    parse: (address: string): Promise<{
      house_number: string | null;
      street: string | null;
      city: string | null;
      state: string | null;
      zipcode: string | null;
      country: string;
      confidence: 'high' | 'medium' | 'low';
    }> =>
      ipcRenderer.invoke('address:parse', address),
  },

  dialog: {
    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:selectFolder'),
  },

  database: {
    backup: (): Promise<{ success: boolean; path?: string; message?: string }> =>
      ipcRenderer.invoke('database:backup'),
    restore: (): Promise<{ success: boolean; message: string; requiresRestart?: boolean; autoBackupPath?: string }> =>
      ipcRenderer.invoke('database:restore'),
    getLocation: (): Promise<{
      currentPath: string;
      defaultPath: string;
      customPath: string | undefined;
      isCustom: boolean;
    }> =>
      ipcRenderer.invoke('database:getLocation'),
    changeLocation: (): Promise<{
      success: boolean;
      message: string;
      newPath?: string;
      requiresRestart?: boolean;
    }> =>
      ipcRenderer.invoke('database:changeLocation'),
    resetLocation: (): Promise<{
      success: boolean;
      message: string;
      newPath?: string;
      requiresRestart?: boolean;
    }> =>
      ipcRenderer.invoke('database:resetLocation'),
  },

  imports: {
    create: (input: {
      locid: string | null;
      auth_imp: string | null;
      img_count?: number;
      vid_count?: number;
      doc_count?: number;
      map_count?: number;
      notes?: string | null;
    }): Promise<unknown> =>
      ipcRenderer.invoke('imports:create', input),
    findRecent: (limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('imports:findRecent', limit),
    findByLocation: (locid: string): Promise<unknown[]> =>
      ipcRenderer.invoke('imports:findByLocation', locid),
    findAll: (): Promise<unknown[]> =>
      ipcRenderer.invoke('imports:findAll'),
    getTotalMediaCount: (): Promise<{ images: number; videos: number; documents: number; maps: number }> =>
      ipcRenderer.invoke('imports:getTotalMediaCount'),
  },

  media: {
    // File selection and import
    selectFiles: (): Promise<string[] | null> =>
      ipcRenderer.invoke('media:selectFiles'),
    expandPaths: (paths: string[]): Promise<string[]> =>
      ipcRenderer.invoke('media:expandPaths', paths),
    import: (input: {
      files: Array<{ filePath: string; originalName: string }>;
      locid: string;
      subid?: string | null;
      auth_imp: string | null;
    }): Promise<unknown> =>
      ipcRenderer.invoke('media:import', input),
    // Phase-based import (whereswaldo11.md spec): LOG IT -> SERIALIZE IT -> COPY & NAME IT -> DUMP
    phaseImport: (input: {
      files: Array<{ filePath: string; originalName: string }>;
      locid: string;
      subid?: string | null;
      auth_imp: string | null;
      verifyChecksums?: boolean;
    }): Promise<{
      success: boolean;
      importId: string;
      manifestPath: string;
      summary: {
        total: number;
        imported: number;
        duplicates: number;
        errors: number;
        images: number;
        videos: number;
        documents: number;
        maps: number;
      };
      errors: string[];
    }> =>
      ipcRenderer.invoke('media:phaseImport', input),
    // Phase import progress with phase info
    onPhaseImportProgress: (callback: (progress: {
      importId: string;
      phase: 'log' | 'serialize' | 'copy' | 'dump' | 'complete';
      phaseProgress: number;
      currentFile?: string;
      filesProcessed: number;
      totalFiles: number;
    }) => void) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('media:phaseImport:progress', listener);
      return () => ipcRenderer.removeListener('media:phaseImport:progress', listener);
    },
    // FIX 4.1 & 4.3: Progress callback includes filename and importId
    onImportProgress: (callback: (progress: { current: number; total: number; filename?: string; importId?: string }) => void) => {
      const listener = (_event: any, progress: { current: number; total: number; filename?: string; importId?: string }) => callback(progress);
      ipcRenderer.on('media:import:progress', listener);
      return () => ipcRenderer.removeListener('media:import:progress', listener);
    },
    // FIX: Receive importId immediately when import starts (before any file processing)
    onImportStarted: (callback: (data: { importId: string }) => void) => {
      const listener = (_event: any, data: { importId: string }) => callback(data);
      ipcRenderer.on('media:import:started', listener);
      return () => ipcRenderer.removeListener('media:import:started', listener);
    },
    // FIX 4.3: Cancel import
    cancelImport: (importId: string): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('media:import:cancel', importId),
    findByLocation: (locid: string): Promise<{
      images: unknown[];
      videos: unknown[];
      documents: unknown[];
    }> =>
      ipcRenderer.invoke('media:findByLocation', locid),
    // Media viewing and processing
    openFile: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('media:openFile', filePath),
    showInFolder: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('media:showInFolder', filePath),
    getFullMetadata: (hash: string, mediaType: 'image' | 'video' | 'document'): Promise<{
      success: boolean;
      error?: string;
      exiftool?: Record<string, unknown>;
      ffmpeg?: Record<string, unknown>;
    }> =>
      ipcRenderer.invoke('media:getFullMetadata', hash, mediaType),
    generateThumbnail: (sourcePath: string, hash: string): Promise<string | null> =>
      ipcRenderer.invoke('media:generateThumbnail', sourcePath, hash),
    extractPreview: (sourcePath: string, hash: string): Promise<string | null> =>
      ipcRenderer.invoke('media:extractPreview', sourcePath, hash),
    generatePoster: (sourcePath: string, hash: string): Promise<string | null> =>
      ipcRenderer.invoke('media:generatePoster', sourcePath, hash),
    getCached: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('media:getCached', key),
    preload: (mediaList: Array<{ hash: string; path: string }>, currentIndex: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('media:preload', mediaList, currentIndex),
    readXmp: (mediaPath: string): Promise<{
      rating?: number;
      label?: string;
      keywords?: string[];
      title?: string;
      description?: string;
    } | null> =>
      ipcRenderer.invoke('media:readXmp', mediaPath),
    writeXmp: (mediaPath: string, data: {
      rating?: number;
      label?: string;
      keywords?: string[];
      title?: string;
      description?: string;
    }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('media:writeXmp', mediaPath, data),
    regenerateAllThumbnails: (options?: { force?: boolean }): Promise<{ generated: number; failed: number; total: number; rawTotal?: number; previewsExtracted?: number; previewsFailed?: number }> =>
      ipcRenderer.invoke('media:regenerateAllThumbnails', options),
    // DECISION-020: Regenerate video thumbnails (poster frames)
    regenerateVideoThumbnails: (options?: { force?: boolean }): Promise<{ generated: number; failed: number; total: number }> =>
      ipcRenderer.invoke('media:regenerateVideoThumbnails', options),
    // Kanye11: Regenerate preview/thumbnails for a single file
    regenerateSingleFile: (hash: string, filePath: string): Promise<{
      success: boolean;
      error?: string;
      previewPath?: string;
      thumbPathSm?: string;
      thumbPathLg?: string;
    }> =>
      ipcRenderer.invoke('media:regenerateSingleFile', hash, filePath),

    // Video Proxy System (Migration 36, updated OPT-053 Immich Model)
    // Proxies generated at import time, stored alongside originals, permanent (no purge)
    generateProxy: (vidhash: string, sourcePath: string, metadata: { width: number; height: number }): Promise<{
      success: boolean;
      proxyPath?: string;
      error?: string;
      proxyWidth?: number;
      proxyHeight?: number;
    }> =>
      ipcRenderer.invoke('media:generateProxy', vidhash, sourcePath, metadata),

    // Get proxy path for a video (returns null if not exists)
    getProxyPath: (vidhash: string): Promise<string | null> =>
      ipcRenderer.invoke('media:getProxyPath', vidhash),

    // OPT-053: Fast filesystem check for proxy existence (no DB lookup)
    proxyExists: (videoPath: string, vidhash: string): Promise<boolean> =>
      ipcRenderer.invoke('media:proxyExists', videoPath, vidhash),

    // Get cache statistics
    getProxyCacheStats: (): Promise<{
      totalCount: number;
      totalSizeBytes: number;
      totalSizeMB: number;
      oldestAccess: string | null;
      newestAccess: string | null;
    }> =>
      ipcRenderer.invoke('media:getProxyCacheStats'),

    // OPT-053: DEPRECATED - Proxies are permanent, always returns empty result
    purgeOldProxies: (daysOld?: number): Promise<{
      deleted: number;
      freedBytes: number;
      freedMB: number;
    }> =>
      ipcRenderer.invoke('media:purgeOldProxies', daysOld),

    // OPT-053: DEPRECATED - Proxies are permanent, always returns empty result
    clearAllProxies: (): Promise<{
      deleted: number;
      freedBytes: number;
      freedMB: number;
    }> =>
      ipcRenderer.invoke('media:clearAllProxies'),

    // OPT-053: DEPRECATED - No last_accessed tracking, always returns 0
    touchLocationProxies: (locid: string): Promise<number> =>
      ipcRenderer.invoke('media:touchLocationProxies', locid),

    // For migration/repair of old imports
    generateProxiesForLocation: (locid: string): Promise<{
      generated: number;
      failed: number;
      total: number;
    }> =>
      ipcRenderer.invoke('media:generateProxiesForLocation', locid),

    // Subscribe to proxy generation progress events
    onProxyProgress: (callback: (progress: {
      locid: string;
      generated: number;
      failed: number;
      total: number;
    }) => void) => {
      const listener = (_event: unknown, progress: {
        locid: string;
        generated: number;
        failed: number;
        total: number;
      }) => callback(progress);
      ipcRenderer.on('media:proxyProgress', listener);
      return () => ipcRenderer.removeListener('media:proxyProgress', listener);
    },
  },

  // ADR-050: Import v2 progress events
  importV2: {
    onProgress: (callback: (progress: {
      sessionId: string;
      status: string;
      step: number;
      totalSteps: number;
      percent: number;
      currentFile: string;
      filesProcessed: number;
      filesTotal: number;
      bytesProcessed: number;
      bytesTotal: number;
      duplicatesFound: number;
      errorsFound: number;
      estimatedRemainingMs: number;
    }) => void) => {
      const listener = (_event: unknown, progress: {
        sessionId: string;
        status: string;
        step: number;
        totalSteps: number;
        percent: number;
        currentFile: string;
        filesProcessed: number;
        filesTotal: number;
        bytesProcessed: number;
        bytesTotal: number;
        duplicatesFound: number;
        errorsFound: number;
        estimatedRemainingMs: number;
      }) => callback(progress);
      ipcRenderer.on('import:v2:progress', listener);
      return () => ipcRenderer.removeListener('import:v2:progress', listener);
    },
    onComplete: (callback: (event: {
      sessionId: string;
      status: string;
      totalImported: number;
      totalDuplicates: number;
      totalErrors: number;
      totalDurationMs: number;
      jobsQueued: number;
    }) => void) => {
      const listener = (_event: unknown, eventData: {
        sessionId: string;
        status: string;
        totalImported: number;
        totalDuplicates: number;
        totalErrors: number;
        totalDurationMs: number;
        jobsQueued: number;
      }) => callback(eventData);
      ipcRenderer.on('import:v2:complete', listener);
      return () => ipcRenderer.removeListener('import:v2:complete', listener);
    },
  },

  notes: {
    create: (input: {
      locid: string;
      note_text: string;
      auth_imp?: string | null;
      note_type?: string;
    }): Promise<unknown> =>
      ipcRenderer.invoke('notes:create', input),
    findById: (note_id: string): Promise<unknown> =>
      ipcRenderer.invoke('notes:findById', note_id),
    findByLocation: (locid: string): Promise<unknown[]> =>
      ipcRenderer.invoke('notes:findByLocation', locid),
    findRecent: (limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('notes:findRecent', limit),
    update: (note_id: string, updates: {
      note_text?: string;
      note_type?: string;
    }): Promise<unknown> =>
      ipcRenderer.invoke('notes:update', note_id, updates),
    delete: (note_id: string): Promise<void> =>
      ipcRenderer.invoke('notes:delete', note_id),
    countByLocation: (locid: string): Promise<number> =>
      ipcRenderer.invoke('notes:countByLocation', locid),
  },

  sublocations: {
    create: (input: {
      locid: string;
      subnam: string;
      ssubname?: string | null;
      type?: string | null;
      status?: string | null;
      is_primary?: boolean;
      created_by?: string | null;
    // ADR-046: Return types - removed sub12 field
    }): Promise<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      type: string | null;
      status: string | null;
      hero_imghash: string | null;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
    }> =>
      ipcRenderer.invoke('sublocation:create', input),
    findById: (subid: string): Promise<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      type: string | null;
      status: string | null;
      hero_imghash: string | null;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      akanam: string | null;
    } | null> =>
      ipcRenderer.invoke('sublocation:findById', subid),
    findByLocation: (locid: string): Promise<Array<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      type: string | null;
      status: string | null;
      hero_imghash: string | null;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      akanam: string | null;
    }>> =>
      ipcRenderer.invoke('sublocation:findByLocation', locid),
    findWithHeroImages: (locid: string): Promise<Array<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      type: string | null;
      status: string | null;
      hero_imghash: string | null;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      hero_thumb_path?: string;
      akanam: string | null;
    }>> =>
      ipcRenderer.invoke('sublocation:findWithHeroImages', locid),
    update: (subid: string, updates: {
      subnam?: string;
      ssubname?: string | null;
      type?: string | null;
      status?: string | null;
      hero_imghash?: string | null;
      is_primary?: boolean;
      modified_by?: string | null;
      akanam?: string | null;
    }): Promise<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      type: string | null;
      status: string | null;
      hero_imghash: string | null;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      akanam: string | null;
    } | null> =>
      ipcRenderer.invoke('sublocation:update', subid, updates),
    delete: (subid: string): Promise<void> =>
      ipcRenderer.invoke('sublocation:delete', subid),
    setPrimary: (locid: string, subid: string): Promise<void> =>
      ipcRenderer.invoke('sublocation:setPrimary', locid, subid),
    checkName: (locid: string, subnam: string, excludeSubid?: string): Promise<boolean> =>
      ipcRenderer.invoke('sublocation:checkName', locid, subnam, excludeSubid),
    count: (locid: string): Promise<number> =>
      ipcRenderer.invoke('sublocation:count', locid),
  },

  projects: {
    create: (input: {
      project_name: string;
      description?: string | null;
      auth_imp?: string | null;
    }): Promise<unknown> =>
      ipcRenderer.invoke('projects:create', input),
    findById: (project_id: string): Promise<unknown> =>
      ipcRenderer.invoke('projects:findById', project_id),
    findByIdWithLocations: (project_id: string): Promise<unknown> =>
      ipcRenderer.invoke('projects:findByIdWithLocations', project_id),
    findAll: (): Promise<unknown[]> =>
      ipcRenderer.invoke('projects:findAll'),
    findRecent: (limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('projects:findRecent', limit),
    findTopByLocationCount: (limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('projects:findTopByLocationCount', limit),
    findByLocation: (locid: string): Promise<unknown[]> =>
      ipcRenderer.invoke('projects:findByLocation', locid),
    update: (project_id: string, updates: {
      project_name?: string;
      description?: string | null;
    }): Promise<unknown> =>
      ipcRenderer.invoke('projects:update', project_id, updates),
    delete: (project_id: string): Promise<void> =>
      ipcRenderer.invoke('projects:delete', project_id),
    addLocation: (project_id: string, locid: string): Promise<void> =>
      ipcRenderer.invoke('projects:addLocation', project_id, locid),
    removeLocation: (project_id: string, locid: string): Promise<void> =>
      ipcRenderer.invoke('projects:removeLocation', project_id, locid),
    isLocationInProject: (project_id: string, locid: string): Promise<boolean> =>
      ipcRenderer.invoke('projects:isLocationInProject', project_id, locid),
  },

  // Migration 25 - Phase 3: Location authors (multi-user attribution)
  locationAuthors: {
    add: (input: {
      locid: string;
      user_id: string;
      role: 'creator' | 'documenter' | 'contributor';
    }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('location-authors:add', input),
    remove: (locid: string, user_id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('location-authors:remove', locid, user_id),
    findByLocation: (locid: string): Promise<Array<{
      locid: string;
      user_id: string;
      username?: string;
      display_name?: string;
      role: 'creator' | 'documenter' | 'contributor';
      added_at: string;
    }>> =>
      ipcRenderer.invoke('location-authors:findByLocation', locid),
    findByUser: (user_id: string): Promise<Array<{
      locid: string;
      user_id: string;
      role: 'creator' | 'documenter' | 'contributor';
      added_at: string;
    }>> =>
      ipcRenderer.invoke('location-authors:findByUser', user_id),
    findCreator: (locid: string): Promise<{
      locid: string;
      user_id: string;
      username?: string;
      display_name?: string;
      role: 'creator';
      added_at: string;
    } | null> =>
      ipcRenderer.invoke('location-authors:findCreator', locid),
    countByUserAndRole: (user_id: string): Promise<Record<string, number>> =>
      ipcRenderer.invoke('location-authors:countByUserAndRole', user_id),
    countByLocation: (locid: string): Promise<number> =>
      ipcRenderer.invoke('location-authors:countByLocation', locid),
    trackContribution: (locid: string, user_id: string, action: 'create' | 'import' | 'edit'): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('location-authors:trackContribution', locid, user_id, action),
  },

  users: {
    // CRUD
    create: (input: {
      username: string;
      display_name?: string | null;
      pin?: string | null;
    }): Promise<{
      user_id: string;
      username: string;
      display_name: string | null;
      has_pin: boolean;
      is_active: boolean;
      last_login: string | null;
    }> =>
      ipcRenderer.invoke('users:create', input),
    findAll: (): Promise<Array<{
      user_id: string;
      username: string;
      display_name: string | null;
      has_pin: boolean;
      is_active: boolean;
      last_login: string | null;
    }>> =>
      ipcRenderer.invoke('users:findAll'),
    findById: (userId: string): Promise<{
      user_id: string;
      username: string;
      display_name: string | null;
      has_pin: boolean;
      is_active: boolean;
      last_login: string | null;
    } | null> =>
      ipcRenderer.invoke('users:findById', userId),
    findByUsername: (username: string): Promise<{
      user_id: string;
      username: string;
      display_name: string | null;
      has_pin: boolean;
      is_active: boolean;
      last_login: string | null;
    } | null> =>
      ipcRenderer.invoke('users:findByUsername', username),
    update: (userId: string, updates: {
      username?: string;
      display_name?: string | null;
    }): Promise<{
      user_id: string;
      username: string;
      display_name: string | null;
      has_pin: boolean;
      is_active: boolean;
      last_login: string | null;
    }> =>
      ipcRenderer.invoke('users:update', userId, updates),
    delete: (userId: string): Promise<void> =>
      ipcRenderer.invoke('users:delete', userId),
    // Authentication (Migration 24)
    verifyPin: (userId: string, pin: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('users:verifyPin', userId, pin),
    setPin: (userId: string, pin: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('users:setPin', userId, pin),
    clearPin: (userId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('users:clearPin', userId),
    hasPin: (userId: string): Promise<boolean> =>
      ipcRenderer.invoke('users:hasPin', userId),
    anyUserHasPin: (): Promise<boolean> =>
      ipcRenderer.invoke('users:anyUserHasPin'),
    updateLastLogin: (userId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('users:updateLastLogin', userId),
  },

  health: {
    getDashboard: (): Promise<unknown> =>
      ipcRenderer.invoke('health:getDashboard'),
    getStatus: (): Promise<unknown> =>
      ipcRenderer.invoke('health:getStatus'),
    runCheck: (): Promise<unknown> =>
      ipcRenderer.invoke('health:runCheck'),
    createBackup: (): Promise<unknown> =>
      ipcRenderer.invoke('health:createBackup'),
    getBackupStats: (): Promise<unknown> =>
      ipcRenderer.invoke('health:getBackupStats'),
    getDiskSpace: (): Promise<unknown> =>
      ipcRenderer.invoke('health:getDiskSpace'),
    checkIntegrity: (): Promise<unknown> =>
      ipcRenderer.invoke('health:checkIntegrity'),
    runMaintenance: (): Promise<unknown> =>
      ipcRenderer.invoke('health:runMaintenance'),
    getMaintenanceSchedule: (): Promise<unknown> =>
      ipcRenderer.invoke('health:getMaintenanceSchedule'),
    getRecoveryState: (): Promise<unknown> =>
      ipcRenderer.invoke('health:getRecoveryState'),
    attemptRecovery: (): Promise<unknown> =>
      ipcRenderer.invoke('health:attemptRecovery'),
  },

  // FIX 5.4: Backup status events (success/failure notifications)
  backup: {
    onStatus: (callback: (status: { success: boolean; message: string; timestamp: string; verified?: boolean }) => void) => {
      const listener = (_event: unknown, status: { success: boolean; message: string; timestamp: string; verified?: boolean }) => callback(status);
      ipcRenderer.on('backup:status', listener);
      return () => ipcRenderer.removeListener('backup:status', listener);
    },
  },

  browser: {
    navigate: (url: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('browser:navigate', url),
    show: (bounds: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('browser:show', bounds),
    hide: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('browser:hide'),
    getUrl: (): Promise<string> =>
      ipcRenderer.invoke('browser:getUrl'),
    getTitle: (): Promise<string> =>
      ipcRenderer.invoke('browser:getTitle'),
    goBack: (): Promise<boolean> =>
      ipcRenderer.invoke('browser:goBack'),
    goForward: (): Promise<boolean> =>
      ipcRenderer.invoke('browser:goForward'),
    reload: (): Promise<void> =>
      ipcRenderer.invoke('browser:reload'),
    captureScreenshot: (): Promise<string | null> =>
      ipcRenderer.invoke('browser:captureScreenshot'),
    onNavigated: (callback: (url: string) => void) => {
      const listener = (_event: unknown, url: string) => callback(url);
      ipcRenderer.on('browser:navigated', listener);
      return () => ipcRenderer.removeListener('browser:navigated', listener);
    },
    onTitleChanged: (callback: (title: string) => void) => {
      const listener = (_event: unknown, title: string) => callback(title);
      ipcRenderer.on('browser:titleChanged', listener);
      return () => ipcRenderer.removeListener('browser:titleChanged', listener);
    },
    onLoadingChanged: (callback: (loading: boolean) => void) => {
      const listener = (_event: unknown, loading: boolean) => callback(loading);
      ipcRenderer.on('browser:loadingChanged', listener);
      return () => ipcRenderer.removeListener('browser:loadingChanged', listener);
    },
  },

  // Research Browser - external Ungoogled Chromium
  research: {
    launch: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('research:launch'),
    close: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('research:close'),
    status: (): Promise<{ running: boolean; pages?: number }> =>
      ipcRenderer.invoke('research:status'),
  },

  // Import Intelligence - Smart location matching during import
  importIntelligence: {
    // Full scan for matches near GPS point
    scan: (
      lat: number,
      lng: number,
      hints?: { filename?: string; inferredType?: string; inferredState?: string }
    ): Promise<{
      scanned: { locations: number; sublocations: number; refmaps: number };
      matches: Array<{
        source: 'location' | 'sublocation' | 'refmap';
        id: string;
        name: string;
        type: string | null;
        state: string | null;
        distanceMeters: number;
        distanceFeet: number;
        confidence: number;
        confidenceLabel: string;
        reasons: string[];
        mediaCount?: number;
        heroThumbPath?: string | null;
        parentName?: string;
        mapName?: string;
      }>;
      scanTimeMs: number;
    }> => ipcRenderer.invoke('import-intelligence:scan', lat, lng, hints),

    // Quick check if GPS has nearby matches
    hasNearby: (lat: number, lng: number): Promise<{
      hasNearby: boolean;
      count: number;
      topMatch: {
        source: 'location' | 'sublocation' | 'refmap';
        id: string;
        name: string;
        confidence: number;
        distanceFeet: number;
      } | null;
    }> => ipcRenderer.invoke('import-intelligence:hasNearby', lat, lng),

    // Add AKA name to existing location
    addAkaName: (locid: string, newName: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('import-intelligence:addAkaName', locid, newName),
  },

};

contextBridge.exposeInMainWorld('electronAPI', api);

// ============================================
// Drag-Drop File Path Extraction
// ============================================
// File objects lose their native path backing when passed through contextBridge.
// Solution: Capture drop events in preload and extract paths using webUtils.

let lastDroppedPaths: string[] = [];

// Set up drop event listener after DOM is ready
const setupDropListener = () => {
  document.addEventListener('drop', (event: DragEvent) => {
    console.log('[Preload] Drop event captured');
    lastDroppedPaths = [];

    if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
      console.log('[Preload] No files in drop event');
      return;
    }

    console.log('[Preload] Processing', event.dataTransfer.files.length, 'dropped files');

    for (const file of Array.from(event.dataTransfer.files)) {
      try {
        const filePath = webUtils.getPathForFile(file);
        console.log('[Preload] Extracted path:', filePath, 'for file:', file.name);
        if (filePath) {
          lastDroppedPaths.push(filePath);
        }
      } catch (e) {
        console.error('[Preload] Failed to get path for file:', file.name, e);
      }
    }

    console.log('[Preload] Total paths extracted:', lastDroppedPaths.length);
  }, { capture: true });
};

// Wait for DOM to be ready before adding event listener
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupDropListener);
} else {
  setupDropListener();
}

// Expose function to retrieve the paths extracted from the last drop event
contextBridge.exposeInMainWorld('getDroppedFilePaths', (): string[] => {
  const paths = [...lastDroppedPaths];
  console.log('[Preload] getDroppedFilePaths called, returning', paths.length, 'paths');
  return paths;
});

// Also keep extractFilePaths for backwards compatibility
contextBridge.exposeInMainWorld('extractFilePaths', (files: FileList): string[] => {
  console.log('[Preload] extractFilePaths called');
  return [...lastDroppedPaths];
});

// Type is exported from a separate .d.ts file to avoid CJS compilation issues
// See: electron/preload/types.d.ts
