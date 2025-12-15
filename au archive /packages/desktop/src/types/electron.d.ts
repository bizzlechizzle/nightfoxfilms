import type {
  Location,
  LocationInput,
  LocationFilters,
  TimelineEvent,
  TimelineEventInput,
  TimelineEventWithSource,
  ParsedDate,
  DateExtraction,
  DateExtractionFilters,
  DatePatternInput,
  BackfillOptions,
  ExtractFromTextInput,
  DatePattern,
  DateEngineLearning,
  DateExtractionStats,
  DateEngineLearningStats,
} from '@au-archive/core';

/**
 * OPT-043: Lean location type for map display - only essential fields
 * Used by Atlas for 10x faster map loading (11 columns vs 60+, no JSON.parse)
 */
export interface MapLocation {
  locid: string;
  locnam: string;
  category?: string;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy?: number;
  gps_source?: string;
  gps_verified_on_map: boolean;
  address_state?: string;
  address_city?: string;
  favorite: boolean;
}

/**
 * User record type for authentication and user management
 */
export interface UserRecord {
  user_id: string;
  username: string;
  display_name: string | null;
  created_date: string;
  has_pin: boolean;
  is_active: boolean;
  last_login: string | null;
}

/**
 * Timeline event with all source references (LLM Tools Overhaul)
 */
export interface TimelineEventWithSources extends TimelineEvent {
  sources: Array<{
    source_id: string;
    source_type: string;
    domain: string | null;
    title: string | null;
    url: string | null;
  }>;
  has_conflicts: boolean;
  /** Image count for visit events (parsed from media_hashes) */
  image_count: number;
  /** Video count for visit events (parsed from media_hashes) */
  video_count: number;
  /** Location author (auth_imp) for database_entry events */
  location_author: string | null;
}

/**
 * Extracted address from web sources (LLM Tools Overhaul)
 */
export interface ExtractedAddress {
  address_id: string;
  locid: string;
  source_id: string;
  source_type: string;
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zipcode: string | null;
  full_address: string;
  confidence: number;
  context_sentence: string | null;
  verb_context: string | null;
  prompt_version: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  matches_location: number;
  suggested_corrections: Array<{
    field: string;
    currentValue: string | null;
    suggestedValue: string;
    reasoning: string;
    confidence: number;
  }> | null;
  created_at: string;
  applied_at: string | null;
  applied_by: string | null;
  // Joined from web_sources
  source_title?: string;
  source_url?: string;
  source_domain?: string;
}

export interface ElectronAPI {
  versions: {
    node: () => string;
    chrome: () => string;
    electron: () => string;
  };
  platform: string;

  locations: {
    findAll: (filters?: LocationFilters & {
      // OPT-036: Extended filters for database-side filtering
      censusRegion?: string;
      censusDivision?: string;
      culturalRegion?: string;
      city?: string;
      limit?: number;
      offset?: number;
    }) => Promise<Location[]>;
    findById: (id: string) => Promise<Location | null>;
    create: (input: LocationInput) => Promise<Location>;
    update: (id: string, input: Partial<LocationInput>) => Promise<Location>;
    delete: (id: string) => Promise<void>;
    count: (filters?: LocationFilters) => Promise<number>;
    random: () => Promise<Location | null>;
    undocumented: () => Promise<Location[]>;
    historical: () => Promise<Location[]>;
    favorites: () => Promise<Location[]>;
    toggleFavorite: (id: string) => Promise<boolean>;
    findNearby: (lat: number, lng: number, radiusKm: number) => Promise<Array<Location & { distance: number }>>;
    // OPT-037: Viewport-based spatial queries for Atlas
    findInBounds: (bounds: { north: number; south: number; east: number; west: number }) => Promise<Location[]>;
    countInBounds: (bounds: { north: number; south: number; east: number; west: number }) => Promise<number>;
    // OPT-043: Ultra-fast map query - lean MapLocation type (10x faster than findInBounds)
    findInBoundsForMap: (bounds: { north: number; south: number; east: number; west: number }) => Promise<MapLocation[]>;
    // OPT-036: Get all filter options in one efficient call
    getFilterOptions: () => Promise<{
      states: string[];
      categories: string[];
      classes: string[];
      cities: string[];
      counties: string[];
      censusRegions: string[];
      censusDivisions: string[];
      culturalRegions: string[];
    }>;
    // Kanye9: Check for duplicate locations by address
    checkDuplicates: (address: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    }) => Promise<Array<{
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
    }>>;
  };

  stats: {
    topStates: (limit?: number) => Promise<Array<{ state: string; count: number }>>;
    topCategories: (limit?: number) => Promise<Array<{ category: string; count: number }>>;
  };

  settings: {
    get: (key: string) => Promise<string | null>;
    getAll: () => Promise<Record<string, string>>;
    set: (key: string, value: string) => Promise<void>;
  };

  shell: {
    openExternal: (url: string) => Promise<void>;
  };

  geocode: {
    reverse: (lat: number, lng: number) => Promise<{
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
    } | null>;
    forward: (address: string) => Promise<{
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
    } | null>;
    // Kanye9: Cascade geocoding - tries multiple strategies until one succeeds
    forwardCascade: (address: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    }) => Promise<{
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
    } | null>;
    clearCache: (daysOld?: number) => Promise<{ deleted: number }>;
  };

  dialog: {
    selectFolder: () => Promise<string | null>;
  };

  database: {
    backup: () => Promise<{ success: boolean; path?: string; message?: string }>;
    restore: () => Promise<{ success: boolean; message: string; requiresRestart?: boolean; autoBackupPath?: string }>;
    getLocation: () => Promise<{
      currentPath: string;
      defaultPath: string;
      customPath: string | undefined;
      isCustom: boolean;
    }>;
    changeLocation: () => Promise<{
      success: boolean;
      message: string;
      newPath?: string;
      requiresRestart?: boolean;
    }>;
    resetLocation: () => Promise<{
      success: boolean;
      message: string;
      newPath?: string;
      requiresRestart?: boolean;
    }>;
    // Phase 2: Database stats and internal backup management
    getStats: () => Promise<{
      integrityOk: boolean;
      backupCount: number;
      lastBackup: string | null;
    }>;
    exportBackup: () => Promise<{ success: boolean; path?: string; message?: string }>;
    listBackups: () => Promise<{
      success: boolean;
      message?: string;
      backups: Array<{
        id: string;
        date: string;
        size: string;
        path: string;
      }>;
    }>;
    restoreFromInternal: (backupId: string) => Promise<{
      success: boolean;
      message: string;
      requiresRestart?: boolean;
      autoBackupPath?: string;
    }>;
    // Database Archive Export: Export to archive folder for portable backup
    archiveExport: () => Promise<{
      success: boolean;
      message: string;
      path?: string;
      size?: string;
      timestamp?: string;
    }>;
    archiveStatus: () => Promise<{
      configured: boolean;
      exported: boolean;
      verified: boolean;
      lastExport: {
        exportedAt: string;
        appVersion: string;
        locationCount: number;
        imageCount: number;
        videoCount: number;
        documentCount: number;
        mapCount: number;
        checksum: string;
      } | null;
    }>;
  };

  imports: {
    create: (input: {
      locid: string | null;
      auth_imp: string | null;
      img_count?: number;
      vid_count?: number;
      doc_count?: number;
      map_count?: number;
      notes?: string | null;
    }) => Promise<unknown>;
    findRecent: (limit?: number) => Promise<unknown[]>;
    findByLocation: (locid: string) => Promise<unknown[]>;
    findAll: () => Promise<unknown[]>;
    getTotalMediaCount: () => Promise<{ images: number; videos: number; documents: number; maps: number }>;
  };

  media: {
    // File selection and import
    selectFiles: () => Promise<string[] | null>;
    expandPaths: (paths: string[]) => Promise<string[]>;
    import: (input: {
      files: Array<{ filePath: string; originalName: string }>;
      locid: string;
      subid?: string | null;
      auth_imp: string | null;
      // Migration 26: Contributor tracking
      is_contributed?: number;
      contribution_source?: string | null;
      // OPT-058: Unified progress across chunks
      chunkOffset?: number;
      totalOverall?: number;
    }) => Promise<{
      total: number;
      imported: number;
      duplicates: number;
      skipped: number;
      sidecarOnly: number;
      errors: number;
      importId: string;
      results: Array<{
        success: boolean;
        hash: string;
        type: 'image' | 'video' | 'map' | 'document' | 'skipped' | 'sidecar';
        duplicate: boolean;
        skipped?: boolean;
        sidecarOnly?: boolean;
        archivePath?: string;
        error?: string;
        gpsWarning?: {
          message: string;
          distance: number;
          severity: 'minor' | 'major';
          locationGPS: { lat: number; lng: number };
          mediaGPS: { lat: number; lng: number };
        };
        warnings?: string[];
      }>;
    }>;
    phaseImport: (input: {
      files: Array<{ filePath: string; originalName: string }>;
      locid: string;
      subid?: string | null;
      auth_imp: string | null;
      verifyChecksums?: boolean;
    }) => Promise<{
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
    }>;
    onPhaseImportProgress: (callback: (progress: {
      importId: string;
      phase: 'log' | 'serialize' | 'copy' | 'dump' | 'complete';
      phaseProgress: number;
      currentFile?: string;
      filesProcessed: number;
      totalFiles: number;
    }) => void) => () => void;
    onImportProgress: (callback: (progress: { current: number; total: number; filename?: string; importId?: string }) => void) => () => void;
    cancelImport: (importId: string) => Promise<{ success: boolean; message: string }>;
    /**
     * OPT-094: Find media by location with optional sub-location filtering
     * @param params - Either locid string (backward compat) or object with locid and optional subid
     * - subid undefined: return all media (backward compatible)
     * - subid null: return only host location media
     * - subid string: return only that sub-location's media
     */
    findByLocation: (params: string | { locid: string; subid?: string | null }) => Promise<{
      images: unknown[];
      videos: unknown[];
      documents: unknown[];
      maps: unknown[]; // MAP-MEDIA-FIX-001
    }>;
    // OPT-039: Paginated image loading for scale
    // OPT-094: Added subid filtering support
    findImagesPaginated: (params: { locid: string; limit?: number; offset?: number; subid?: string | null }) => Promise<{
      images: unknown[];
      total: number;
      hasMore: boolean;
    }>;
    // Media viewing and processing
    openFile: (filePath: string) => Promise<{ success: boolean }>;
    generateThumbnail: (sourcePath: string, hash: string) => Promise<string | null>;
    extractPreview: (sourcePath: string, hash: string) => Promise<string | null>;
    generatePoster: (sourcePath: string, hash: string) => Promise<string | null>;
    getCached: (key: string) => Promise<string | null>;
    preload: (mediaList: Array<{ hash: string; path: string }>, currentIndex: number) => Promise<{ success: boolean }>;
    readXmp: (mediaPath: string) => Promise<{
      rating?: number;
      label?: string;
      keywords?: string[];
      title?: string;
      description?: string;
    } | null>;
    writeXmp: (mediaPath: string, data: {
      rating?: number;
      label?: string;
      keywords?: string[];
      title?: string;
      description?: string;
    }) => Promise<{ success: boolean }>;
    regenerateAllThumbnails: (options?: { force?: boolean }) => Promise<{ generated: number; failed: number; total: number; rawTotal?: number; previewsExtracted?: number; previewsFailed?: number }>;
    regenerateVideoThumbnails: (options?: { force?: boolean }) => Promise<{ generated: number; failed: number; total: number }>;
    regenerateDngPreviews: () => Promise<{ success: boolean; rendered: number; failed: number; total: number }>;
    // OPT-105: Backfill RAW preview paths from existing .previews/ directory
    backfillRawPreviews: () => Promise<{ fixed: number; notFound: number; total: number }>;

    // Location-specific media fixes
    fixLocationImages: (locid: string) => Promise<{ fixed: number; errors: number; total: number }>;
    fixLocationVideos: (locid: string) => Promise<{ fixed: number; errors: number; total: number }>;
    countUntaggedImages: (locid: string) => Promise<number>;

    // Video Proxy System (Migration 36, updated OPT-053 Immich Model)
    // Proxies generated at import time, stored alongside originals, permanent (no purge)
    generateProxy: (vidhash: string, sourcePath: string, metadata: { width: number; height: number }) => Promise<{
      success: boolean;
      proxyPath?: string;
      error?: string;
      proxyWidth?: number;
      proxyHeight?: number;
    }>;
    getProxyPath: (vidhash: string) => Promise<string | null>;
    // OPT-053: Fast filesystem check for proxy existence (no DB lookup)
    proxyExists: (videoPath: string, vidhash: string) => Promise<boolean>;
    getProxyCacheStats: () => Promise<{
      totalCount: number;
      totalSizeBytes: number;
      totalSizeMB: number;
      oldestAccess: string | null;
      newestAccess: string | null;
    }>;
    // OPT-053: DEPRECATED - Proxies are permanent, always returns empty result
    purgeOldProxies: (daysOld?: number) => Promise<{
      deleted: number;
      freedBytes: number;
      freedMB: number;
    }>;
    // OPT-053: DEPRECATED - Proxies are permanent, always returns empty result
    clearAllProxies: () => Promise<{
      deleted: number;
      freedBytes: number;
      freedMB: number;
    }>;
    // OPT-053: DEPRECATED - No last_accessed tracking, always returns 0
    touchLocationProxies: (locid: string) => Promise<number>;
    // For migration/repair of old imports
    generateProxiesForLocation: (locid: string) => Promise<{
      generated: number;
      failed: number;
      total: number;
    }>;
    onProxyProgress: (callback: (progress: {
      locid: string;
      generated: number;
      failed: number;
      total: number;
    }) => void) => () => void;
    // Delete and Move operations (for Lightbox actions)
    delete: (input: { hash: string; type: 'image' | 'video' | 'document' }) => Promise<{
      success: boolean;
      deletedFiles: string[];
      failedFiles: string[];
    }>;
    moveToSubLocation: (input: { hash: string; type: 'image' | 'video' | 'document'; subid: string | null }) => Promise<{
      success: boolean;
    }>;
    // Hide/Unhide media (Migration 23)
    setHidden: (input: {
      hash: string;
      type: 'image' | 'video' | 'document';
      hidden: boolean;
      reason?: string;
    }) => Promise<{ success: boolean }>;
  };

  notes: {
    create: (input: {
      locid: string;
      note_text: string;
      auth_imp?: string | null;
      note_type?: string;
    }) => Promise<unknown>;
    findById: (note_id: string) => Promise<unknown>;
    findByLocation: (locid: string) => Promise<unknown[]>;
    findRecent: (limit?: number) => Promise<unknown[]>;
    update: (note_id: string, updates: {
      note_text?: string;
      note_type?: string;
    }) => Promise<unknown>;
    delete: (note_id: string) => Promise<void>;
    countByLocation: (locid: string) => Promise<number>;
  };

  // Migration 28: Sub-location API
  // ADR-046: Updated to remove sub12 (subid is BLAKE3 16-char hash now)
  // Migration 31: Added GPS fields
  // Migration 32: Added akanam (historicalName removed)
  // Migration 65: Added class and getDistinctCategories/getDistinctClasses
  sublocations: {
    create: (input: {
      locid: string;
      subnam: string;
      ssubname?: string | null;
      category?: string | null;
      class?: string | null;
      status?: string | null;
      is_primary?: boolean;
      created_by?: string | null;
    }) => Promise<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      category: string | null;
      class: string | null;
      status: string | null;
      hero_imghash: string | null;
      hero_focal_x: number;
      hero_focal_y: number;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_accuracy: number | null;
      gps_source: string | null;
      gps_verified_on_map: boolean;
      gps_captured_at: string | null;
      akanam: string | null;
    }>;
    findById: (subid: string) => Promise<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      category: string | null;
      class: string | null;
      status: string | null;
      hero_imghash: string | null;
      hero_focal_x: number;
      hero_focal_y: number;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_accuracy: number | null;
      gps_source: string | null;
      gps_verified_on_map: boolean;
      gps_captured_at: string | null;
      akanam: string | null;
    } | null>;
    findByLocation: (locid: string) => Promise<Array<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      category: string | null;
      class: string | null;
      status: string | null;
      hero_imghash: string | null;
      hero_focal_x: number;
      hero_focal_y: number;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_accuracy: number | null;
      gps_source: string | null;
      gps_verified_on_map: boolean;
      gps_captured_at: string | null;
      akanam: string | null;
    }>>;
    findWithHeroImages: (locid: string) => Promise<Array<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      category: string | null;
      class: string | null;
      status: string | null;
      hero_imghash: string | null;
      hero_focal_x: number;
      hero_focal_y: number;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_accuracy: number | null;
      gps_source: string | null;
      gps_verified_on_map: boolean;
      gps_captured_at: string | null;
      akanam: string | null;
      hero_thumb_path?: string;
      asset_count?: number;
    }>>;
    update: (subid: string, updates: {
      subnam?: string;
      ssubname?: string | null;
      category?: string | null;
      class?: string | null;
      status?: string | null;
      hero_imghash?: string | null;
      hero_focal_x?: number;
      hero_focal_y?: number;
      is_primary?: boolean;
      modified_by?: string | null;
      akanam?: string | null;
    }) => Promise<{
      subid: string;
      locid: string;
      subnam: string;
      ssubname: string | null;
      category: string | null;
      class: string | null;
      status: string | null;
      hero_imghash: string | null;
      hero_focal_x: number;
      hero_focal_y: number;
      is_primary: boolean;
      created_date: string;
      created_by: string | null;
      modified_date: string | null;
      modified_by: string | null;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_accuracy: number | null;
      gps_source: string | null;
      gps_verified_on_map: boolean;
      gps_captured_at: string | null;
      akanam: string | null;
    } | null>;
    delete: (subid: string) => Promise<void>;
    setPrimary: (locid: string, subid: string) => Promise<void>;
    checkName: (locid: string, subnam: string, excludeSubid?: string) => Promise<boolean>;
    count: (locid: string) => Promise<number>;
    // Migration 31: Sub-location GPS
    updateGps: (subid: string, gps: { lat: number; lng: number; accuracy?: number | null; source: string }) => Promise<{
      subid: string;
      locid: string;
      subnam: string;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_accuracy: number | null;
      gps_source: string | null;
      gps_verified_on_map: boolean;
      gps_captured_at: string | null;
    } | null>;
    clearGps: (subid: string) => Promise<{ subid: string } | null>;
    verifyGps: (subid: string) => Promise<{ subid: string; gps_verified_on_map: boolean } | null>;
    findWithGps: (locid: string) => Promise<Array<{
      subid: string;
      locid: string;
      subnam: string;
      gps_lat: number | null;
      gps_lng: number | null;
      gps_verified_on_map: boolean;
    }>>;
    // Migration 65: Sub-location category/class (separate taxonomy from host locations)
    getDistinctCategories: () => Promise<string[]>;
    getDistinctClasses: () => Promise<string[]>;
  };

  projects: {
    create: (input: {
      project_name: string;
      description?: string | null;
      auth_imp?: string | null;
    }) => Promise<unknown>;
    findById: (project_id: string) => Promise<unknown>;
    findByIdWithLocations: (project_id: string) => Promise<unknown>;
    findAll: () => Promise<unknown[]>;
    findRecent: (limit?: number) => Promise<unknown[]>;
    findTopByLocationCount: (limit?: number) => Promise<unknown[]>;
    findByLocation: (locid: string) => Promise<unknown[]>;
    update: (project_id: string, updates: {
      project_name?: string;
      description?: string | null;
    }) => Promise<unknown>;
    delete: (project_id: string) => Promise<void>;
    addLocation: (project_id: string, locid: string) => Promise<void>;
    removeLocation: (project_id: string, locid: string) => Promise<void>;
    isLocationInProject: (project_id: string, locid: string) => Promise<boolean>;
  };

  users: {
    create: (input: {
      username: string;
      display_name?: string | null;
      pin?: string | null;
    }) => Promise<UserRecord>;
    findAll: () => Promise<UserRecord[]>;
    findById: (userId: string) => Promise<UserRecord>;
    findByUsername: (username: string) => Promise<UserRecord | null>;
    update: (userId: string, updates: { username?: string; display_name?: string | null }) => Promise<UserRecord>;
    delete: (userId: string) => Promise<void>;
    // Authentication (Migration 24)
    verifyPin: (userId: string, pin: string) => Promise<{ success: boolean; error?: string }>;
    setPin: (userId: string, pin: string) => Promise<{ success: boolean }>;
    clearPin: (userId: string) => Promise<{ success: boolean }>;
    hasPin: (userId: string) => Promise<boolean>;
    anyUserHasPin: () => Promise<boolean>;
    updateLastLogin: (userId: string) => Promise<{ success: boolean }>;
  };

  health: {
    getDashboard: () => Promise<unknown>;
    getStatus: () => Promise<unknown>;
    runCheck: () => Promise<unknown>;
    createBackup: () => Promise<unknown>;
    getBackupStats: () => Promise<unknown>;
    getDiskSpace: () => Promise<unknown>;
    checkIntegrity: () => Promise<unknown>;
    runMaintenance: () => Promise<unknown>;
    getMaintenanceSchedule: () => Promise<unknown>;
    getRecoveryState: () => Promise<unknown>;
    attemptRecovery: () => Promise<unknown>;
  };

  backup: {
    onStatus: (callback: (status: { success: boolean; message: string; timestamp: string; verified?: boolean }) => void) => () => void;
  };

  browser: {
    navigate: (url: string) => Promise<{ success: boolean }>;
    show: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>;
    hide: () => Promise<{ success: boolean }>;
    getUrl: () => Promise<string>;
    getTitle: () => Promise<string>;
    goBack: () => Promise<boolean>;
    goForward: () => Promise<boolean>;
    reload: () => Promise<void>;
    captureScreenshot: () => Promise<string | null>;
    onNavigated: (callback: (url: string) => void) => () => void;
    onTitleChanged: (callback: (title: string) => void) => () => void;
    onLoadingChanged: (callback: (loading: boolean) => void) => () => void;
  };

  // Reference Maps - imported KML, GPX, GeoJSON, CSV files
  refMaps: {
    // ADR-048: Now returns string[] (multi-select)
    selectFile: () => Promise<string[]>;
    // ADR-048: Batch import for multiple files
    importBatch: (filePaths: string[], importedBy?: string) => Promise<{
      success: boolean;
      results: Array<{
        filePath: string;
        fileName: string;
        success: boolean;
        error?: string;
        mapId?: string;
        pointCount?: number;
      }>;
      totalPoints: number;
      successCount: number;
      skippedCount: number;
      failedCount: number;
    }>;
    import: (importedBy?: string) => Promise<{
      success: boolean;
      canceled?: boolean;
      error?: string;
      map?: RefMap;
      pointCount?: number;
    }>;
    importFromPath: (filePath: string, importedBy?: string) => Promise<{
      success: boolean;
      error?: string;
      map?: RefMap;
      pointCount?: number;
    }>;
    findAll: () => Promise<RefMap[]>;
    findById: (mapId: string) => Promise<RefMapWithPoints | null>;
    getAllPoints: () => Promise<RefMapPoint[]>;
    // OPT-037: Viewport-based spatial query for reference points
    getPointsInBounds: (bounds: { north: number; south: number; east: number; west: number }) => Promise<RefMapPoint[]>;
    update: (mapId: string, updates: { mapName?: string }) => Promise<RefMap | null>;
    delete: (mapId: string) => Promise<{ success: boolean; error?: string }>;
    getStats: () => Promise<{
      mapCount: number;
      pointCount: number;
      categories: string[];
      states: string[];
    }>;
    getSupportedExtensions: () => Promise<string[]>;
    // Phase 2: Auto-matching for location creation
    findMatches: (query: string, options?: {
      threshold?: number;
      limit?: number;
      state?: string | null;
    }) => Promise<RefMapMatch[]>;
    // Phase 3: Deduplication on import
    previewImport: (filePath: string) => Promise<ImportPreviewResult>;
    importWithOptions: (filePath: string, options: {
      skipDuplicates: boolean;
      importedBy?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      skippedAll?: boolean;
      message?: string;
      map?: RefMap;
      pointCount?: number;
      skippedCount?: number;
    }>;
    // Phase 4: Purge catalogued points
    findCataloguedPoints: () => Promise<{
      success: boolean;
      error?: string;
      matches: CataloguedPointMatch[];
      count: number;
    }>;
    purgeCataloguedPoints: () => Promise<{
      success: boolean;
      deleted: number;
      error?: string;
      message?: string;
    }>;
    // Phase 5: Delete single point from map popup
    deletePoint: (pointId: string) => Promise<{
      success: boolean;
      deleted?: number;
      error?: string;
    }>;
    // Migration 39: GPS-based deduplication within ref_map_points
    previewDedup: () => Promise<{
      success: boolean;
      error?: string;
      stats?: {
        totalPoints: number;
        uniqueLocations: number;
        duplicateGroups: number;
        pointsRemoved: number;
        pointsWithAka: number;
      };
      groups?: Array<{
        lat: number;
        lng: number;
        bestName: string | null;
        akaNames: string | null;
        pointCount: number;
        allNames: string[];
      }>;
    }>;
    deduplicate: () => Promise<{
      success: boolean;
      error?: string;
      stats?: {
        totalPoints: number;
        uniqueLocations: number;
        duplicateGroups: number;
        pointsRemoved: number;
        pointsWithAka: number;
      };
    }>;
    // Migration 42: GPS enrichment - apply ref point GPS to existing location
    applyEnrichment: (input: { locationId: string; refPointId: string }) => Promise<{
      success: boolean;
      error?: string;
      appliedGps?: { lat: number; lng: number };
      state?: string | null;
    }>;
    applyAllEnrichments: (enrichments: Array<{
      locationId: string;
      refPointId: string;
      nameSimilarity: number;
    }>) => Promise<{
      success: boolean;
      applied: number;
      skipped?: number;
      error?: string;
      message?: string;
    }>;
  };

  // Import Intelligence - Smart location matching during import
  importIntelligence: {
    scan: (
      lat: number,
      lng: number,
      hints?: { filename?: string; inferredType?: string; inferredState?: string },
      excludeRefPointId?: string | null
    ) => Promise<IntelligenceScanResult>;
    hasNearby: (lat: number, lng: number) => Promise<{
      hasNearby: boolean;
      count: number;
      topMatch: IntelligenceMatch | null;
    }>;
    addAkaName: (locid: string, newName: string) => Promise<{ success: boolean }>;
  };

  // Storage monitoring
  storage: {
    getStats: () => Promise<StorageStats>;
  };

  // BagIt Self-Documenting Archive (RFC 8493)
  bagit: {
    regenerate: (locid: string) => Promise<{ success: boolean }>;
    validate: (locid: string) => Promise<BagValidationResult>;
    validateAll: () => Promise<IntegrityCheckResult>;
    status: (locid: string) => Promise<BagStatus>;
    summary: () => Promise<BagStatusSummary>;
    lastValidation: () => Promise<string | null>;
    isValidationDue: () => Promise<boolean>;
    scheduleValidation: () => Promise<{ success: boolean; error?: string }>;
    onProgress: (callback: (progress: BagIntegrityProgress) => void) => () => void;
  };

  // Import System v2.0 - 5-step pipeline with background jobs
  importV2: {
    start: (input: ImportV2Input) => Promise<ImportV2Result>;
    cancel: (sessionId: string) => Promise<{ cancelled: boolean; reason?: string }>;
    status: () => Promise<{ sessionId: string | null; status: ImportV2Status }>;
    resumable: () => Promise<ResumableSession[]>;
    resume: (sessionId: string) => Promise<ImportV2Result | null>;
    onProgress: (callback: (progress: ImportV2Progress) => void) => () => void;
    onComplete: (callback: (result: ImportV2CompleteEvent) => void) => () => void;
  };

  // Background Job Queue - manages post-import processing
  jobs: {
    status: () => Promise<Record<string, JobQueueStats>>;
    deadLetter: (queue?: string) => Promise<DeadLetterEntry[]>;
    retry: (input: { deadLetterId: number }) => Promise<{ success: boolean; newJobId: string | null }>;
    acknowledge: (ids: number[]) => Promise<{ acknowledged: number }>;
    clearCompleted: (olderThanMs?: number) => Promise<{ cleared: number }>;
    onProgress: (callback: (progress: JobProgress) => void) => () => void;
    onAssetReady: (callback: (event: AssetReadyEvent) => void) => () => void;
  };

  // Timeline (Migration 69) - Location history and visit tracking
  timeline: {
    findByLocation: (locid: string) => Promise<TimelineEvent[]>;
    findBySubLocation: (locid: string, subid: string) => Promise<TimelineEvent[]>;
    findCombined: (locid: string) => Promise<TimelineEventWithSource[]>;
    parseDate: (input: string) => Promise<ParsedDate>;
    create: (input: TimelineEventInput, userId?: string) => Promise<TimelineEvent>;
    update: (eventId: string, updates: Partial<TimelineEventInput>, userId?: string) => Promise<TimelineEvent | undefined>;
    delete: (eventId: string) => Promise<boolean>;
    approve: (eventId: string, userId: string) => Promise<TimelineEvent | undefined>;
    initializeLocation: (locid: string, locadd: string | null, userId?: string) => Promise<void>;
    initializeSubLocation: (locid: string, subid: string, userId?: string) => Promise<void>;
    getVisitCount: (locid: string) => Promise<number>;
    getEstablished: (locid: string, subid?: string | null) => Promise<TimelineEvent | undefined>;
    updateEstablished: (locid: string, subid: string | null, dateInput: string, eventSubtype?: string, userId?: string) => Promise<TimelineEvent | undefined>;
    // OPT-119: Web page timeline events
    createWebPageEvent: (locid: string, subid: string | null, websourceId: string, publishDate: string, title: string | null, userId?: string) => Promise<TimelineEvent | undefined>;
    deleteWebPageEvent: (websourceId: string) => Promise<number>;
    hasWebPageEvent: (websourceId: string) => Promise<boolean>;
    getMediaCounts: (mediaHashesJson: string | null) => Promise<{ images: number; videos: number }>;
    backfillWebPages: () => Promise<{ processed: number; created: number; skipped: number; errors: number }>;
    // Multi-source timeline (LLM Tools Overhaul)
    findByLocationWithSources: (locid: string) => Promise<TimelineEventWithSources[]>;
    getSources: (eventId: string) => Promise<{
      success: boolean;
      sources: Array<{
        source_id: string;
        source_type: string;
        domain: string | null;
        title: string | null;
        url: string | null;
        extracted_date: string | null;
        extracted_text: string | null;
      }>;
      error?: string;
    }>;
    addSource: (eventId: string, sourceId: string) => Promise<{ success: boolean; error?: string }>;
    reject: (eventId: string, userId?: string) => Promise<{ success: boolean; error?: string }>;
    getCounts: (locid: string) => Promise<{ total: number; needsReview: number; approved: number }>;
  };

  // Date Engine - Migration 73 (NLP date extraction from web sources)
  dateEngine: {
    // Extraction
    extractFromWebSource: (sourceId: string) => Promise<DateExtraction[]>;
    extractFromText: (input: ExtractFromTextInput) => Promise<DateExtraction[]>;
    preview: (text: string, articleDate?: string) => Promise<Array<{
      rawText: string;
      parsedDate: string | null;
      dateStart: string | null;
      dateEnd: string | null;
      datePrecision: string;
      dateDisplay: string | null;
      sentence: string;
      category: string;
      categoryConfidence: number;
      overallConfidence: number;
      wasRelativeDate: boolean;
    }>>;

    // Backfill
    backfillWebSources: (options?: BackfillOptions) => Promise<{
      processed: number;
      total: number;
      extractions_found: number;
      errors: number;
    }>;
    backfillImageCaptions: (options?: BackfillOptions) => Promise<{
      processed: number;
      total: number;
      extractions_found: number;
      errors: number;
    }>;

    // Query
    getPendingReview: (limit?: number, offset?: number) => Promise<DateExtraction[]>;
    getPendingByLocation: (locid: string) => Promise<DateExtraction[]>;
    getByLocation: (locid: string, filters?: Partial<DateExtractionFilters>) => Promise<DateExtraction[]>;
    getConflicts: () => Promise<DateExtraction[]>;
    getById: (extractionId: string) => Promise<DateExtraction | null>;
    find: (filters: DateExtractionFilters) => Promise<DateExtraction[]>;

    // Review Actions
    approve: (extractionId: string, userId: string) => Promise<DateExtraction | null>;
    reject: (extractionId: string, userId: string, reason?: string) => Promise<DateExtraction | null>;
    approveAndResolveConflict: (extractionId: string, userId: string, updateTimeline: boolean) => Promise<DateExtraction | null>;
    convertToTimeline: (extractionId: string, userId?: string) => Promise<DateExtraction | null>;
    revert: (extractionId: string, userId: string) => Promise<DateExtraction | null>;
    mergeDuplicates: (primaryId: string, duplicateId: string) => Promise<DateExtraction | null>;

    // Statistics
    getStats: () => Promise<DateExtractionStats>;
    getLearningStats: () => Promise<DateEngineLearningStats>;

    // CSV Export/Import
    exportPending: () => Promise<string>;
    importReviewed: (csvContent: string, userId: string) => Promise<{
      imported: number;
      approved: number;
      rejected: number;
      errors: number;
    }>;

    // Custom Patterns
    getPatterns: (enabledOnly?: boolean) => Promise<DatePattern[]>;
    getPattern: (patternId: string) => Promise<DatePattern | null>;
    savePattern: (patternId: string | null, input: DatePatternInput) => Promise<DatePattern>;
    deletePattern: (patternId: string) => Promise<void>;
    testPattern: (pattern: string, testText: string) => Promise<{
      valid: boolean;
      matches: Array<{
        fullMatch: string;
        groups: Record<string, string>;
        index: number;
      }>;
      error?: string;
    }>;

    // OCR Document Extraction
    extractFromDocument: (input: {
      imagePath: string;
      locid?: string | null;
      subid?: string | null;
      language?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      ocrText?: string;
      ocrConfidence?: number;
      ocrWordCount?: number;
      ocrProcessingTimeMs?: number;
      extractionsFound?: number;
      extractions?: DateExtraction[];
    }>;
  };

  // Document Intelligence Extraction - Multi-provider extraction system
  extraction: {
    // Main extraction
    extract: (input: {
      text: string;
      sourceType: 'web_source' | 'document' | 'note' | 'media_caption';
      sourceId: string;
      locid?: string;
      subid?: string;
      extractTypes?: Array<'dates' | 'people' | 'organizations' | 'locations' | 'summary' | 'title'>;
      articleDate?: string;
      locationName?: string;
      options?: {
        preferProvider?: string;
        needsSummary?: boolean;
        needsTitle?: boolean;
        minConfidence?: number;
        maxRetries?: number;
      };
    }) => Promise<{
      success: boolean;
      result?: {
        provider: string;
        model: string;
        dates: Array<{
          rawText: string;
          parsedDate: string | null;
          parsedDateEnd?: string | null;
          precision: 'exact' | 'month' | 'year' | 'decade' | 'approximate' | 'range';
          category: 'build_date' | 'opening' | 'closure' | 'demolition' | 'visit' | 'publication' | 'renovation' | 'event' | 'unknown';
          confidence: number;
          context: string;
          isApproximate: boolean;
        }>;
        people: Array<{
          name: string;
          role: 'owner' | 'architect' | 'developer' | 'employee' | 'founder' | 'visitor' | 'photographer' | 'historian' | 'unknown';
          mentions: string[];
          confidence: number;
        }>;
        organizations: Array<{
          name: string;
          type: 'company' | 'government' | 'school' | 'hospital' | 'church' | 'nonprofit' | 'military' | 'unknown';
          mentions: string[];
          confidence: number;
        }>;
        locations: Array<{
          name: string;
          type: 'city' | 'state' | 'country' | 'address' | 'landmark' | 'region' | 'neighborhood' | 'unknown';
          confidence: number;
        }>;
        summaryData?: {
          title: string;
          summary: string;
          keyFacts: string[];
          confidence: number;
        };
        processingTimeMs: number;
        warnings?: string[];
        providerId: string;
      };
      error?: string;
    }>;
    extractFromWebSource: (sourceId: string, options?: {
      preferProvider?: string;
      needsSummary?: boolean;
      needsTitle?: boolean;
      minConfidence?: number;
      maxRetries?: number;
    }) => Promise<{
      success: boolean;
      result?: {
        provider: string;
        model: string;
        dates: Array<{
          rawText: string;
          parsedDate: string | null;
          precision: string;
          category: string;
          confidence: number;
          context: string;
          isApproximate: boolean;
        }>;
        people: Array<{ name: string; role: string; mentions: string[]; confidence: number }>;
        organizations: Array<{ name: string; type: string; mentions: string[]; confidence: number }>;
        locations: Array<{ name: string; type: string; confidence: number }>;
        summaryData?: { title: string; summary: string; keyFacts: string[]; confidence: number };
        processingTimeMs: number;
        providerId: string;
      };
      error?: string;
    }>;
    extractBatch: (request: {
      items: Array<{
        text: string;
        sourceType: 'web_source' | 'document' | 'note' | 'media_caption';
        sourceId: string;
        locid?: string;
        subid?: string;
      }>;
      options?: { preferProvider?: string; needsSummary?: boolean };
      parallel?: boolean;
      concurrency?: number;
    }) => Promise<{
      success: boolean;
      result?: {
        total: number;
        successful: number;
        failed: number;
        results: Record<string, unknown>;
        totalTimeMs: number;
      };
      error?: string;
    }>;

    // Provider management
    getProviders: () => Promise<{
      success: boolean;
      providers?: Array<{
        id: string;
        name: string;
        type: 'spacy' | 'ollama' | 'anthropic' | 'google' | 'openai';
        enabled: boolean;
        priority: number;
        settings: {
          host?: string;
          port?: number;
          model?: string;
          executablePath?: string;
          timeout?: number;
          temperature?: number;
          maxTokens?: number;
        };
      }>;
      error?: string;
    }>;
    getProviderStatuses: () => Promise<{
      success: boolean;
      statuses?: Array<{
        id: string;
        available: boolean;
        lastCheck: string;
        lastError?: string;
        responseTimeMs?: number;
        modelInfo?: { name: string; size?: string; quantization?: string };
      }>;
      error?: string;
    }>;
    updateProvider: (providerId: string, updates: {
      name?: string;
      enabled?: boolean;
      priority?: number;
      settings?: {
        host?: string;
        port?: number;
        model?: string;
        timeout?: number;
        temperature?: number;
        maxTokens?: number;
      };
    }) => Promise<{ success: boolean; config?: unknown; error?: string }>;
    addProvider: (config: {
      id: string;
      name: string;
      type: 'spacy' | 'ollama' | 'anthropic' | 'google' | 'openai';
      enabled: boolean;
      priority: number;
      settings: {
        host?: string;
        port?: number;
        model?: string;
        executablePath?: string;
        timeout?: number;
      };
    }) => Promise<{ success: boolean; error?: string }>;
    removeProvider: (providerId: string) => Promise<{ success: boolean; error?: string }>;
    testProvider: (providerId: string, testText?: string) => Promise<{
      success: boolean;
      result?: {
        dates: Array<{ rawText: string; parsedDate: string | null; confidence: number }>;
        people: Array<{ name: string; confidence: number }>;
        processingTimeMs: number;
      };
      error?: string;
    }>;

    // Health & diagnostics
    healthCheck: () => Promise<{
      success: boolean;
      health?: {
        healthy: boolean;
        providers: Array<{ id: string; available: boolean; lastError?: string }>;
        system: { ollamaAvailable: boolean; spacyAvailable: boolean; memoryUsage: number };
      };
      error?: string;
    }>;

    // Ollama-specific
    testOllamaConnection: (host?: string, port?: number) => Promise<{
      success: boolean;
      result?: {
        connected: boolean;
        responseTimeMs: number;
        ollamaVersion?: string;
        availableModels: string[];
        configuredModelAvailable: boolean;
        error?: string;
      };
      error?: string;
    }>;
    listOllamaModels: (host?: string, port?: number) => Promise<{
      success: boolean;
      models?: Array<{ name: string; size: number }>;
      error?: string;
    }>;
    pullOllamaModel: (modelName: string, host?: string, port?: number) => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;

    // Queue management (OPT-120)
    queue: {
      start: () => Promise<{ success: boolean; error?: string }>;
      stop: () => Promise<{ success: boolean; error?: string }>;
      enqueue: (
        sourceType: 'web_source' | 'document' | 'media',
        sourceId: string,
        locid: string | null,
        tasks?: string[],
        priority?: number
      ) => Promise<{ success: boolean; queueId?: string; error?: string }>;
      status: () => Promise<{
        success: boolean;
        status?: {
          running: boolean;
          activeJobs: number;
          pending: number;
          completed: number;
          failed: number;
        };
        error?: string;
      }>;
      cleanup: (olderThanDays?: number) => Promise<{ success: boolean; cleaned?: number; error?: string }>;
    };

    // Auto-tagger (OPT-120)
    tagger: {
      detectTags: (text: string, buildYear?: number | string | null) => Promise<{
        success: boolean;
        result?: {
          locationType: string | null;
          era: string | null;
          status: string | null;
          confidence: {
            locationType: number;
            era: number;
            status: number;
          };
        };
        error?: string;
      }>;
      tagLocation: (locid: string) => Promise<{
        success: boolean;
        result?: {
          locationType: string | null;
          era: string | null;
          status: string | null;
          confidence: { locationType: number; era: number; status: number };
        };
        error?: string;
      }>;
      tagAllUntagged: () => Promise<{
        success: boolean;
        result?: { tagged: number; failed: number };
        error?: string;
      }>;
    };

    // Entity queries (OPT-120)
    entities: {
      getByLocation: (locid: string) => Promise<{
        success: boolean;
        entities?: Array<{
          extraction_id: string;
          entity_type: 'person' | 'organization';
          entity_name: string;
          entity_role: string | null;
          date_range: string | null;
          confidence: number;
          context_sentence: string | null;
          status: 'approved' | 'pending' | 'rejected';
          created_at: string;
        }>;
        error?: string;
      }>;
      updateStatus: (extractionId: string, status: 'approved' | 'rejected' | 'pending') => Promise<{
        success: boolean;
        error?: string;
      }>;
    };

    // Preprocessing (NEW - Phase 5)
    preprocess: {
      analyze: (text: string, articleDate?: string, maxSentences?: number) => Promise<{
        success: boolean;
        result?: {
          sentences: Array<{
            text: string;
            index: number;
            entities: Array<{ text: string; label: string; start: number; end: number }>;
            verbs: Array<{ text: string; category: string; lemma: string }>;
            relevancy: { isTimelineRelevant: boolean; score: number; reasons: string[] };
            dateRefs: Array<{ text: string; normalizedDate: string | null; precision: string }>;
          }>;
          profileCandidates: {
            people: Array<{ name: string; normalizedName: string; mentions: number; roles: string[]; sentences: number[] }>;
            organizations: Array<{ name: string; normalizedName: string; mentions: number; types: string[]; sentences: number[] }>;
          };
          documentStats: {
            totalSentences: number;
            totalWords: number;
            timelineRelevantSentences: number;
            entityCounts: Record<string, number>;
            verbCounts: Record<string, number>;
          };
        };
        error?: string;
      }>;
      isAvailable: () => Promise<{ success: boolean; available: boolean; error?: string }>;
      getVerbCategories: () => Promise<{
        success: boolean;
        categories?: Array<{ category: string; verbs: string[]; description: string }>;
        error?: string;
      }>;
    };

    // People Profiles (NEW - Phase 6)
    profiles: {
      people: {
        getByLocation: (locid: string) => Promise<{
          success: boolean;
          profiles?: PersonProfile[];
          error?: string;
        }>;
        search: (query: string) => Promise<{
          success: boolean;
          results?: PersonProfile[];
          error?: string;
        }>;
        updateStatus: (personId: string, status: 'verified' | 'pending' | 'rejected') => Promise<{
          success: boolean;
          error?: string;
        }>;
      };
      companies: {
        getByLocation: (locid: string) => Promise<{
          success: boolean;
          profiles?: CompanyProfile[];
          error?: string;
        }>;
        search: (query: string) => Promise<{
          success: boolean;
          results?: CompanyProfile[];
          error?: string;
        }>;
        updateStatus: (companyId: string, status: 'verified' | 'pending' | 'rejected') => Promise<{
          success: boolean;
          error?: string;
        }>;
      };
    };

    // Fact Conflicts (NEW - Phase 7)
    conflicts: {
      getByLocation: (locid: string, includeResolved?: boolean) => Promise<{
        success: boolean;
        conflicts?: FactConflict[];
        error?: string;
      }>;
      getSummary: (locid: string) => Promise<{
        success: boolean;
        summary?: ConflictSummary;
        error?: string;
      }>;
      resolve: (
        conflictId: string,
        resolution: 'source_a' | 'source_b' | 'both_valid' | 'neither' | 'merged',
        resolvedValue: string | null,
        userId: string,
        notes?: string
      ) => Promise<{
        success: boolean;
        error?: string;
      }>;
      detect: (locid: string) => Promise<{
        success: boolean;
        result?: { totalConflicts: number; newConflicts: number; existingConflicts: number };
        error?: string;
      }>;
      suggestResolution: (conflictId: string) => Promise<{
        success: boolean;
        suggestion?: {
          recommendedResolution: 'source_a' | 'source_b' | 'both_valid' | 'neither' | 'merged';
          confidence: number;
          reasoning: string;
          suggestedValue: string | null;
        };
        error?: string;
      }>;
      getSourceAuthorities: () => Promise<{
        success: boolean;
        authorities?: Array<{ domain: string; tier: number; notes: string | null }>;
        error?: string;
      }>;
      updateSourceAuthority: (domain: string, tier: number, notes?: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };

    // Timeline Deduplication (NEW - Phase 8)
    timelineMerge: {
      deduplicate: (locid: string) => Promise<{
        success: boolean;
        result?: { merged: number; eventsRemaining: number };
        error?: string;
      }>;
      getMergeConfig: () => Promise<{
        success: boolean;
        config?: {
          maxDateDifferencesDays: number;
          minConfidence: number;
          datePreference: 'older' | 'newer' | 'higher_precision';
          mergeDescriptions: boolean;
        };
        error?: string;
      }>;
      updateMergeConfig: (config: {
        maxDateDifferencesDays?: number;
        minConfidence?: number;
        datePreference?: 'older' | 'newer' | 'higher_precision';
        mergeDescriptions?: boolean;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };

    // Versioned Prompts (NEW - Phase 4)
    prompts: {
      getSummary: () => Promise<{
        success: boolean;
        summary?: {
          types: Array<{
            type: string;
            versions: string[];
            defaultVersion: string;
            activeCount: number;
          }>;
          totalPrompts: number;
        };
        error?: string;
      }>;
      getVersions: (promptType: string) => Promise<{
        success: boolean;
        versions?: Array<{
          version: string;
          description: string;
          isDefault: boolean;
          isOllamaOptimized: boolean;
        }>;
        error?: string;
      }>;
      setDefault: (promptType: string, version: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };

    // Extracted Addresses (LLM Tools Overhaul)
    addresses: {
      getByLocation: (locid: string, includeRejected?: boolean) => Promise<{
        success: boolean;
        addresses?: ExtractedAddress[];
        error?: string;
      }>;
      apply: (addressId: string, userId?: string) => Promise<{ success: boolean; error?: string }>;
      reject: (addressId: string, userId?: string) => Promise<{ success: boolean; error?: string }>;
      approve: (addressId: string, userId?: string) => Promise<{ success: boolean; error?: string }>;
      count: (locid: string) => Promise<{
        success: boolean;
        counts?: { total: number; pending: number; approved: number; applied: number };
        error?: string;
      }>;
      save: (
        locid: string,
        sourceId: string,
        addresses: Array<{
          street?: string | null;
          city?: string | null;
          county?: string | null;
          state?: string | null;
          zipcode?: string | null;
          fullAddress: string;
          confidence: number;
          contextSentence?: string;
          isLocationAddress?: boolean;
          verbContext?: string;
        }>,
        corrections?: Array<{
          field: string;
          currentValue?: string | null;
          suggestedValue: string;
          reasoning: string;
          confidence: number;
        }>
      ) => Promise<{ success: boolean; savedCount?: number; error?: string }>;
    };

    // Research Counts (LLM Tools Overhaul - conditional visibility)
    research: {
      getCounts: (locid: string) => Promise<{
        success: boolean;
        counts: {
          timeline: number;
          people: number;
          companies: number;
          addresses: number;
          total: number;
        };
        error?: string;
      }>;
    };
  };

  // Image Downloader - Migration 72 (pHash, URL patterns, staging)
  downloader: {
    // URL Pattern Transformation
    transformUrl: (url: string) => Promise<{
      success: boolean;
      results?: Array<{
        transformedUrl: string;
        patternId: string;
        patternName: string;
        confidence: number;
      }>;
      error?: string;
    }>;
    addPattern: (pattern: {
      name: string;
      siteType: 'wordpress' | 'cdn' | 'image_host' | 'custom';
      matchRegex: string;
      transformTemplate: string;
      priority?: number;
    }) => Promise<{ success: boolean; patternId?: string; error?: string }>;
    getPatterns: () => Promise<{
      success: boolean;
      patterns?: Array<{
        patternId: string;
        name: string;
        siteType: string;
        matchRegex: string;
        transformTemplate: string;
        priority: number;
        successCount: number;
        failureCount: number;
        confidence: number;
        enabled: boolean;
      }>;
      error?: string;
    }>;

    // URL Validation
    validateUrl: (url: string) => Promise<{
      success: boolean;
      validation?: {
        url: string;
        exists: boolean;
        isImage: boolean;
        contentType: string | null;
        contentLength: number | null;
        redirectUrl: string | null;
        headers: Record<string, string>;
      };
      error?: string;
    }>;
    validateUrls: (urls: string[]) => Promise<{
      success: boolean;
      results?: Array<{
        url: string;
        exists: boolean;
        isImage: boolean;
        contentType: string | null;
        contentLength: number | null;
      }>;
      error?: string;
    }>;
    findBestUrl: (input: {
      candidates: Array<{ url: string; confidence: number }>;
    }) => Promise<{
      success: boolean;
      best?: { url: string; confidence: number } | null;
      error?: string;
    }>;

    // Smart Image Enhance (recursive suffix stripping to find TRUE originals)
    enhanceUrl: (input: {
      url: string;
      options?: {
        maxCandidates?: number;
        headTimeout?: number;
        preferTraditionalFormats?: boolean;
        maxDepth?: number;
        validate?: boolean;
      };
    }) => Promise<{
      success: boolean;
      originalUrl?: string;
      bestUrl?: string;
      bestSize?: number;
      improvement?: number;
      candidateCount?: number;
      validCount?: number;
      error?: string;
    }>;
    enhanceUrls: (input: {
      urls: string[];
      options?: {
        maxCandidates?: number;
        headTimeout?: number;
        preferTraditionalFormats?: boolean;
        maxDepth?: number;
        validate?: boolean;
      };
    }) => Promise<{
      success: boolean;
      results?: Array<{
        originalUrl: string;
        bestUrl: string;
        bestSize: number;
        improvement: number;
      }>;
      error?: string;
    }>;

    // Perceptual Hashing
    hashFile: (filePath: string) => Promise<{
      success: boolean;
      hash?: string;
      width?: number;
      height?: number;
      format?: string;
      error?: string;
    }>;
    pHashDistance: (hash1: string, hash2: string) => Promise<{
      success: boolean;
      distance?: number;
      similar?: boolean;
      error?: string;
    }>;
    findSimilar: (input: {
      phash: string;
      threshold?: number;
      limit?: number;
    }) => Promise<{
      success: boolean;
      similar?: Array<{
        imghash: string;
        phash: string;
        distance: number;
        imgloc: string;
      }>;
      error?: string;
    }>;
    checkDuplicate: (phash: string) => Promise<{
      success: boolean;
      isDuplicate?: boolean;
      duplicate?: {
        imghash: string;
        phash: string;
        distance: number;
        imgloc: string;
      } | null;
      error?: string;
    }>;

    // pHash Backfill
    getBackfillStatus: () => Promise<{
      success: boolean;
      needsBackfill?: number;
      total?: number;
      percentComplete?: number;
      error?: string;
    }>;
    runBackfill: (options?: { batchSize?: number }) => Promise<{
      success: boolean;
      processed?: number;
      errors?: number;
      skipped?: number;
      durationMs?: number;
      error?: string;
    }>;
    startBackgroundBackfill: () => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;

    // Download Orchestration
    processImages: (input: {
      images: Array<{
        url: string;
        alt?: string;
        srcset?: string[];
        width?: number;
        height?: number;
        context?: {
          parentElement?: string;
          caption?: string;
          linkUrl?: string;
        };
      }>;
      pageUrl: string;
      options?: {
        minWidth?: number;
        minHeight?: number;
        maxImages?: number;
        skipThumbnails?: boolean;
        checkDuplicates?: boolean;
        duplicateThreshold?: number;
      };
    }) => Promise<{
      success: boolean;
      result?: {
        pageUrl: string;
        images: Array<{
          originalUrl: string;
          selectedUrl: string | null;
          staged: {
            stagingId: string;
            url: string;
            localPath: string;
            blake3Hash: string;
            phash: string;
            width: number;
            height: number;
            format: string;
            fileSize: number;
          } | null;
          existingDuplicate: {
            imghash: string;
            phash: string;
            distance: number;
          } | null;
          candidateCount: number;
          stagedCount: number;
          status: 'staged' | 'duplicate' | 'failed' | 'skipped';
          error?: string;
        }>;
        totalDiscovered: number;
        totalStaged: number;
        totalDuplicates: number;
        totalFailed: number;
        durationMs: number;
      };
      error?: string;
    }>;
    importStaged: (input: {
      stagingId: string;
      locationId: string;
    }) => Promise<{
      success: boolean;
      imghash?: string;
      finalPath?: string;
      error?: string;
    }>;
    getPageHistory: (pageUrl: string) => Promise<{
      success: boolean;
      history?: Array<{
        sourceId: string;
        sourceUrl: string;
        pageUrl: string;
        siteDomain: string;
        status: string;
      }>;
      error?: string;
    }>;
    getPending: () => Promise<{
      success: boolean;
      pending?: Array<{
        sourceId: string;
        sourceUrl: string;
        pageUrl: string;
        siteDomain: string;
        status: string;
      }>;
      error?: string;
    }>;
    getStagingStats: () => Promise<{
      success: boolean;
      stats?: {
        totalStaged: number;
        totalSize: number;
        groups: number;
      };
      error?: string;
    }>;
    cleanupStaging: (maxAgeHours?: number) => Promise<{
      success: boolean;
      deleted?: number;
      error?: string;
    }>;

    // Event listeners
    onBackfillProgress: (callback: (progress: {
      current: number;
      total: number;
      currentFile: string;
      processed: number;
      errors: number;
    }) => void) => () => void;
    onProcessProgress: (callback: (progress: {
      stage: string;
      current: number;
      total: number;
    }) => void) => () => void;
    onImageFound: (callback: (data: { url: string }) => void) => () => void;
    onImageStaged: (callback: (staged: {
      stagingId: string;
      url: string;
      localPath: string;
      blake3Hash: string;
      phash: string;
      width: number;
      height: number;
      format: string;
      fileSize: number;
    }) => void) => () => void;
    onEnhanceProgress: (callback: (progress: {
      current: number;
      total: number;
      url: string;
      bestUrl: string;
      improvement: number;
    }) => void) => () => void;
    onQualityProgress: (callback: (progress: {
      current: number;
      total: number;
      url: string;
      score: number;
      rank: number;
    }) => void) => () => void;

    // Image Source Discovery
    discoverSources: (input: {
      html: string;
      pageUrl: string;
    }) => Promise<{
      success: boolean;
      pageUrl?: string;
      title?: string;
      totalSources?: number;
      groups?: number;
      sources?: Array<{
        url: string;
        width?: number;
        height?: number;
        sourceType: 'img' | 'srcset' | 'picture' | 'background' | 'meta' | 'data-attr' | 'link';
        confidence: number;
        context?: {
          nearbyText?: string;
          parentElement?: string;
        };
      }>;
      imageGroups?: Array<{
        bestUrl: string;
        sourceCount: number;
        description?: string;
      }>;
      error?: string;
    }>;
    applySitePatterns: (url: string) => Promise<{
      success: boolean;
      originalUrl?: string;
      candidates?: Array<{
        url: string;
        confidence: number;
        source?: string;
      }>;
      error?: string;
    }>;
    parseSrcset: (input: {
      srcset: string;
      baseUrl: string;
    }) => Promise<{
      success: boolean;
      entries?: Array<{
        url: string;
        width?: number;
        density?: number;
        descriptor?: string;
      }>;
      bestEntry?: {
        url: string;
        width?: number;
        density?: number;
        descriptor?: string;
      } | null;
      error?: string;
    }>;
    findBestImages: (input: {
      html: string;
      pageUrl: string;
      options?: {
        maxImages?: number;
        minWidth?: number;
        validateAll?: boolean;
        preferFormats?: string[];
      };
    }) => Promise<{
      success: boolean;
      pageUrl?: string;
      title?: string;
      totalDiscovered?: number;
      results?: Array<{
        url: string;
        size: number;
        improvement: number;
        sourceType: string;
        originalUrl: string;
      }>;
      error?: string;
    }>;
    onFindProgress: (callback: (progress: {
      stage: 'discovering' | 'enhancing' | 'ranking';
      current: number;
      total: number;
    }) => void) => () => void;

    // Image Quality Analysis
    getDimensions: (input: {
      url: string;
      full?: boolean;
      timeout?: number;
    }) => Promise<{
      success: boolean;
      width?: number;
      height?: number;
      megapixels?: number;
      aspectRatio?: number;
      orientation?: 'landscape' | 'portrait' | 'square';
      fileSize?: number;
      format?: string;
      error?: string;
    }>;
    analyzeJpegQuality: (url: string) => Promise<{
      success: boolean;
      estimatedQuality?: number;
      isRecompressed?: boolean;
      confidence?: number;
      quantizationAverage?: number;
      hasSubsampling?: boolean;
      colorSpace?: string;
      error?: string;
    }>;
    detectWatermark: (url: string) => Promise<{
      success: boolean;
      hasWatermark?: boolean;
      confidence?: number;
      watermarkType?: 'none' | 'corner' | 'overlay' | 'text' | 'pattern';
      affectedArea?: number;
      watermarkRegions?: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      error?: string;
    }>;
    analyzeQuality: (input: {
      url: string;
      timeout?: number;
    }) => Promise<{
      success: boolean;
      report?: {
        url: string;
        dimensions: {
          width: number;
          height: number;
          megapixels: number;
          aspectRatio: number;
          orientation: 'landscape' | 'portrait' | 'square';
        };
        jpegQuality?: {
          estimatedQuality: number;
          isRecompressed: boolean;
          confidence: number;
        };
        watermark: {
          hasWatermark: boolean;
          confidence: number;
          watermarkType: 'none' | 'corner' | 'overlay' | 'text' | 'pattern';
        };
        format: string;
        fileSize: number;
        qualityScore: number;
        recommendation: 'excellent' | 'good' | 'acceptable' | 'poor' | 'avoid';
      };
      error?: string;
    }>;
    rankByQuality: (input: {
      urls: string[];
      concurrency?: number;
      timeout?: number;
    }) => Promise<{
      success: boolean;
      results?: Array<{
        url: string;
        rank: number;
        qualityScore: number;
        recommendation: 'excellent' | 'good' | 'acceptable' | 'poor' | 'avoid';
        dimensions: {
          width: number;
          height: number;
          megapixels: number;
        };
        format: string;
        fileSize: number;
        hasWatermark: boolean;
        jpegQuality?: number;
      }>;
      error?: string;
    }>;
    similarityHash: (url: string) => Promise<{
      success: boolean;
      hash?: string;
      error?: string;
    }>;
    findSimilarByHash: (input: {
      targetUrl: string;
      candidateUrls: string[];
      threshold?: number;
      limit?: number;
    }) => Promise<{
      success: boolean;
      similar?: Array<{
        url: string;
        hash: string;
        distance: number;
        similarity: number;
      }>;
      count?: number;
      error?: string;
    }>;

    // Browser Image Capture
    getCapturedImages: (pageUrl?: string) => Promise<{
      success: boolean;
      images?: Array<{
        url: string;
        sourceUrl: string;
        captureType: 'context_menu' | 'network' | 'xhr' | 'page_scan';
        contentType?: string;
        contentLength?: number;
        timestamp: number;
      }>;
      count?: number;
      error?: string;
    }>;
    clearCapturedImages: (maxAgeHours?: number) => Promise<{
      success: boolean;
      cleared?: number | 'all';
      error?: string;
    }>;

    // Context Menu Events (from right-click on images in research browser)
    onFindOriginal: (callback: (data: {
      imageUrl: string;
      pageUrl: string;
      timestamp: number;
    }) => void) => () => void;
    onAnalyzeQuality: (callback: (data: {
      imageUrl: string;
      timestamp: number;
    }) => void) => () => void;
    onSaveToArchive: (callback: (data: {
      imageUrl: string;
      pageUrl: string;
      timestamp: number;
    }) => void) => () => void;
  };

  // OPT-109: Web Sources Archiving (replacement for bookmarks)
  websources: {
    // Core CRUD
    create: (input: WebSourceInput) => Promise<WebSource>;
    findById: (sourceId: string) => Promise<WebSource | null>;
    findByUrl: (url: string) => Promise<WebSource | null>;
    findByLocation: (locid: string) => Promise<WebSource[]>;
    findBySubLocation: (subid: string) => Promise<WebSource[]>;
    findByStatus: (status: WebSourceStatus) => Promise<WebSource[]>;
    findPendingForArchive: (limit?: number) => Promise<WebSource[]>;
    findRecent: (limit?: number) => Promise<WebSource[]>;
    findAll: () => Promise<WebSource[]>;
    update: (sourceId: string, updates: WebSourceUpdate) => Promise<WebSource>;
    delete: (sourceId: string) => Promise<void>;

    // Archive Status Management
    markArchiving: (sourceId: string) => Promise<void>;
    markComplete: (sourceId: string, options: ArchiveCompleteOptions) => Promise<void>;
    markPartial: (sourceId: string, componentStatus: ComponentStatus, archivePath: string) => Promise<void>;
    markFailed: (sourceId: string, error: string) => Promise<void>;
    resetToPending: (sourceId: string) => Promise<void>;
    updateComponentStatus: (sourceId: string, componentStatus: ComponentStatus) => Promise<void>;

    // Version Management
    createVersion: (sourceId: string, options: VersionOptions) => Promise<WebSourceVersion>;
    findVersions: (sourceId: string) => Promise<WebSourceVersion[]>;
    findVersionByNumber: (sourceId: string, versionNumber: number) => Promise<WebSourceVersion | null>;
    findLatestVersion: (sourceId: string) => Promise<WebSourceVersion | null>;
    countVersions: (sourceId: string) => Promise<number>;

    // Full-Text Search
    search: (query: string, options?: SearchOptions) => Promise<WebSource[]>;

    // Statistics
    getStats: () => Promise<WebSourceStats>;
    getStatsByLocation: (locid: string) => Promise<WebSourceStats>;
    count: () => Promise<number>;
    countByLocation: (locid: string) => Promise<number>;
    countBySubLocation: (subid: string) => Promise<number>;
    // OPT-113: Pending counts for Archive All buttons
    countPending: () => Promise<number>;
    countPendingByLocation: (locid: string) => Promise<number>;

    // Migration
    migrateFromBookmarks: () => Promise<{ migrated: number; failed: number }>;

    // Orchestrator (Archive Operations)
    archive: (sourceId: string, options?: ArchiveOptions) => Promise<ArchiveResult>;
    archivePending: (limit?: number, options?: ArchiveOptions) => Promise<ArchiveResult[]>;
    rearchive: (sourceId: string, options?: ArchiveOptions) => Promise<ArchiveResult>;
    cancelArchive: () => Promise<void>;
    archiveStatus: () => Promise<{ isProcessing: boolean; currentSourceId: string | null }>;
    // OPT-113: Batch archive all pending sources
    archiveAllPending: (limit?: number) => Promise<{ queued: number; total: number }>;
    archivePendingByLocation: (locid: string, limit?: number) => Promise<{ queued: number; total: number }>;

    // OPT-111: Enhanced Metadata Access
    getImages: (sourceId: string) => Promise<WebSourceImage[]>;
    getVideos: (sourceId: string) => Promise<WebSourceVideo[]>;
    getDetail: (sourceId: string) => Promise<WebSourceDetail | null>;

    // OPT-113: Event listener for archive completion
    onArchiveComplete: (callback: (result: { sourceId: string; success: boolean; error?: string }) => void) => () => void;

    // FIX: Event listener for web source saved (from browser extension)
    onWebSourceSaved: (callback: (payload: { sourceId: string; locid: string | null; subid: string | null; sourceType: string }) => void) => () => void;
  };

  // Migration 76: RAM++ Image Auto-Tagging
  tagging: {
    // Image tag operations
    getImageTags: (imghash: string) => Promise<{
      success: boolean;
      imghash?: string;
      tags?: string[];
      source?: string | null;
      confidence?: Record<string, number> | null;
      taggedAt?: string | null;
      qualityScore?: number | null;
      viewType?: string | null;
      error?: string;
    }>;
    editImageTags: (input: { imghash: string; tags: string[] }) => Promise<{
      success: boolean;
      imghash?: string;
      tags?: string[];
      error?: string;
    }>;
    retagImage: (imghash: string) => Promise<{
      success: boolean;
      imghash?: string;
      message?: string;
      error?: string;
    }>;
    clearImageTags: (imghash: string) => Promise<{
      success: boolean;
      imghash?: string;
      error?: string;
    }>;

    // Location tag summary
    getLocationSummary: (locid: string) => Promise<{
      success: boolean;
      summary?: LocationTagSummary | null;
      error?: string;
    }>;
    reaggregateLocation: (locid: string) => Promise<{
      success: boolean;
      summary?: LocationTagSummary | null;
      error?: string;
    }>;
    applySuggestions: (input: {
      locid: string;
      typeThreshold?: number;
      eraThreshold?: number;
      overwrite?: boolean;
    }) => Promise<{
      success: boolean;
      typeApplied?: boolean;
      eraApplied?: boolean;
      error?: string;
    }>;

    // Queue management
    getQueueStats: () => Promise<{
      success: boolean;
      stats?: {
        pending: number;
        processing: number;
        completed: number;
        failed: number;
      };
      error?: string;
    }>;
    queueUntaggedImages: (locid: string) => Promise<{
      success: boolean;
      queued?: number;
      total?: number;
      error?: string;
    }>;

    // Service status
    getServiceStatus: () => Promise<{
      success: boolean;
      status: {
        available: boolean;
        mode: 'api' | 'local' | 'mock' | 'none';
        apiUrl?: string;
        lastCheck?: string;
        error?: string;
      };
      error?: string;
    }>;
    testConnection: () => Promise<{
      success: boolean;
      mode?: string;
      message?: string;
      error?: string;
    }>;

    // Event listeners for real-time tag updates
    onTagsReady: (callback: (data: {
      hash: string;
      tags: string[];
      viewType?: string;
      qualityScore?: number;
      suggestedType?: string | null;
    }) => void) => () => void;
    onLocationAggregated: (callback: (data: {
      locid: string;
      taggedImages: number;
      totalImages: number;
      dominantTags: string[];
      suggestedType: string | null;
      typeApplied: boolean;
      eraApplied: boolean;
    }) => void) => () => void;
  };

  // OPT-125: Ollama Lifecycle Management
  ollama: {
    getStatus: () => Promise<OllamaStatus>;
    ensureRunning: () => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    checkInstalled: () => Promise<{ installed: boolean; path?: string }>;
  };

  // Credential Management (Migration 85)
  credentials: {
    store: (provider: CredentialProvider, apiKey: string) => Promise<{
      success: boolean;
      error?: string;
      testFailed?: boolean;
      autoEnabled?: boolean;
      responseTimeMs?: number;
    }>;
    has: (provider: CredentialProvider) => Promise<{ success: boolean; hasKey: boolean; error?: string }>;
    delete: (provider: CredentialProvider) => Promise<{ success: boolean; error?: string }>;
    list: () => Promise<{ success: boolean; providers: CredentialProvider[]; error?: string }>;
    info: (provider: CredentialProvider) => Promise<{
      success: boolean;
      info: { exists: boolean; createdAt?: string; lastUsedAt?: string } | null;
      error?: string;
    }>;
    test: (provider: CredentialProvider) => Promise<{
      success: boolean;
      error?: string;
      responseTimeMs?: number;
    }>;
  };

  // LiteLLM Proxy Gateway (Migration 86)
  litellm: {
    status: () => Promise<LiteLLMStatus>;
    start: () => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    reload: () => Promise<{ success: boolean; error?: string }>;
    test: (modelId: string) => Promise<LiteLLMTestResult>;
    costs: () => Promise<LiteLLMCosts>;
    models: () => Promise<LiteLLMModel[]>;
    settings: {
      get: () => Promise<LiteLLMSettings>;
      set: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
    };
    privacy: {
      get: () => Promise<PrivacySettings>;
      update: (updates: Partial<PrivacySettings>) => Promise<{ success: boolean; error?: string }>;
    };
  };

  // Cost Tracking (Migration 88)
  costs: {
    record: (input: RecordCostInput) => Promise<{ success: boolean; entry?: CostEntry; error?: string }>;
    getSummary: (startDate?: string, endDate?: string) => Promise<{ success: boolean; summary?: CostSummary; error?: string }>;
    getDailyCosts: (days?: number) => Promise<{ success: boolean; costs?: DailyCost[]; error?: string }>;
    getCurrentMonth: () => Promise<{ success: boolean; cost?: number; error?: string }>;
    checkBudget: (monthlyBudget: number) => Promise<{
      success: boolean;
      exceeded?: boolean;
      current?: number;
      budget?: number;
      percentUsed?: number;
      error?: string;
    }>;
    getLocationCosts: (locid: string) => Promise<{ success: boolean; costs?: CostEntry[]; error?: string }>;
    getRecent: (limit?: number) => Promise<{ success: boolean; entries?: CostEntry[]; error?: string }>;
    getModelPricing: (model: string) => Promise<{
      success: boolean;
      pricing?: { input: number; output: number; isDefault: boolean };
      error?: string;
    }>;
    cleanup: (olderThanDays?: number) => Promise<{ success: boolean; deleted?: number; error?: string }>;
  };

}

// Migration 76: Location Tag Summary type
export interface LocationTagSummary {
  locid: string;
  dominantTags: string[];
  tagCounts: Record<string, number>;
  suggestedType: string | null;
  suggestedTypeConfidence: number | null;
  suggestedEra: string | null;
  suggestedEraConfidence: number | null;
  totalImages: number;
  taggedImages: number;
  interiorCount: number;
  exteriorCount: number;
  aerialCount: number;
  hasGraffiti: boolean;
  hasEquipment: boolean;
  hasDecay: boolean;
  hasNatureReclaim: boolean;
  conditionScore: number;
  bestHeroImghash: string | null;
  bestHeroScore: number | null;
}

// Reference Map types
export interface RefMap {
  mapId: string;
  mapName: string;
  filePath: string;
  fileType: string;
  pointCount: number;
  importedAt: string;
  importedBy: string | null;
}

export interface RefMapPoint {
  pointId: string;
  mapId: string;
  name: string | null;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  rawMetadata: Record<string, unknown> | null;
}

export interface RefMapWithPoints extends RefMap {
  points: RefMapPoint[];
}

// Phase 2: Auto-matching result
export interface RefMapMatch {
  pointId: string;
  mapId: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  mapName: string;
  score: number;
}

// Phase 3: Import preview with deduplication
export interface ImportPreviewResult {
  success: boolean;
  error?: string;
  fileName?: string;
  filePath?: string;
  fileType?: string;
  totalPoints?: number;
  newPoints?: number;
  // Migration 42: Enrichment opportunities (existing location has no GPS, ref point has GPS)
  enrichmentCount?: number;
  enrichmentOpportunities?: EnrichmentMatchPreview[];
  // Already catalogued (existing location has GPS)
  cataloguedCount?: number;
  cataloguedMatches?: DuplicateMatchPreview[];
  referenceCount?: number;
  referenceMatches?: DuplicateMatchPreview[];
}

// Migration 42: Enrichment opportunity - can apply GPS to existing location
export interface EnrichmentMatchPreview {
  type: 'catalogued';
  matchType: 'name_state' | 'exact_name';
  newPointName: string;
  newPointLat: number;
  newPointLng: number;
  newPointState?: string | null;
  existingName: string;
  existingId: string;
  existingState?: string;
  existingHasGps: false;
  nameSimilarity?: number;
  needsConfirmation: boolean;
  pointIndex?: number; // Index in parsed points array, used for import
}

export interface DuplicateMatchPreview {
  type: 'catalogued' | 'reference';
  matchType?: 'gps' | 'name_gps' | 'name_state' | 'exact_name';
  newPointName: string;
  newPointLat?: number;
  newPointLng?: number;
  newPointState?: string | null;
  existingName: string;
  existingId: string;
  existingState?: string;
  existingHasGps?: boolean;
  nameSimilarity?: number;
  distanceMeters?: number;
  mapName?: string;
  needsConfirmation?: boolean;
}

// Phase 4: Catalogued point match for purging
export interface CataloguedPointMatch {
  pointId: string;
  pointName: string;
  mapName: string;
  matchedLocid: string;
  matchedLocName: string;
  nameSimilarity: number;
  distanceMeters: number;
}

// Import Intelligence types
export interface IntelligenceMatch {
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
  parentName?: string;  // For sub-locations
  mapName?: string;     // For reference map points
}

export interface IntelligenceScanResult {
  scanned: {
    locations: number;
    sublocations: number;
    refmaps: number;
  };
  matches: IntelligenceMatch[];
  scanTimeMs: number;
}

// Storage types
export interface StorageStats {
  archivePath: string;
  archiveBytes: number;
  freeBytes: number;
  totalBytes: number;
  usedPercent: number;
  driveLetter?: string;
}

// BagIt Self-Documenting Archive types (RFC 8493)
export type BagStatusType = 'none' | 'valid' | 'complete' | 'incomplete' | 'invalid';

export interface BagStatus {
  bag_status: BagStatusType | null;
  bag_last_verified: string | null;
  bag_last_error: string | null;
}

export interface BagValidationResult {
  status: BagStatusType;
  error?: string;
  missingFiles?: string[];
  checksumErrors?: string[];
  payloadOxum?: { bytes: number; count: number };
}

export interface IntegrityCheckResult {
  totalLocations: number;
  validCount: number;
  incompleteCount: number;
  invalidCount: number;
  noneCount: number;
  errors: Array<{ locid: string; locnam: string; error: string }>;
  durationMs: number;
}

export interface BagStatusSummary {
  valid: number;
  incomplete: number;
  invalid: number;
  none: number;
}

export interface BagIntegrityProgress {
  current: number;
  total: number;
  currentLocation: string;
  status: 'running' | 'complete' | 'error';
}

// Import System v2.0 types
export type ImportV2Status =
  | 'pending'
  | 'scanning'
  | 'hashing'
  | 'copying'
  | 'validating'
  | 'finalizing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ImportV2Input {
  paths: string[];
  locid: string;
  loc12: string;
  address_state: string | null;
  type: string | null;
  slocnam: string | null;
  // Extended fields for full UI integration
  subid?: string | null;
  auth_imp?: string | null;
  is_contributed?: number;
  contribution_source?: string | null;
}

export interface ImportV2Progress {
  sessionId: string;
  status: ImportV2Status;
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
}

export interface ImportV2Result {
  sessionId: string;
  status: ImportV2Status;
  scanResult?: {
    totalFiles: number;
    totalBytes: number;
  };
  hashResult?: {
    totalDuplicates: number;
    totalErrors: number;
  };
  copyResult?: {
    totalBytes: number;
    totalErrors: number;
  };
  validationResult?: {
    totalInvalid: number;
  };
  finalizationResult?: {
    totalFinalized: number;
    totalErrors: number;
    jobsQueued: number;
  };
  error?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs: number;
}

export interface ImportV2CompleteEvent {
  sessionId: string;
  status: ImportV2Status;
  totalImported: number;
  totalDuplicates: number;
  totalErrors: number;
  totalDurationMs: number;
  jobsQueued: number;
}

export interface ResumableSession {
  sessionId: string;
  locid: string;
  status: ImportV2Status;
  lastStep: number;
  startedAt: string;  // ISO string for IPC serialization
  totalFiles: number;
  processedFiles: number;
}

// Background Job Queue types
export interface JobQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface DeadLetterEntry {
  id: number;
  originalJobId: string;
  queue: string;
  payload: unknown;
  error: string;
  failedAt: string;
  acknowledged: boolean;
}

export interface JobProgress {
  queue: string;
  jobId: string;
  progress: number;
  message?: string;
}

export interface AssetReadyEvent {
  type: 'thumbnail' | 'metadata' | 'proxy';
  hash: string;
  paths?: { sm: string; lg: string; preview?: string };
  mediaType?: string;
  metadata?: unknown;
  proxyPath?: string;
}

// =============================================================================
// OPT-109: Web Sources Types
// =============================================================================

export type WebSourceStatus = 'pending' | 'archiving' | 'complete' | 'partial' | 'failed';
export type WebSourceType = 'article' | 'gallery' | 'video' | 'social' | 'map' | 'document' | 'archive' | 'other';
export type ComponentState = 'pending' | 'done' | 'failed' | 'skipped';

export interface ComponentStatus {
  screenshot?: ComponentState;
  pdf?: ComponentState;
  html?: ComponentState;
  warc?: ComponentState;
  images?: ComponentState;
  videos?: ComponentState;
  text?: ComponentState;
}

export interface WebSource {
  source_id: string;
  url: string;
  title: string | null;
  locid: string | null;
  subid: string | null;
  source_type: WebSourceType;
  status: WebSourceStatus;
  component_status: ComponentStatus;
  extracted_title: string | null;
  extracted_author: string | null;
  extracted_date: string | null;
  extracted_publisher: string | null;
  word_count: number;
  image_count: number;
  video_count: number;
  archive_path: string | null;
  screenshot_path: string | null;
  pdf_path: string | null;
  html_path: string | null;
  warc_path: string | null;
  screenshot_hash: string | null;
  pdf_hash: string | null;
  html_hash: string | null;
  warc_hash: string | null;
  content_hash: string | null;
  provenance_hash: string | null;
  domain: string | null;
  canonical_url: string | null;
  notes: string | null;
  archive_error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  auth_imp: string | null;
}

export interface WebSourceInput {
  url: string;
  title?: string | null;
  locid?: string | null;
  subid?: string | null;
  source_type?: WebSourceType;
  notes?: string | null;
  auth_imp?: string | null;
}

export interface WebSourceUpdate {
  title?: string | null;
  locid?: string | null;
  subid?: string | null;
  source_type?: WebSourceType;
  notes?: string | null;
  status?: WebSourceStatus;
  component_status?: ComponentStatus;
  extracted_title?: string | null;
  extracted_author?: string | null;
  extracted_date?: string | null;
  extracted_publisher?: string | null;
  word_count?: number;
  image_count?: number;
  video_count?: number;
  archive_path?: string | null;
  screenshot_path?: string | null;
  pdf_path?: string | null;
  html_path?: string | null;
  warc_path?: string | null;
  screenshot_hash?: string | null;
  pdf_hash?: string | null;
  html_hash?: string | null;
  warc_hash?: string | null;
  content_hash?: string | null;
  provenance_hash?: string | null;
  archive_error?: string | null;
  retry_count?: number;
  archived_at?: string | null;
}

export interface ArchiveCompleteOptions {
  archive_path: string;
  screenshot_path?: string | null;
  pdf_path?: string | null;
  html_path?: string | null;
  warc_path?: string | null;
  screenshot_hash?: string | null;
  pdf_hash?: string | null;
  html_hash?: string | null;
  warc_hash?: string | null;
  content_hash?: string | null;
  extracted_title?: string | null;
  extracted_author?: string | null;
  extracted_date?: string | null;
  word_count?: number;
  image_count?: number;
  video_count?: number;
}

export interface VersionOptions {
  archive_path: string;
  screenshot_hash?: string | null;
  pdf_hash?: string | null;
  html_hash?: string | null;
  warc_hash?: string | null;
  content_hash?: string | null;
  notes?: string | null;
}

export interface WebSourceVersion {
  version_id: string;
  source_id: string;
  version_number: number;
  archive_path: string;
  screenshot_hash: string | null;
  pdf_hash: string | null;
  html_hash: string | null;
  warc_hash: string | null;
  content_hash: string | null;
  notes: string | null;
  created_at: string;
}

export interface SearchOptions {
  status?: WebSourceStatus;
  locid?: string;
  limit?: number;
}

export interface WebSourceStats {
  total: number;
  byStatus: Record<WebSourceStatus, number>;
  byType: Record<WebSourceType, number>;
  totalImages: number;
  totalVideos: number;
  totalWords: number;
}

export interface ArchiveOptions {
  captureScreenshot?: boolean;
  capturePdf?: boolean;
  captureHtml?: boolean;
  captureWarc?: boolean;
  extractImages?: boolean;
  extractVideos?: boolean;
  extractText?: boolean;
  linkMedia?: boolean;
  timeout?: number;
  maxImages?: number;
  maxVideos?: number;
}

export interface ArchiveResult {
  success: boolean;
  sourceId: string;
  url: string;
  archivePath: string | null;
  screenshotPath: string | null;
  pdfPath: string | null;
  htmlPath: string | null;
  warcPath: string | null;
  extractedImages: number;
  extractedVideos: number;
  wordCount: number;
  error?: string;
  duration: number;
}

export interface WebSourceImage {
  image_id: string;
  source_id: string;
  url: string;
  local_path: string | null;
  hash: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  original_filename: string | null;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  attribution: string | null;
  srcset_variants: string | null;
  context_html: string | null;
  link_url: string | null;
  exif_json: string | null;
  is_hi_res: boolean;
  is_hero: boolean;
  created_at: string;
}

export interface WebSourceVideo {
  video_id: string;
  source_id: string;
  url: string;
  local_path: string | null;
  hash: string | null;
  title: string | null;
  description: string | null;
  duration: number | null;
  size: number | null;
  platform: string | null;
  uploader: string | null;
  uploader_url: string | null;
  upload_date: string | null;
  view_count: number | null;
  like_count: number | null;
  tags_json: string | null;
  categories_json: string | null;
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface WebSourceDetail extends WebSource {
  images: WebSourceImage[];
  videos: WebSourceVideo[];
  links: string[];
  pageMetadata: {
    openGraph?: Record<string, string>;
    schemaOrg?: unknown[];
    dublinCore?: Record<string, string>;
    twitterCards?: Record<string, string>;
    meta?: Record<string, string>;
  } | null;
}

// =============================================================================
// Profile Types (NEW - Phase 6)
// =============================================================================

export type ProfileStatus = 'verified' | 'pending' | 'rejected';

export interface PersonProfile {
  person_id: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  birth_year: number | null;
  death_year: number | null;
  bio: string | null;
  roles: string[];
  photo_url: string | null;
  social_links: {
    wikipedia?: string;
    findagrave?: string;
    linkedin?: string;
    twitter?: string;
    other?: string[];
  } | null;
  status: ProfileStatus;
  source_refs: string[];
  key_facts: string[];
  created_at: string;
  updated_at: string | null;
  // Cross-location references
  location_refs?: Array<{
    locid: string;
    locnam: string;
    role: string;
    date_range: string | null;
  }>;
}

export interface CompanyProfile {
  company_id: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  founded_year: number | null;
  dissolved_year: number | null;
  description: string | null;
  industry: string | null;
  company_type: 'company' | 'government' | 'school' | 'hospital' | 'church' | 'nonprofit' | 'military' | 'unknown';
  logo_url: string | null;
  website: string | null;
  social_links: {
    wikipedia?: string;
    linkedin?: string;
    crunchbase?: string;
    other?: string[];
  } | null;
  status: ProfileStatus;
  source_refs: string[];
  key_facts: string[];
  created_at: string;
  updated_at: string | null;
  // Cross-location references
  location_refs?: Array<{
    locid: string;
    locnam: string;
    relationship: string;
    date_range: string | null;
  }>;
  // Parent/subsidiary relationships
  parent_company_id: string | null;
  parent_company_name: string | null;
}

// =============================================================================
// Conflict Types (NEW - Phase 7)
// =============================================================================

export type ConflictType = 'date' | 'name' | 'fact' | 'attribution' | 'location';
export type ConflictResolution = 'source_a' | 'source_b' | 'both_valid' | 'neither' | 'merged';

export interface ConflictClaim {
  value: string;
  source_ref: string;
  source_type: string;
  source_domain: string | null;
  confidence: number;
  extracted_at: string;
}

export interface FactConflict {
  conflict_id: string;
  locid: string;
  conflict_type: ConflictType;
  field_name: string;
  claim_a: ConflictClaim;
  claim_b: ConflictClaim;
  resolution: ConflictResolution | null;
  resolved_value: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  auto_resolution_attempted: boolean;
  created_at: string;
}

export interface ConflictSummary {
  locid: string;
  totalConflicts: number;
  unresolvedConflicts: number;
  resolvedConflicts: number;
  byType: Record<ConflictType, number>;
  byResolution: Record<ConflictResolution, number>;
  oldestUnresolved: string | null;
  mostRecentResolved: string | null;
}

// =============================================================================
// CREDENTIAL MANAGEMENT (Migration 85)
// =============================================================================

export type CredentialProvider = 'anthropic' | 'openai' | 'google' | 'groq';

export interface CredentialInfo {
  exists: boolean;
  createdAt?: string;
  lastUsedAt?: string;
}

// =============================================================================
// OLLAMA LIFECYCLE (OPT-125)
// =============================================================================

export interface OllamaStatus {
  running: boolean;
  installed: boolean;
  path?: string;
  version?: string;
  models?: string[];
  error?: string;
}

// =============================================================================
// LITELLM PROXY GATEWAY (Migration 86)
// =============================================================================

export interface LiteLLMStatus {
  running: boolean;
  port: number;
  pid?: number;
  uptime?: number;
  lastStarted?: string;
  error?: string;
}

export interface LiteLLMTestResult {
  success: boolean;
  modelId: string;
  responseTimeMs?: number;
  tokensUsed?: number;
  error?: string;
}

export interface LiteLLMCosts {
  totalCost: number;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
  period: { start: string; end: string };
}

export interface LiteLLMModel {
  id: string;
  name: string;
  provider: string;
  available: boolean;
  costPerToken?: { input: number; output: number };
}

export interface LiteLLMSettings {
  defaultModel: string;
  autoStart: boolean;
  idleTimeoutMinutes: number;
  maxConcurrent: number;
  logLevel: 'debug' | 'info' | 'warning' | 'error';
  port: number;
}

export interface PrivacySettings {
  enabled: boolean;
  redactGps: boolean;
  redactAddresses: boolean;
  redactPhones: boolean;
  redactEmails: boolean;
  excludedLocations: string[];
}

// =============================================================================
// COST TRACKING (Migration 88)
// =============================================================================

export interface RecordCostInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  locid?: string;
  sourceType?: string;
  sourceId?: string;
  operation?: string;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
}

export interface CostEntry {
  cost_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  locid?: string;
  source_type?: string;
  source_id?: string;
  operation?: string;
  duration_ms?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
  byModel: Record<string, { cost: number; tokens: number; requests: number }>;
  period: {
    start: string;
    end: string;
  };
}

export interface DailyCost {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    // Get file paths from the last drop event (captured in preload)
    getDroppedFilePaths: () => string[];
    // Legacy: Extract file paths from FileList (may not work due to contextBridge serialization)
    extractFilePaths: (files: FileList) => string[];
  }
}
