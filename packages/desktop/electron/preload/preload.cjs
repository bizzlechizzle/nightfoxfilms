"use strict";
// Nightfox Films Preload Script - Pure CommonJS
// This file is NOT processed by Vite - it's used directly by Electron
// CRITICAL: Keep this as CommonJS. Never use 'import' statements.

const DEBUG = process.env.DEBUG_PRELOAD === "1";

const electronModule = require("electron");

// Try different ways to access webUtils
let webUtils = electronModule.webUtils;
if (!webUtils) {
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
  console.log("[Preload] webUtils available:", !!webUtils);
  console.log("[Preload] contextBridge available:", !!contextBridge);
  console.log("[Preload] ipcRenderer available:", !!ipcRenderer);
}

// IPC timeout wrapper to prevent hanging operations
const DEFAULT_IPC_TIMEOUT = 30000; // 30 seconds for most operations
const LONG_IPC_TIMEOUT = 120000; // 2 minutes for import operations

/**
 * Wrap an IPC invoke call with a timeout
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
 */
function invoke(channel, timeout = DEFAULT_IPC_TIMEOUT) {
  return (...args) => withTimeout(ipcRenderer.invoke(channel, ...args), timeout, channel);
}

/**
 * Create a wrapped IPC invoke function with long timeout
 */
function invokeLong(channel) {
  return invoke(channel, LONG_IPC_TIMEOUT);
}

// API exposed to renderer via window.electronAPI
const api = {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },
  platform: process.platform,

  // Settings
  settings: {
    get: (key) => invoke("settings:get")(key),
    getAll: () => invoke("settings:getAll")(),
    set: (key, value) => invoke("settings:set")(key, value),
  },

  // Dialog
  dialog: {
    selectFolder: () => invoke("dialog:selectFolder")(),
    selectFiles: () => invoke("dialog:selectFiles")(),
  },

  // Database
  database: {
    getLocation: () => invoke("database:getLocation")(),
    getStats: () => invoke("database:getStats")(),
  },

  // Couples
  couples: {
    findAll: () => invoke("couples:findAll")(),
    findById: (id) => invoke("couples:findById")(id),
    findWithFiles: (id) => invoke("couples:findWithFiles")(id),
    search: (query) => invoke("couples:search")(query),
    getStats: (id) => invoke("couples:getStats")(id),
    create: (input) => invoke("couples:create")(input),
    update: (id, input) => invoke("couples:update")(id, input),
    delete: (id) => invoke("couples:delete")(id),
    exportJson: (id) => invoke("couples:exportJson")(id),
  },

  // Cameras
  cameras: {
    findAll: () => invoke("cameras:findAll")(),
    findById: (id) => invoke("cameras:findById")(id),
    findByMedium: (medium) => invoke("cameras:findByMedium")(medium),
    create: (input) => invoke("cameras:create")(input),
    update: (id, input) => invoke("cameras:update")(id, input),
    delete: (id) => invoke("cameras:delete")(id),
    setDefault: (id) => invoke("cameras:setDefault")(id),
    matchFile: (filePath) => invoke("cameras:matchFile")(filePath),
  },

  // Camera patterns
  cameraPatterns: {
    findByCamera: (cameraId) => invoke("cameraPatterns:findByCamera")(cameraId),
    create: (input) => invoke("cameraPatterns:create")(input),
    delete: (id) => invoke("cameraPatterns:delete")(id),
  },

  // Files
  files: {
    findAll: (filters) => invoke("files:findAll")(filters),
    findById: (id) => invoke("files:findById")(id),
    findByCouple: (coupleId) => invoke("files:findByCouple")(coupleId),
    findByHash: (hash) => invoke("files:findByHash")(hash),
    getMetadata: (id) => invoke("files:getMetadata")(id),
    updateCamera: (id, cameraId) => invoke("files:updateCamera")(id, cameraId),
    delete: (id) => invoke("files:delete")(id),
  },

  // Import
  import: {
    files: (filePaths, coupleId) => invokeLong("import:files")(filePaths, coupleId),
    directory: (dirPath, coupleId) => invokeLong("import:directory")(dirPath, coupleId),
    scan: (dirPath) => invoke("import:scan")(dirPath),
    cancel: () => invoke("import:cancel")(),
    status: () => invoke("import:status")(),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("import:progress", listener);
      return () => ipcRenderer.removeListener("import:progress", listener);
    },
    onComplete: (callback) => {
      const listener = (_event, result) => callback(result);
      ipcRenderer.on("import:complete", listener);
      return () => ipcRenderer.removeListener("import:complete", listener);
    },
  },

  // Export
  export: {
    screenshot: (input) => invokeLong("export:screenshot")(input),
    clip: (input) => invokeLong("export:clip")(input),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("export:progress", listener);
      return () => ipcRenderer.removeListener("export:progress", listener);
    },
  },

  // Scenes
  scenes: {
    detect: (fileId) => invokeLong("scenes:detect")(fileId),
    findByFile: (fileId) => invoke("scenes:findByFile")(fileId),
    update: (sceneId, updates) => invoke("scenes:update")(sceneId, updates),
    delete: (sceneId) => invoke("scenes:delete")(sceneId),
  },

  // Sharpness analysis
  sharpness: {
    analyze: (fileId) => invokeLong("sharpness:analyze")(fileId),
    getScore: (fileId) => invoke("sharpness:getScore")(fileId),
  },

  // AI Captioning
  ai: {
    getStatus: () => invoke("ai:getStatus")(),
    start: (settings) => invoke("ai:start")(settings),
    stop: () => invoke("ai:stop")(),
    caption: (input) => invokeLong("ai:caption")(input),
    captionScene: (input) => invokeLong("ai:captionScene")(input),
    captionAllScenes: (input) => invokeLong("ai:captionAllScenes")(input),
    detectMoment: (input) => invokeLong("ai:detectMoment")(input),
    onCaptionProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("ai:captionProgress", listener);
      return () => ipcRenderer.removeListener("ai:captionProgress", listener);
    },
  },

  // Jobs queue
  jobs: {
    status: () => invoke("jobs:status")(),
    cancel: (jobId) => invoke("jobs:cancel")(jobId),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("jobs:progress", listener);
      return () => ipcRenderer.removeListener("jobs:progress", listener);
    },
  },

  // Weddings (Photography CMS)
  weddings: {
    create: (input) => invoke("weddings:create")(input),
    findById: (id) => invoke("weddings:findById")(id),
    findAll: (filters) => invoke("weddings:findAll")(filters),
    update: (id, input) => invoke("weddings:update")(id, input),
    updateStatus: (id, status, notes) => invoke("weddings:updateStatus")(id, status, notes),
    delete: (id) => invoke("weddings:delete")(id),
    getHistory: (id) => invoke("weddings:getHistory")(id),
    getDashboardStats: () => invoke("weddings:getDashboardStats")(),
    getMonthlyStats: (year, month) => invoke("weddings:getMonthlyStats")(year, month),
    getYearlyStats: (year) => invoke("weddings:getYearlyStats")(year),
    getForMonth: (year, month) => invoke("weddings:getForMonth")(year, month),
    selectFolder: () => invoke("weddings:selectFolder")(),
  },

  // Shell operations
  shell: {
    openExternal: (url) => invoke("shell:openExternal")(url),
    openPath: (path) => invoke("shell:openPath")(path),
    showItemInFolder: (path) => invoke("shell:showItemInFolder")(path),
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
        let filePath = null;
        if (webUtils && typeof webUtils.getPathForFile === 'function') {
          filePath = webUtils.getPathForFile(file);
        } else if (file.path) {
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
