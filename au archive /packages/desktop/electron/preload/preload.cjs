"use strict";
// AU Archive Preload Script - Pure CommonJS
// This file is NOT processed by Vite - it's used directly by Electron
// IMPORTANT: Keep in sync with electron/preload/index.ts
// OPT-034: Added IPC timeout wrapper for all invoke calls
// OPT-108: Debug logging guarded by DEBUG_PRELOAD env var

const DEBUG = process.env.DEBUG_PRELOAD === "1";

const electronModule = require("electron");

// Try different ways to access webUtils
let webUtils = electronModule.webUtils;
if (!webUtils) {
  // Try direct require (Electron 28+ preload pattern)
  try {
    const { webUtils: wu } = require("electron");
    webUtils = wu;
  } catch (e) {
    if (DEBUG) console.log("[Preload] webUtils destructure failed:", e.message);
  }
}

const { contextBridge, ipcRenderer } = electronModule;

// Debug diagnostics (only when DEBUG_PRELOAD=1)
if (DEBUG) {
  const keys = Object.keys(electronModule);
  console.log("[Preload] Electron module keys:", keys.join(", "));
  console.log("[Preload] Electron version:", process.versions.electron);
  console.log("[Preload] webUtils in keys:", keys.includes("webUtils"));
  console.log("[Preload] contextBridge available:", !!contextBridge);
  console.log("[Preload] ipcRenderer available:", !!ipcRenderer);
  console.log("[Preload] webUtils final:", !!webUtils);
}

// OPT-034: IPC timeout wrapper to prevent hanging operations
const DEFAULT_IPC_TIMEOUT = 30000; // 30 seconds for most operations
const LONG_IPC_TIMEOUT = 120000; // 2 minutes for import/regeneration operations
const VERY_LONG_IPC_TIMEOUT = 600000; // 10 minutes for batch operations

// OPT-034b: Dynamic import timeout constants for chunked imports
// Scales timeout based on file count to prevent timeout on large imports
const IMPORT_BASE_TIMEOUT = 60000;    // 1 minute base overhead (setup, post-processing)
const IMPORT_PER_FILE_TIMEOUT = 5000; // 5 seconds per file (hash + metadata + copy)
const IMPORT_MIN_TIMEOUT = 120000;    // 2 minute floor (maintains current behavior for small imports)
const IMPORT_MAX_TIMEOUT = 300000;    // 5 minute ceiling per chunk (prevents runaway)

/**
 * Wrap an IPC invoke call with a timeout
 * @param {Promise} promise - The IPC invoke promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} channel - The IPC channel name (for error messages)
 * @returns {Promise} - Promise that rejects on timeout
 */
function withTimeout(promise, timeoutMs, channel) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`IPC timeout after ${timeoutMs}ms on channel: ${channel}`));
      }, timeoutMs);
    })
  ]);
}

/**
 * Create a wrapped IPC invoke function with timeout
 * @param {string} channel - The IPC channel
 * @param {number} timeout - Timeout in ms (default: DEFAULT_IPC_TIMEOUT)
 * @returns {Function} - Wrapped invoke function
 */
function invoke(channel, timeout = DEFAULT_IPC_TIMEOUT) {
  return (...args) => withTimeout(ipcRenderer.invoke(channel, ...args), timeout, channel);
}

// Long-running operation channels that need extended timeouts
const longOperationChannels = [
  "media:import",
  "media:phaseImport",
  "media:regenerateAllThumbnails",
  "media:regenerateVideoThumbnails",
  "media:regenerateDngPreviews",
  "media:generateProxiesForLocation",
  "refMaps:selectFile",  // ADR-048: File dialogs can take a while
  "refMaps:import",
  "refMaps:importFromPath",
  "refMaps:importWithOptions",
  "refMaps:importBatch",  // ADR-048: Batch import
  "refMaps:deduplicate",
  "health:checkIntegrity",
  "health:runMaintenance",
  "database:backup",
  "database:restore",
  "location:backfillRegions",
  "bagit:validateAll",
  "bagit:regenerate",
  // Image Downloader (Migration 72)
  "downloader:processImages",
  "downloader:runBackfill",
  "downloader:enhanceUrl",
  "downloader:enhanceUrls",
  // Image Quality Analysis
  "downloader:getDimensions",
  "downloader:analyzeJpegQuality",
  "downloader:detectWatermark",
  "downloader:analyzeQuality",
  "downloader:rankByQuality",
  "downloader:similarityHash",
  "downloader:findSimilarByHash",
];

const veryLongOperationChannels = [
  "media:regenerateAllThumbnails",
  "media:regenerateVideoThumbnails",
  "media:regenerateDngPreviews",
];

/**
 * Get appropriate timeout for a channel
 * @param {string} channel - The IPC channel
 * @returns {number} - Timeout in ms
 */
function getTimeout(channel) {
  if (veryLongOperationChannels.includes(channel)) {
    return VERY_LONG_IPC_TIMEOUT;
  }
  if (longOperationChannels.includes(channel)) {
    return LONG_IPC_TIMEOUT;
  }
  return DEFAULT_IPC_TIMEOUT;
}

/**
 * Create a wrapped IPC invoke function with auto-detected timeout
 * @param {string} channel - The IPC channel
 * @returns {Function} - Wrapped invoke function
 */
function invokeAuto(channel) {
  return invoke(channel, getTimeout(channel));
}

/**
 * Create a wrapped IPC invoke function with very long timeout
 * Used for import operations that may take several minutes
 * @param {string} channel - The IPC channel
 * @returns {Function} - Wrapped invoke function
 */
function invokeLong(channel) {
  return invoke(channel, VERY_LONG_IPC_TIMEOUT);
}

/**
 * Calculate dynamic timeout for import operations based on file count
 * OPT-034b: Scales timeout with file count to prevent large import timeouts
 * Formula: BASE + (fileCount * PER_FILE), clamped to [MIN, MAX]
 * @param {number} fileCount - Number of files being imported
 * @returns {number} - Timeout in ms
 */
function calculateImportTimeout(fileCount) {
  const calculated = IMPORT_BASE_TIMEOUT + (fileCount * IMPORT_PER_FILE_TIMEOUT);
  return Math.max(IMPORT_MIN_TIMEOUT, Math.min(calculated, IMPORT_MAX_TIMEOUT));
}

// OPT-034: All IPC calls now use timeout wrappers via invokeAuto()
const api = {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },
  platform: process.platform,

  locations: {
    findAll: (filters) => invokeAuto("location:findAll")(filters),
    findById: (id) => invokeAuto("location:findById")(id),
    create: (input) => invokeAuto("location:create")(input),
    update: (id, input) => invokeAuto("location:update")(id, input),
    delete: (id) => invokeAuto("location:delete")(id),
    count: (filters) => invokeAuto("location:count")(filters),
    random: () => invokeAuto("location:random")(),
    undocumented: () => invokeAuto("location:undocumented")(),
    historical: () => invokeAuto("location:historical")(),
    favorites: () => invokeAuto("location:favorites")(),
    toggleFavorite: (id) => invokeAuto("location:toggleFavorite")(id),
    findNearby: (lat, lng, radiusKm) => invokeAuto("location:findNearby")(lat, lng, radiusKm),
    // Kanye9: Check for duplicate locations by address
    checkDuplicates: (address) => invokeAuto("location:checkDuplicates")(address),
    // DECISION-018: Region data management
    updateRegionData: (id, regionData) => invokeAuto("location:updateRegionData")(id, regionData),
    backfillRegions: () => invokeAuto("location:backfillRegions")(),
    // Autocomplete helpers for Category/Class
    getDistinctCategories: () => invokeAuto("location:getDistinctCategories")(),
    getDistinctClasses: () => invokeAuto("location:getDistinctClasses")(),
    // OPT-036: Get all filter options in one efficient call
    getFilterOptions: () => invokeAuto("location:getFilterOptions")(),
    // Migration 34: View tracking
    trackView: (id) => invokeAuto("location:trackView")(id),
    getViewStats: (id) => invokeAuto("location:getViewStats")(id),
    getViewHistory: (id, limit) => invokeAuto("location:getViewHistory")(id, limit),
    // Dashboard: Recently viewed locations with hero thumbnails
    findRecentlyViewed: (limit) => invokeAuto("location:findRecentlyViewed")(limit),
    // Dashboard: Project locations with hero thumbnails
    findProjects: (limit) => invokeAuto("location:findProjects")(limit),
    // OPT-037: Viewport-based spatial queries for Atlas
    findInBounds: (bounds) => invokeAuto("location:findInBounds")(bounds),
    countInBounds: (bounds) => invokeAuto("location:countInBounds")(bounds),
    // OPT-043: Ultra-fast map query with lean MapLocation type (10x faster)
    findInBoundsForMap: (bounds) => invokeAuto("location:findInBoundsForMap")(bounds),
  },

  stats: {
    topStates: (limit) => invokeAuto("stats:topStates")(limit),
    topCategories: (limit) => invokeAuto("stats:topCategories")(limit),
    // Dashboard: Top categories/states with hero thumbnails
    topCategoriesWithHero: (limit) => invokeAuto("stats:topCategoriesWithHero")(limit),
    topStatesWithHero: (limit) => invokeAuto("stats:topStatesWithHero")(limit),
  },

  settings: {
    get: (key) => invokeAuto("settings:get")(key),
    getAll: () => invokeAuto("settings:getAll")(),
    set: (key, value) => invokeAuto("settings:set")(key, value),
  },

  shell: {
    openExternal: (url) => invokeAuto("shell:openExternal")(url),
  },

  geocode: {
    reverse: (lat, lng) => invokeAuto("geocode:reverse")(lat, lng),
    forward: (address) => invokeAuto("geocode:forward")(address),
    // Kanye9: Cascade geocoding - tries full → city → zipcode → county → state
    forwardCascade: (address) => invokeAuto("geocode:forwardCascade")(address),
    clearCache: (daysOld) => invokeAuto("geocode:clearCache")(daysOld),
  },

  dialog: {
    selectFolder: () => invokeAuto("dialog:selectFolder")(),
  },

  database: {
    backup: () => invokeAuto("database:backup")(),
    restore: () => invokeAuto("database:restore")(),
    getLocation: () => invokeAuto("database:getLocation")(),
    changeLocation: () => invokeAuto("database:changeLocation")(),
    resetLocation: () => invokeAuto("database:resetLocation")(),
    // Phase 2: Database stats and internal backup management
    getStats: () => invokeAuto("database:getStats")(),
    exportBackup: () => invokeAuto("database:exportBackup")(),
    listBackups: () => invokeAuto("database:listBackups")(),
    restoreFromInternal: (backupId) => invokeAuto("database:restoreFromInternal")(backupId),
    // Database Archive Export: Export to archive folder for portable backup
    archiveExport: () => invokeAuto("database:archiveExport")(),
    archiveStatus: () => invokeAuto("database:archiveStatus")(),
  },

  imports: {
    create: (input) => invokeAuto("imports:create")(input),
    findRecent: (limit) => invokeAuto("imports:findRecent")(limit),
    findByLocation: (locid) => invokeAuto("imports:findByLocation")(locid),
    findAll: () => invokeAuto("imports:findAll")(),
    getTotalMediaCount: () => invokeAuto("imports:getTotalMediaCount")(),
  },

  media: {
    // File selection and import
    selectFiles: () => invokeAuto("media:selectFiles")(),
    expandPaths: (paths) => invokeAuto("media:expandPaths")(paths),
    // OPT-034b: Dynamic timeout based on file count for chunked imports
    import: (input) => {
      const fileCount = input?.files?.length || 1;
      const timeout = calculateImportTimeout(fileCount);
      return invoke("media:import", timeout)(input);
    },
    // OPT-034b: Dynamic timeout based on file count for chunked imports
    phaseImport: (input) => {
      const fileCount = input?.files?.length || 1;
      const timeout = calculateImportTimeout(fileCount);
      return invoke("media:phaseImport", timeout)(input);
    },
    onPhaseImportProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("media:phaseImport:progress", listener);
      return () => ipcRenderer.removeListener("media:phaseImport:progress", listener);
    },
    onImportProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("media:import:progress", listener);
      return () => ipcRenderer.removeListener("media:import:progress", listener);
    },
    cancelImport: (importId) => invokeAuto("media:import:cancel")(importId),
    findByLocation: (locid) => invokeAuto("media:findByLocation")(locid),
    // OPT-039: Paginated image loading for scale
    findImagesPaginated: (params) => invokeAuto("media:findImagesPaginated")(params),
    findImageByHash: (hash) => invokeAuto("media:findImageByHash")(hash),
    // Media viewing and processing
    openFile: (filePath) => invokeAuto("media:openFile")(filePath),
    showInFolder: (filePath) => invokeAuto("media:showInFolder")(filePath),
    getFullMetadata: (hash, mediaType) => invokeAuto("media:getFullMetadata")(hash, mediaType),
    generateThumbnail: (sourcePath, hash) => invokeAuto("media:generateThumbnail")(sourcePath, hash),
    extractPreview: (sourcePath, hash) => invokeAuto("media:extractPreview")(sourcePath, hash),
    generatePoster: (sourcePath, hash) => invokeAuto("media:generatePoster")(sourcePath, hash),
    getCached: (key) => invokeAuto("media:getCached")(key),
    preload: (mediaList, currentIndex) => invokeAuto("media:preload")(mediaList, currentIndex),
    readXmp: (mediaPath) => invokeAuto("media:readXmp")(mediaPath),
    writeXmp: (mediaPath, data) => invokeAuto("media:writeXmp")(mediaPath, data),
    regenerateAllThumbnails: (options) => invokeAuto("media:regenerateAllThumbnails")(options),
    regenerateVideoThumbnails: (options) => invokeAuto("media:regenerateVideoThumbnails")(options),
    // Kanye11: Regenerate preview/thumbnails for a single file
    regenerateSingleFile: (hash, filePath) => invokeAuto("media:regenerateSingleFile")(hash, filePath),
    // Migration 30: Regenerate DNG previews using LibRaw for full quality
    regenerateDngPreviews: () => invokeAuto("media:regenerateDngPreviews")(),
    // OPT-105: Backfill RAW preview paths from existing .previews/ directory
    backfillRawPreviews: () => invokeAuto("media:backfillRawPreviews")(),
    // Hidden/Live Photo operations (Migration 23)
    setHidden: (input) => invokeAuto("media:setHidden")(input),
    detectLivePhotosAndSDR: (locid) => invokeAuto("media:detectLivePhotosAndSDR")(locid),

    // Location-specific media fixes
    fixLocationImages: (locid) => invokeAuto("media:fixLocationImages")(locid),
    fixLocationVideos: (locid) => invokeAuto("media:fixLocationVideos")(locid),
    countUntaggedImages: (locid) => invokeAuto("media:countUntaggedImages")(locid),

    // Video Proxy System (Migration 36, updated OPT-053 Immich Model)
    // Proxies generated at import time, stored alongside originals, permanent (no purge)
    generateProxy: (vidhash, sourcePath, metadata) =>
      invokeAuto("media:generateProxy")(vidhash, sourcePath, metadata),
    getProxyPath: (vidhash) =>
      invokeAuto("media:getProxyPath")(vidhash),
    // OPT-053: Fast filesystem check for proxy existence (no DB lookup)
    proxyExists: (videoPath, vidhash) =>
      invokeAuto("media:proxyExists")(videoPath, vidhash),
    getProxyCacheStats: () =>
      invokeAuto("media:getProxyCacheStats")(),
    // OPT-053: DEPRECATED - Proxies are permanent, these always return empty results
    purgeOldProxies: (daysOld) =>
      invokeAuto("media:purgeOldProxies")(daysOld),
    clearAllProxies: () =>
      invokeAuto("media:clearAllProxies")(),
    touchLocationProxies: (locid) =>
      invokeAuto("media:touchLocationProxies")(locid),
    // For migration/repair of old imports
    generateProxiesForLocation: (locid) =>
      invokeAuto("media:generateProxiesForLocation")(locid),
    onProxyProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("media:proxyProgress", listener);
      return () => ipcRenderer.removeListener("media:proxyProgress", listener);
    },
    // Delete and Move operations (for Lightbox actions)
    delete: (input) => invokeAuto("media:delete")(input),
    moveToSubLocation: (input) => invokeAuto("media:moveToSubLocation")(input),
  },

  notes: {
    create: (input) => invokeAuto("notes:create")(input),
    findById: (noteId) => invokeAuto("notes:findById")(noteId),
    findByLocation: (locid) => invokeAuto("notes:findByLocation")(locid),
    findRecent: (limit) => invokeAuto("notes:findRecent")(limit),
    update: (noteId, updates) => invokeAuto("notes:update")(noteId, updates),
    delete: (noteId) => invokeAuto("notes:delete")(noteId),
    countByLocation: (locid) => invokeAuto("notes:countByLocation")(locid),
  },

  // Migration 28: Sub-location API
  sublocations: {
    create: (input) => invokeAuto("sublocation:create")(input),
    findById: (subid) => invokeAuto("sublocation:findById")(subid),
    findByLocation: (locid) => invokeAuto("sublocation:findByLocation")(locid),
    findWithHeroImages: (locid) => invokeAuto("sublocation:findWithHeroImages")(locid),
    update: (subid, updates) => invokeAuto("sublocation:update")(subid, updates),
    delete: (subid) => invokeAuto("sublocation:delete")(subid),
    setPrimary: (locid, subid) => invokeAuto("sublocation:setPrimary")(locid, subid),
    checkName: (locid, subnam, excludeSubid) => invokeAuto("sublocation:checkName")(locid, subnam, excludeSubid),
    count: (locid) => invokeAuto("sublocation:count")(locid),
    // Migration 31: Sub-location GPS (separate from host location)
    updateGps: (subid, gps) => invokeAuto("sublocation:updateGps")(subid, gps),
    clearGps: (subid) => invokeAuto("sublocation:clearGps")(subid),
    verifyGps: (subid) => invokeAuto("sublocation:verifyGps")(subid),
    findWithGps: (locid) => invokeAuto("sublocation:findWithGps")(locid),
    // Migration 65: Sub-location category/class (separate taxonomy from host locations)
    getDistinctCategories: () => invokeAuto("sublocation:getDistinctCategories")(),
    getDistinctClasses: () => invokeAuto("sublocation:getDistinctClasses")(),
  },

  projects: {
    create: (input) => invokeAuto("projects:create")(input),
    findById: (projectId) => invokeAuto("projects:findById")(projectId),
    findByIdWithLocations: (projectId) => invokeAuto("projects:findByIdWithLocations")(projectId),
    findAll: () => invokeAuto("projects:findAll")(),
    findRecent: (limit) => invokeAuto("projects:findRecent")(limit),
    findTopByLocationCount: (limit) => invokeAuto("projects:findTopByLocationCount")(limit),
    findByLocation: (locid) => invokeAuto("projects:findByLocation")(locid),
    update: (projectId, updates) => invokeAuto("projects:update")(projectId, updates),
    delete: (projectId) => invokeAuto("projects:delete")(projectId),
    addLocation: (projectId, locid) => invokeAuto("projects:addLocation")(projectId, locid),
    removeLocation: (projectId, locid) => invokeAuto("projects:removeLocation")(projectId, locid),
    isLocationInProject: (projectId, locid) => invokeAuto("projects:isLocationInProject")(projectId, locid),
  },

  // OPT-109: Web Sources Archiving (comprehensive replacement for bookmarks)
  websources: {
    // Core CRUD
    create: (input) => invokeAuto("websources:create")(input),
    findById: (sourceId) => invokeAuto("websources:findById")(sourceId),
    findByUrl: (url) => invokeAuto("websources:findByUrl")(url),
    findByLocation: (locid) => invokeAuto("websources:findByLocation")(locid),
    findBySubLocation: (subid) => invokeAuto("websources:findBySubLocation")(subid),
    findByStatus: (status) => invokeAuto("websources:findByStatus")(status),
    findPendingForArchive: (limit) => invokeAuto("websources:findPendingForArchive")(limit),
    findRecent: (limit) => invokeAuto("websources:findRecent")(limit),
    findAll: () => invokeAuto("websources:findAll")(),
    update: (sourceId, updates) => invokeAuto("websources:update")(sourceId, updates),
    delete: (sourceId) => invokeAuto("websources:delete")(sourceId),

    // Archive Status Management
    markArchiving: (sourceId) => invokeAuto("websources:markArchiving")(sourceId),
    markComplete: (sourceId, options) => invokeAuto("websources:markComplete")(sourceId, options),
    markPartial: (sourceId, componentStatus, archivePath) =>
      invokeAuto("websources:markPartial")(sourceId, componentStatus, archivePath),
    markFailed: (sourceId, error) => invokeAuto("websources:markFailed")(sourceId, error),
    resetToPending: (sourceId) => invokeAuto("websources:resetToPending")(sourceId),
    updateComponentStatus: (sourceId, componentStatus) =>
      invokeAuto("websources:updateComponentStatus")(sourceId, componentStatus),

    // Version Management
    createVersion: (sourceId, options) => invokeAuto("websources:createVersion")(sourceId, options),
    findVersions: (sourceId) => invokeAuto("websources:findVersions")(sourceId),
    findVersionByNumber: (sourceId, versionNumber) =>
      invokeAuto("websources:findVersionByNumber")(sourceId, versionNumber),
    findLatestVersion: (sourceId) => invokeAuto("websources:findLatestVersion")(sourceId),
    countVersions: (sourceId) => invokeAuto("websources:countVersions")(sourceId),

    // Full-Text Search
    search: (query, options) => invokeAuto("websources:search")(query, options),

    // Statistics
    getStats: () => invokeAuto("websources:getStats")(),
    getStatsByLocation: (locid) => invokeAuto("websources:getStatsByLocation")(locid),
    count: () => invokeAuto("websources:count")(),
    countByLocation: (locid) => invokeAuto("websources:countByLocation")(locid),
    countBySubLocation: (subid) => invokeAuto("websources:countBySubLocation")(subid),
    // OPT-113: Pending counts for Archive All buttons
    countPending: () => invokeAuto("websources:countPending")(),
    countPendingByLocation: (locid) => invokeAuto("websources:countPendingByLocation")(locid),

    // Migration
    migrateFromBookmarks: () => invokeAuto("websources:migrateFromBookmarks")(),

    // Orchestrator (Archive Operations)
    archive: (sourceId, options) => invokeLong("websources:archive")(sourceId, options),
    archivePending: (limit, options) => invokeLong("websources:archivePending")(limit, options),
    rearchive: (sourceId, options) => invokeLong("websources:rearchive")(sourceId, options),
    cancelArchive: () => invokeAuto("websources:cancelArchive")(),
    archiveStatus: () => invokeAuto("websources:archiveStatus")(),
    // OPT-113: Batch archive all pending sources
    archiveAllPending: (limit) => invokeAuto("websources:archiveAllPending")(limit),
    archivePendingByLocation: (locid, limit) => invokeAuto("websources:archivePendingByLocation")(locid, limit),

    // OPT-111: Enhanced Metadata Access
    getImages: (sourceId) => invokeAuto("websources:getImages")(sourceId),
    getVideos: (sourceId) => invokeAuto("websources:getVideos")(sourceId),
    getDetail: (sourceId) => invokeAuto("websources:getDetail")(sourceId),

    // OPT-113: Event listener for archive completion
    onArchiveComplete: (callback) => {
      const handler = (_event, result) => callback(result);
      ipcRenderer.on("websources:archive-complete", handler);
      return () => ipcRenderer.removeListener("websources:archive-complete", handler);
    },

    // FIX: Event listener for web source saved (from browser extension)
    // Allows UI to refresh when bookmarks are saved externally
    onWebSourceSaved: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("websource:saved", handler);
      return () => ipcRenderer.removeListener("websource:saved", handler);
    },
  },

  users: {
    // CRUD
    create: (input) => invokeAuto("users:create")(input),
    findAll: () => invokeAuto("users:findAll")(),
    findById: (userId) => invokeAuto("users:findById")(userId),
    findByUsername: (username) => invokeAuto("users:findByUsername")(username),
    update: (userId, updates) => invokeAuto("users:update")(userId, updates),
    delete: (userId) => invokeAuto("users:delete")(userId),
    // Authentication (Migration 24)
    verifyPin: (userId, pin) => invokeAuto("users:verifyPin")(userId, pin),
    setPin: (userId, pin) => invokeAuto("users:setPin")(userId, pin),
    clearPin: (userId) => invokeAuto("users:clearPin")(userId),
    hasPin: (userId) => invokeAuto("users:hasPin")(userId),
    anyUserHasPin: () => invokeAuto("users:anyUserHasPin")(),
    updateLastLogin: (userId) => invokeAuto("users:updateLastLogin")(userId),
  },

  health: {
    getDashboard: () => invokeAuto("health:getDashboard")(),
    getStatus: () => invokeAuto("health:getStatus")(),
    runCheck: () => invokeAuto("health:runCheck")(),
    createBackup: () => invokeAuto("health:createBackup")(),
    getBackupStats: () => invokeAuto("health:getBackupStats")(),
    getDiskSpace: () => invokeAuto("health:getDiskSpace")(),
    checkIntegrity: () => invokeAuto("health:checkIntegrity")(),
    runMaintenance: () => invokeAuto("health:runMaintenance")(),
    getMaintenanceSchedule: () => invokeAuto("health:getMaintenanceSchedule")(),
    getRecoveryState: () => invokeAuto("health:getRecoveryState")(),
    attemptRecovery: () => invokeAuto("health:attemptRecovery")(),
  },

  backup: {
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("backup:status", listener);
      return () => ipcRenderer.removeListener("backup:status", listener);
    },
  },

  browser: {
    navigate: (url) => invokeAuto("browser:navigate")(url),
    show: (bounds) => invokeAuto("browser:show")(bounds),
    hide: () => invokeAuto("browser:hide")(),
    getUrl: () => invokeAuto("browser:getUrl")(),
    getTitle: () => invokeAuto("browser:getTitle")(),
    goBack: () => invokeAuto("browser:goBack")(),
    goForward: () => invokeAuto("browser:goForward")(),
    reload: () => invokeAuto("browser:reload")(),
    captureScreenshot: () => invokeAuto("browser:captureScreenshot")(),
    onNavigated: (callback) => {
      const listener = (_event, url) => callback(url);
      ipcRenderer.on("browser:navigated", listener);
      return () => ipcRenderer.removeListener("browser:navigated", listener);
    },
    onTitleChanged: (callback) => {
      const listener = (_event, title) => callback(title);
      ipcRenderer.on("browser:titleChanged", listener);
      return () => ipcRenderer.removeListener("browser:titleChanged", listener);
    },
    onLoadingChanged: (callback) => {
      const listener = (_event, loading) => callback(loading);
      ipcRenderer.on("browser:loadingChanged", listener);
      return () => ipcRenderer.removeListener("browser:loadingChanged", listener);
    },
  },

  // Research Browser - external Ungoogled Chromium
  research: {
    launch: () => invokeAuto("research:launch")(),
    close: () => invokeAuto("research:close")(),
    status: () => invokeAuto("research:status")(),
  },

  // Storage monitoring - OPT-047: database-backed archive size tracking
  storage: {
    getStats: () => invokeAuto("storage:getStats")(),
    verifyIntegrity: () => invokeAuto("storage:verifyIntegrity")(),
    // Listen for verify progress events
    onVerifyProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("storage:verify:progress", listener);
      return () => ipcRenderer.removeListener("storage:verify:progress", listener);
    },
  },

  // BagIt Self-Documenting Archive (RFC 8493)
  bagit: {
    regenerate: (locid) => invokeAuto("bagit:regenerate")(locid),
    validate: (locid) => invokeAuto("bagit:validate")(locid),
    validateAll: () => invokeAuto("bagit:validateAll")(),
    status: (locid) => invokeAuto("bagit:status")(locid),
    summary: () => invokeAuto("bagit:summary")(),
    lastValidation: () => invokeAuto("bagit:lastValidation")(),
    isValidationDue: () => invokeAuto("bagit:isValidationDue")(),
    scheduleValidation: () => invokeAuto("bagit:scheduleValidation")(),
    // Listen for validation progress events
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("bagit:progress", listener);
      return () => ipcRenderer.removeListener("bagit:progress", listener);
    },
  },

  refMaps: {
    // ADR-048: selectFile now returns string[] (multi-select)
    selectFile: () => invokeAuto("refMaps:selectFile")(),
    // ADR-048: Batch import for multiple files
    importBatch: (filePaths, importedBy) => invokeAuto("refMaps:importBatch")(filePaths, importedBy),
    import: (importedBy) => invokeAuto("refMaps:import")(importedBy),
    importFromPath: (filePath, importedBy) => invokeAuto("refMaps:importFromPath")(filePath, importedBy),
    findAll: () => invokeAuto("refMaps:findAll")(),
    findById: (mapId) => invokeAuto("refMaps:findById")(mapId),
    getAllPoints: () => invokeAuto("refMaps:getAllPoints")(),
    // OPT-037: Viewport-based spatial query for reference points
    getPointsInBounds: (bounds) => invokeAuto("refMaps:getPointsInBounds")(bounds),
    update: (mapId, updates) => invokeAuto("refMaps:update")(mapId, updates),
    delete: (mapId) => invokeAuto("refMaps:delete")(mapId),
    getStats: () => invokeAuto("refMaps:getStats")(),
    getSupportedExtensions: () => invokeAuto("refMaps:getSupportedExtensions")(),
    // Phase 2: Auto-matching for location creation
    findMatches: (query, options) => invokeAuto("refMaps:findMatches")(query, options),
    // Phase 3: Deduplication on import
    previewImport: (filePath) => invokeAuto("refMaps:previewImport")(filePath),
    importWithOptions: (filePath, options) => invokeAuto("refMaps:importWithOptions")(filePath, options),
    // Phase 4: Purge catalogued points
    findCataloguedPoints: () => invokeAuto("refMaps:findCataloguedPoints")(),
    purgeCataloguedPoints: () => invokeAuto("refMaps:purgeCataloguedPoints")(),
    // Phase 5: Delete single point from map popup
    deletePoint: (pointId) => invokeAuto("refMaps:deletePoint")(pointId),
    // Migration 39: GPS-based deduplication within ref_map_points
    previewDedup: () => invokeAuto("refMaps:previewDedup")(),
    deduplicate: () => invokeAuto("refMaps:deduplicate")(),
    // Migration 42: GPS enrichment - apply ref point GPS to existing location
    applyEnrichment: (input) => invokeAuto("refMaps:applyEnrichment")(input),
    applyAllEnrichments: (enrichments) => invokeAuto("refMaps:applyAllEnrichments")(enrichments),
    // Link ref point to existing location (manual association from Atlas)
    linkToLocation: (pointId, locationId) => invokeAuto("refMaps:linkToLocation")({ pointId, locationId }),
  },

  // Import Intelligence - Smart location matching during import
  importIntelligence: {
    // Full scan for matches near GPS point (excludeRefPointId filters out a specific ref point)
    scan: (lat, lng, hints, excludeRefPointId) => invokeAuto("import-intelligence:scan")(lat, lng, hints, excludeRefPointId),
    // Quick check if GPS has nearby matches
    hasNearby: (lat, lng) => invokeAuto("import-intelligence:hasNearby")(lat, lng),
    // Add AKA name to existing location
    addAkaName: (locid, newName) => invokeAuto("import-intelligence:addAkaName")(locid, newName),
  },

  // Import System v2.0 - 5-step pipeline with background jobs
  importV2: {
    // Start a new import with paths and location info
    start: (input) => invokeLong("import:v2:start")(input),
    // Cancel running import
    cancel: (sessionId) => invokeAuto("import:v2:cancel")(sessionId),
    // Get current import status
    status: () => invokeAuto("import:v2:status")(),
    // Get resumable import sessions
    resumable: () => invokeAuto("import:v2:resumable")(),
    // Resume an incomplete import
    resume: (sessionId) => invokeLong("import:v2:resume")(sessionId),
    // Listen for import progress events
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("import:v2:progress", listener);
      return () => ipcRenderer.removeListener("import:v2:progress", listener);
    },
    // Listen for import completion events
    onComplete: (callback) => {
      const listener = (_event, result) => callback(result);
      ipcRenderer.on("import:v2:complete", listener);
      return () => ipcRenderer.removeListener("import:v2:complete", listener);
    },
  },

  // Background Job Queue - manages post-import processing
  jobs: {
    // Get job queue statistics
    status: () => invokeAuto("jobs:status")(),
    // Get dead letter queue entries
    deadLetter: (queue) => invokeAuto("jobs:deadLetter")(queue),
    // Retry a job from dead letter queue
    retry: (input) => invokeAuto("jobs:retry")(input),
    // Acknowledge (dismiss) dead letter entries
    acknowledge: (ids) => invokeAuto("jobs:acknowledge")(ids),
    // Clear old completed jobs
    clearCompleted: (olderThanMs) => invokeAuto("jobs:clearCompleted")(olderThanMs),
    // Listen for job progress events
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("jobs:progress", listener);
      return () => ipcRenderer.removeListener("jobs:progress", listener);
    },
    // Listen for dead letter queue events (jobs that permanently failed)
    onDeadLetter: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("jobs:deadLetter", listener);
      return () => ipcRenderer.removeListener("jobs:deadLetter", listener);
    },
    // Listen for asset events (thumbnail ready, metadata complete, proxy ready, gps enriched)
    onAssetReady: (callback) => {
      const thumbnailListener = (_event, data) => callback({ type: 'thumbnail', ...data });
      const metadataListener = (_event, data) => callback({ type: 'metadata', ...data });
      const proxyListener = (_event, data) => callback({ type: 'proxy', ...data });
      // OPT-087: GPS enrichment event for map updates
      const gpsListener = (_event, data) => callback({ type: 'gps-enriched', ...data });
      ipcRenderer.on("asset:thumbnail-ready", thumbnailListener);
      ipcRenderer.on("asset:metadata-complete", metadataListener);
      ipcRenderer.on("asset:proxy-ready", proxyListener);
      ipcRenderer.on("location:gps-enriched", gpsListener);
      return () => {
        ipcRenderer.removeListener("asset:thumbnail-ready", thumbnailListener);
        ipcRenderer.removeListener("asset:metadata-complete", metadataListener);
        ipcRenderer.removeListener("asset:proxy-ready", proxyListener);
        ipcRenderer.removeListener("location:gps-enriched", gpsListener);
      };
    },
  },

  // Monitoring & Audit System (Migration 51)
  monitoring: {
    // Metrics
    getMetricsSummary: () => invokeAuto("monitoring:getMetricsSummary")(),
    getHistogramStats: (name, tags) => invokeAuto("monitoring:getHistogramStats")(name, tags),
    getMetricsHistory: (options) => invokeAuto("monitoring:getMetricsHistory")(options),

    // Traces
    getActiveSpans: () => invokeAuto("monitoring:getActiveSpans")(),
    getTraceSpans: (traceId) => invokeAuto("monitoring:getTraceSpans")(traceId),
    getTracesHistory: (options) => invokeAuto("monitoring:getTracesHistory")(options),

    // Alerts
    getAlertHistory: (limit) => invokeAuto("monitoring:getAlertHistory")(limit),
    getAlertRules: () => invokeAuto("monitoring:getAlertRules")(),
    setAlertRuleEnabled: (ruleId, enabled) => invokeAuto("monitoring:setAlertRuleEnabled")(ruleId, enabled),
    acknowledgeAlert: (alertId, userId) => invokeAuto("monitoring:acknowledgeAlert")(alertId, userId),
    getUnacknowledgedAlerts: (limit) => invokeAuto("monitoring:getUnacknowledgedAlerts")(limit),

    // Job Audit
    getJobAuditLog: (options) => invokeAuto("monitoring:getJobAuditLog")(options),
    getJobPerformanceStats: (options) => invokeAuto("monitoring:getJobPerformanceStats")(options),

    // Import Audit
    getImportAuditLog: (sessionId) => invokeAuto("monitoring:getImportAuditLog")(sessionId),

    // Health Snapshots
    getHealthSnapshots: (options) => invokeAuto("monitoring:getHealthSnapshots")(options),

    // Control
    start: () => invokeAuto("monitoring:start")(),
    stop: () => invokeAuto("monitoring:stop")(),
    cleanup: (options) => invokeLong("monitoring:cleanup")(options),

    // Listen for real-time alerts
    onAlert: (callback) => {
      const listener = (_event, alert) => callback(alert);
      ipcRenderer.on("monitoring:alert", listener);
      return () => ipcRenderer.removeListener("monitoring:alert", listener);
    },
  },

  // Image Downloader (Migration 72 - pHash, URL patterns, staging)
  downloader: {
    // URL Pattern Transformation
    transformUrl: (url) => invokeAuto("downloader:transformUrl")(url),
    addPattern: (pattern) => invokeAuto("downloader:addPattern")(pattern),
    getPatterns: () => invokeAuto("downloader:getPatterns")(),

    // URL Validation
    validateUrl: (url) => invokeAuto("downloader:validateUrl")(url),
    validateUrls: (urls) => invokeAuto("downloader:validateUrls")(urls),
    findBestUrl: (input) => invokeAuto("downloader:findBestUrl")(input),

    // Smart Image Enhance (recursive suffix stripping to find TRUE originals)
    enhanceUrl: (input) => invokeLong("downloader:enhanceUrl")(input),
    enhanceUrls: (input) => invokeLong("downloader:enhanceUrls")(input),

    // Perceptual Hashing
    hashFile: (filePath) => invokeAuto("downloader:hashFile")(filePath),
    pHashDistance: (hash1, hash2) => invokeAuto("downloader:pHashDistance")(hash1, hash2),
    findSimilar: (input) => invokeAuto("downloader:findSimilar")(input),
    checkDuplicate: (phash) => invokeAuto("downloader:checkDuplicate")(phash),

    // pHash Backfill
    getBackfillStatus: () => invokeAuto("downloader:getBackfillStatus")(),
    runBackfill: (options) => invokeLong("downloader:runBackfill")(options),
    startBackgroundBackfill: () => invokeAuto("downloader:startBackgroundBackfill")(),

    // Download Orchestration
    processImages: (input) => invokeLong("downloader:processImages")(input),
    importStaged: (input) => invokeAuto("downloader:importStaged")(input),
    getPageHistory: (pageUrl) => invokeAuto("downloader:getPageHistory")(pageUrl),
    getPending: () => invokeAuto("downloader:getPending")(),
    getStagingStats: () => invokeAuto("downloader:getStagingStats")(),
    cleanupStaging: (maxAgeHours) => invokeAuto("downloader:cleanupStaging")(maxAgeHours),

    // Event listeners
    onBackfillProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("downloader:backfillProgress", listener);
      return () => ipcRenderer.removeListener("downloader:backfillProgress", listener);
    },
    onProcessProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("downloader:processProgress", listener);
      return () => ipcRenderer.removeListener("downloader:processProgress", listener);
    },
    onImageFound: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("downloader:imageFound", listener);
      return () => ipcRenderer.removeListener("downloader:imageFound", listener);
    },
    onImageStaged: (callback) => {
      const listener = (_event, staged) => callback(staged);
      ipcRenderer.on("downloader:imageStaged", listener);
      return () => ipcRenderer.removeListener("downloader:imageStaged", listener);
    },
    onEnhanceProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("downloader:enhanceProgress", listener);
      return () => ipcRenderer.removeListener("downloader:enhanceProgress", listener);
    },
    onQualityProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("downloader:qualityProgress", listener);
      return () => ipcRenderer.removeListener("downloader:qualityProgress", listener);
    },

    // Image Source Discovery
    discoverSources: (input) => invokeAuto("downloader:discoverSources")(input),
    applySitePatterns: (url) => invokeAuto("downloader:applySitePatterns")(url),
    parseSrcset: (input) => invokeAuto("downloader:parseSrcset")(input),
    findBestImages: (input) => invokeLong("downloader:findBestImages")(input),
    onFindProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("downloader:findProgress", listener);
      return () => ipcRenderer.removeListener("downloader:findProgress", listener);
    },

    // Image Quality Analysis
    getDimensions: (input) => invokeLong("downloader:getDimensions")(input),
    analyzeJpegQuality: (url) => invokeLong("downloader:analyzeJpegQuality")(url),
    detectWatermark: (url) => invokeLong("downloader:detectWatermark")(url),
    analyzeQuality: (input) => invokeLong("downloader:analyzeQuality")(input),
    rankByQuality: (input) => invokeLong("downloader:rankByQuality")(input),
    similarityHash: (url) => invokeLong("downloader:similarityHash")(url),
    findSimilarByHash: (input) => invokeLong("downloader:findSimilarByHash")(input),

    // Browser Image Capture
    getCapturedImages: (pageUrl) => invokeAuto("downloader:getCapturedImages")(pageUrl),
    clearCapturedImages: (maxAgeHours) => invokeAuto("downloader:clearCapturedImages")(maxAgeHours),

    // Context Menu Events (from right-click on images in research browser)
    onFindOriginal: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("image-capture:findOriginal", listener);
      return () => ipcRenderer.removeListener("image-capture:findOriginal", listener);
    },
    onAnalyzeQuality: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("image-capture:analyzeQuality", listener);
      return () => ipcRenderer.removeListener("image-capture:analyzeQuality", listener);
    },
    onSaveToArchive: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("image-capture:saveToArchive", listener);
      return () => ipcRenderer.removeListener("image-capture:saveToArchive", listener);
    },
  },

  // Timeline (Migration 69)
  timeline: {
    findByLocation: (locid) => invokeAuto("timeline:findByLocation")(locid),
    findBySubLocation: (locid, subid) => invokeAuto("timeline:findBySubLocation")(locid, subid),
    findCombined: (locid) => invokeAuto("timeline:findCombined")(locid),
    parseDate: (input) => invokeAuto("timeline:parseDate")(input),
    create: (input, userId) => invokeAuto("timeline:create")(input, userId),
    update: (eventId, updates, userId) => invokeAuto("timeline:update")(eventId, updates, userId),
    delete: (eventId) => invokeAuto("timeline:delete")(eventId),
    approve: (eventId, userId) => invokeAuto("timeline:approve")(eventId, userId),
    initializeLocation: (locid, locadd, userId) => invokeAuto("timeline:initializeLocation")(locid, locadd, userId),
    initializeSubLocation: (locid, subid, userId) => invokeAuto("timeline:initializeSubLocation")(locid, subid, userId),
    getVisitCount: (locid) => invokeAuto("timeline:getVisitCount")(locid),
    getEstablished: (locid, subid) => invokeAuto("timeline:getEstablished")(locid, subid),
    updateEstablished: (locid, subid, dateInput, eventSubtype, userId) =>
      invokeAuto("timeline:updateEstablished")(locid, subid, dateInput, eventSubtype, userId),
    // Web page event methods (OPT-119: Timeline overhaul)
    createWebPageEvent: (locid, subid, websourceId, publishDate, title, userId) =>
      invokeAuto("timeline:createWebPageEvent")(locid, subid, websourceId, publishDate, title, userId),
    deleteWebPageEvent: (websourceId) =>
      invokeAuto("timeline:deleteWebPageEvent")(websourceId),
    hasWebPageEvent: (websourceId) =>
      invokeAuto("timeline:hasWebPageEvent")(websourceId),
    getMediaCounts: (mediaHashesJson) =>
      invokeAuto("timeline:getMediaCounts")(mediaHashesJson),
    backfillWebPages: () =>
      invokeAuto("timeline:backfillWebPages")(),
    // Multi-source timeline (LLM Tools Overhaul)
    findByLocationWithSources: (locid) =>
      invokeAuto("timeline:findByLocationWithSources")(locid),
    getSources: (eventId) =>
      invokeAuto("timeline:getSources")(eventId),
    addSource: (eventId, sourceId) =>
      invokeAuto("timeline:addSource")(eventId, sourceId),
    reject: (eventId, userId) =>
      invokeAuto("timeline:reject")(eventId, userId),
    getCounts: (locid) =>
      invokeAuto("timeline:getCounts")(locid),
  },

  // Date Engine (Migration 73 - NLP date extraction from web sources)
  dateEngine: {
    // Extraction
    extractFromWebSource: (sourceId) =>
      invokeAuto("dateEngine:extractFromWebSource")(sourceId),
    extractFromText: (input) =>
      invokeAuto("dateEngine:extractFromText")(input),
    preview: (text, articleDate) =>
      invokeAuto("dateEngine:preview")(text, articleDate),

    // Backfill
    backfillWebSources: (options) =>
      invokeLong("dateEngine:backfillWebSources")(options),
    backfillImageCaptions: (options) =>
      invokeLong("dateEngine:backfillImageCaptions")(options),

    // Query
    getPendingReview: (limit, offset) =>
      invokeAuto("dateEngine:getPendingReview")(limit, offset),
    getPendingByLocation: (locid) =>
      invokeAuto("dateEngine:getPendingByLocation")(locid),
    getByLocation: (locid, filters) =>
      invokeAuto("dateEngine:getByLocation")(locid, filters),
    getConflicts: () =>
      invokeAuto("dateEngine:getConflicts")(),
    getById: (extractionId) =>
      invokeAuto("dateEngine:getById")(extractionId),
    find: (filters) =>
      invokeAuto("dateEngine:find")(filters),

    // Review Actions
    approve: (extractionId, userId) =>
      invokeAuto("dateEngine:approve")(extractionId, userId),
    reject: (extractionId, userId, reason) =>
      invokeAuto("dateEngine:reject")(extractionId, userId, reason),
    approveAndResolveConflict: (extractionId, userId, updateTimeline) =>
      invokeAuto("dateEngine:approveAndResolveConflict")(extractionId, userId, updateTimeline),
    convertToTimeline: (extractionId, userId) =>
      invokeAuto("dateEngine:convertToTimeline")(extractionId, userId),
    revert: (extractionId, userId) =>
      invokeAuto("dateEngine:revert")(extractionId, userId),
    mergeDuplicates: (primaryId, duplicateId) =>
      invokeAuto("dateEngine:mergeDuplicates")(primaryId, duplicateId),

    // Statistics
    getStats: () =>
      invokeAuto("dateEngine:getStats")(),
    getLearningStats: () =>
      invokeAuto("dateEngine:getLearningStats")(),

    // CSV Export/Import
    exportPending: () =>
      invokeAuto("dateEngine:exportPending")(),
    importReviewed: (csvContent, userId) =>
      invokeAuto("dateEngine:importReviewed")(csvContent, userId),

    // Custom Patterns
    getPatterns: (enabledOnly) =>
      invokeAuto("dateEngine:getPatterns")(enabledOnly),
    getPattern: (patternId) =>
      invokeAuto("dateEngine:getPattern")(patternId),
    savePattern: (patternId, input) =>
      invokeAuto("dateEngine:savePattern")(patternId, input),
    deletePattern: (patternId) =>
      invokeAuto("dateEngine:deletePattern")(patternId),
    testPattern: (pattern, testText) =>
      invokeAuto("dateEngine:testPattern")(pattern, testText),

    // OCR Document Extraction
    extractFromDocument: (input) =>
      invokeLong("dateEngine:extractFromDocument")(input),
  },

  // Document Intelligence Extraction (spaCy + Ollama + Cloud)
  extraction: {
    // Main extraction
    extract: (input) =>
      invokeLong("extraction:extract")(input),
    extractFromWebSource: (sourceId, options) =>
      invokeLong("extraction:extractFromWebSource")(sourceId, options),
    extractBatch: (request) =>
      invokeLong("extraction:extractBatch")(request),

    // Provider management
    getProviders: () =>
      invokeAuto("extraction:getProviders")(),
    getProviderStatuses: () =>
      invokeAuto("extraction:getProviderStatuses")(),
    updateProvider: (providerId, updates) =>
      invokeAuto("extraction:updateProvider")(providerId, updates),
    addProvider: (config) =>
      invokeAuto("extraction:addProvider")(config),
    removeProvider: (providerId) =>
      invokeAuto("extraction:removeProvider")(providerId),
    testProvider: (providerId, testText) =>
      invokeLong("extraction:testProvider")(providerId, testText),

    // Health & diagnostics
    healthCheck: () =>
      invokeAuto("extraction:healthCheck")(),

    // Ollama-specific
    testOllamaConnection: (host, port) =>
      invokeAuto("extraction:testOllamaConnection")(host, port),
    listOllamaModels: (host, port) =>
      invokeAuto("extraction:listOllamaModels")(host, port),
    pullOllamaModel: (modelName, host, port) =>
      invokeLong("extraction:pullOllamaModel")(modelName, host, port),

    // Queue management (OPT-120)
    queue: {
      start: () => invokeAuto("extraction:queue:start")(),
      stop: () => invokeAuto("extraction:queue:stop")(),
      enqueue: (sourceType, sourceId, locid, tasks, priority) =>
        invokeAuto("extraction:queue:enqueue")(sourceType, sourceId, locid, tasks, priority),
      status: () => invokeAuto("extraction:queue:status")(),
      cleanup: (olderThanDays) => invokeAuto("extraction:queue:cleanup")(olderThanDays),
    },

    // Auto-tagger (OPT-120)
    tagger: {
      detectTags: (text, buildYear) =>
        invokeAuto("extraction:tagger:detectTags")(text, buildYear),
      tagLocation: (locid) =>
        invokeAuto("extraction:tagger:tagLocation")(locid),
      tagAllUntagged: () =>
        invokeLong("extraction:tagger:tagAllUntagged")(),
    },

    // Entity queries (OPT-120)
    entities: {
      getByLocation: (locid) =>
        invokeAuto("extraction:entities:getByLocation")(locid),
      updateStatus: (extractionId, status) =>
        invokeAuto("extraction:entities:updateStatus")(extractionId, status),
    },

    // Preprocessing (NEW - Phase 5)
    preprocess: {
      analyze: (text, articleDate, maxSentences) =>
        invokeAuto("extraction:preprocess")(text, articleDate, maxSentences),
      isAvailable: () =>
        invokeAuto("extraction:preprocess:isAvailable")(),
      getVerbCategories: () =>
        invokeAuto("extraction:preprocess:verbCategories")(),
    },

    // People Profiles (NEW - Phase 6)
    profiles: {
      people: {
        getByLocation: (locid) =>
          invokeAuto("extraction:profiles:people:getByLocation")(locid),
        search: (query) =>
          invokeAuto("extraction:profiles:search")(query, 'people'),
        updateStatus: (personId, status) =>
          invokeAuto("extraction:profiles:people:updateStatus")(personId, status),
      },
      companies: {
        getByLocation: (locid) =>
          invokeAuto("extraction:profiles:companies:getByLocation")(locid),
        search: (query) =>
          invokeAuto("extraction:profiles:search")(query, 'companies'),
        updateStatus: (companyId, status) =>
          invokeAuto("extraction:profiles:companies:updateStatus")(companyId, status),
      },
    },

    // Fact Conflicts (NEW - Phase 7)
    conflicts: {
      getByLocation: (locid, includeResolved) =>
        invokeAuto("extraction:conflicts:getByLocation")(locid, includeResolved),
      getSummary: (locid) =>
        invokeAuto("extraction:conflicts:getSummary")(locid),
      resolve: (conflictId, resolution, resolvedValue, userId, notes) =>
        invokeAuto("extraction:conflicts:resolve")(conflictId, resolution, resolvedValue, userId, notes),
      detect: (locid) =>
        invokeAuto("extraction:conflicts:detect")(locid),
      suggestResolution: (conflictId) =>
        invokeAuto("extraction:conflicts:suggestResolution")(conflictId),
      getSourceAuthorities: () =>
        invokeAuto("extraction:conflicts:getSourceAuthorities")(),
      updateSourceAuthority: (domain, tier, notes) =>
        invokeAuto("extraction:conflicts:updateSourceAuthority")(domain, tier, notes),
    },

    // Timeline Deduplication (NEW - Phase 8)
    timelineMerge: {
      deduplicate: (locid) =>
        invokeAuto("extraction:timeline:deduplicate")(locid),
      getMergeConfig: () =>
        invokeAuto("extraction:timeline:getMergeConfig")(),
      updateMergeConfig: (config) =>
        invokeAuto("extraction:timeline:updateMergeConfig")(config),
    },

    // Versioned Prompts (NEW - Phase 4)
    prompts: {
      getSummary: () =>
        invokeAuto("extraction:prompts:getSummary")(),
      getVersions: (promptType) =>
        invokeAuto("extraction:prompts:getVersions")(promptType),
      setDefault: (promptType, version) =>
        invokeAuto("extraction:prompts:setDefault")(promptType, version),
    },

    // Extracted Addresses (LLM Tools Overhaul)
    addresses: {
      getByLocation: (locid, includeRejected) =>
        invokeAuto("extraction:addresses:getByLocation")(locid, includeRejected),
      apply: (addressId, userId) =>
        invokeAuto("extraction:addresses:apply")(addressId, userId),
      reject: (addressId, userId) =>
        invokeAuto("extraction:addresses:reject")(addressId, userId),
      approve: (addressId, userId) =>
        invokeAuto("extraction:addresses:approve")(addressId, userId),
      count: (locid) =>
        invokeAuto("extraction:addresses:count")(locid),
      save: (locid, sourceId, addresses, corrections) =>
        invokeAuto("extraction:addresses:save")(locid, sourceId, addresses, corrections),
    },

    // Research Counts (LLM Tools Overhaul - conditional visibility)
    research: {
      getCounts: (locid) =>
        invokeAuto("extraction:research:getCounts")(locid),
    },
  },

  // Migration 76: RAM++ Image Auto-Tagging
  // Per CLAUDE.md Rule 9: Local LLMs for background tasks only
  tagging: {
    // Image tag operations
    getImageTags: (imghash) =>
      invokeAuto("tagging:getImageTags")(imghash),
    editImageTags: (input) =>
      invokeAuto("tagging:editImageTags")(input),
    retagImage: (imghash) =>
      invokeAuto("tagging:retagImage")(imghash),
    clearImageTags: (imghash) =>
      invokeAuto("tagging:clearImageTags")(imghash),

    // Location tag summary
    getLocationSummary: (locid) =>
      invokeAuto("tagging:getLocationSummary")(locid),
    reaggregateLocation: (locid) =>
      invokeAuto("tagging:reaggregateLocation")(locid),
    applySuggestions: (input) =>
      invokeAuto("tagging:applySuggestions")(input),

    // Queue management
    getQueueStats: () =>
      invokeAuto("tagging:getQueueStats")(),
    queueUntaggedImages: (locid) =>
      invokeAuto("tagging:queueUntaggedImages")(locid),

    // Service status
    getServiceStatus: () =>
      invokeAuto("tagging:getServiceStatus")(),
    testConnection: () =>
      invokeAuto("tagging:testConnection")(),

    // Event listeners for real-time tag updates
    onTagsReady: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("asset:tags-ready", listener);
      return () => ipcRenderer.removeListener("asset:tags-ready", listener);
    },
    onLocationAggregated: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("location:tags-aggregated", listener);
      return () => ipcRenderer.removeListener("location:tags-aggregated", listener);
    },
  },

  // OPT-125: Ollama Lifecycle Management
  // Seamless auto-start/stop of local Ollama
  ollama: {
    // Get current lifecycle status
    getStatus: () =>
      invokeAuto("ollama:getStatus")(),
    // Ensure Ollama is running (starts if needed)
    ensureRunning: () =>
      invokeLong("ollama:ensureRunning")(),
    // Stop Ollama (only if we started it)
    stop: () =>
      invokeAuto("ollama:stop")(),
    // Check if Ollama is installed
    checkInstalled: () =>
      invokeAuto("ollama:checkInstalled")(),
  },

  // Credential Management (Migration 85)
  // Secure API key storage using Electron safeStorage
  credentials: {
    // Store encrypted API key (auto-tests and enables provider)
    store: (provider, apiKey) =>
      invokeAuto("credentials:store")({ provider, apiKey }),
    // Check if credential exists (never exposes key)
    has: (provider) =>
      invokeAuto("credentials:has")({ provider }),
    // Delete stored credential (auto-disables provider)
    delete: (provider) =>
      invokeAuto("credentials:delete")({ provider }),
    // List all providers with stored credentials
    list: () =>
      invokeAuto("credentials:list")(),
    // Get credential info (last used, created date) without exposing key
    info: (provider) =>
      invokeAuto("credentials:info")({ provider }),
    // Test connection with stored credentials
    test: (provider) =>
      invokeLong("credentials:test")({ provider }),
  },

  // LiteLLM Proxy Gateway (Migration 86)
  // Unified AI gateway for cloud providers
  litellm: {
    // Get current proxy status
    status: () =>
      invokeAuto("litellm:status")(),
    // Start LiteLLM proxy
    start: () =>
      invokeLong("litellm:start")(),
    // Stop LiteLLM proxy
    stop: () =>
      invokeAuto("litellm:stop")(),
    // Reload configuration (after credential changes)
    reload: () =>
      invokeAuto("litellm:reload")(),
    // Test a model connection
    test: (modelId) =>
      invokeLong("litellm:test")({ modelId }),
    // Get usage costs (if available)
    costs: () =>
      invokeAuto("litellm:costs")(),
    // List available models
    models: () =>
      invokeAuto("litellm:models")(),
    // Settings management
    settings: {
      get: () =>
        invokeAuto("litellm:settings:get")(),
      set: (key, value) =>
        invokeAuto("litellm:settings:set")({ key, value }),
    },
    // Privacy settings
    privacy: {
      get: () =>
        invokeAuto("litellm:privacy:get")(),
      update: (updates) =>
        invokeAuto("litellm:privacy:update")(updates),
    },
  },

  // Cost Tracking (Migration 88)
  // Track LLM usage costs for cloud providers
  costs: {
    // Record a new cost entry (called by extraction services)
    record: (input) =>
      invokeAuto("costs:record")(input),
    // Get cost summary for a period
    getSummary: (startDate, endDate) =>
      invokeAuto("costs:getSummary")({ startDate, endDate }),
    // Get daily cost breakdown
    getDailyCosts: (days) =>
      invokeAuto("costs:getDailyCosts")({ days }),
    // Get current month's total cost
    getCurrentMonth: () =>
      invokeAuto("costs:getCurrentMonth")(),
    // Check if current month exceeds budget
    checkBudget: (monthlyBudget) =>
      invokeAuto("costs:checkBudget")({ monthlyBudget }),
    // Get costs for a specific location
    getLocationCosts: (locid) =>
      invokeAuto("costs:getLocationCosts")({ locid }),
    // Get recent cost entries
    getRecent: (limit) =>
      invokeAuto("costs:getRecent")({ limit }),
    // Get pricing info for a model
    getModelPricing: (model) =>
      invokeAuto("costs:getModelPricing")(model),
    // Delete old cost entries
    cleanup: (olderThanDays) =>
      invokeAuto("costs:cleanup")({ olderThanDays }),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

// Drag-Drop File Path Extraction
let lastDroppedPaths = [];

const setupDropListener = () => {
  document.addEventListener("drop", (event) => {
    lastDroppedPaths = [];

    if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
      return;
    }

    for (const file of Array.from(event.dataTransfer.files)) {
      try {
        // Try webUtils first (Electron 28+), fallback to deprecated file.path
        let filePath = null;
        if (webUtils && typeof webUtils.getPathForFile === 'function') {
          filePath = webUtils.getPathForFile(file);
        } else if (file.path) {
          // Fallback: deprecated file.path still works in Electron 28
          filePath = file.path;
        } else if (DEBUG) {
          console.warn("[Preload] Neither webUtils nor file.path available for:", file.name);
        }

        if (filePath) {
          lastDroppedPaths.push(filePath);
        }
      } catch (e) {
        console.error("[Preload] Failed to get path for file:", file.name, e);
      }
    }

    if (DEBUG) {
      console.log("[Preload] Extracted", lastDroppedPaths.length, "paths from drop");
    }
  }, { capture: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupDropListener);
} else {
  setupDropListener();
}

contextBridge.exposeInMainWorld("getDroppedFilePaths", () => {
  return [...lastDroppedPaths];
});

contextBridge.exposeInMainWorld("extractFilePaths", (_files) => {
  return [...lastDroppedPaths];
});
