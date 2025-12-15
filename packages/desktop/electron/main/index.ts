/**
 * Nightfox Films - Electron Main Process
 *
 * Entry point for the desktop application.
 * Handles window creation, IPC registration, and app lifecycle.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initializeDatabase, closeDatabase, getDatabaseStats, getDefaultDatabasePath } from './database';
import {
  settingsRepository,
  camerasRepository,
  cameraPatternsRepository,
  couplesRepository,
  filesRepository,
  scenesRepository,
  jobsRepository,
  weddingsRepository,
  type CreateWeddingInput,
  type UpdateWeddingInput,
  type WeddingFilters,
  type WeddingStatus,
} from '../repositories';
import { CameraInputSchema, CameraPatternInputSchema, CoupleInputSchema } from '@nightfox/core';
import {
  matchFileWithDefault,
  detectMediumFromMetadata,
  getMediaInfo,
  importController,
  importService,
  detectScenes,
  findSharpestFrame,
  getSharpnessScore,
  exportScreenshot,
  exportClip,
  litellmService,
  captioningService,
  type LiteLLMSettings,
} from '../services';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine environment
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Global window reference
let mainWindow: BrowserWindow | null = null;

/**
 * Create the main application window
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Nightfox Films',
    backgroundColor: '#FAFAF8', // Braun background color
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for drag-drop path helpers
    },
  });

  // Load the app
  if (isDev) {
    // Development: Load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from built files
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// =============================================================================
// IPC HANDLERS - Settings
// =============================================================================

ipcMain.handle('settings:get', async (_, key: string) => {
  return settingsRepository.get(key);
});

ipcMain.handle('settings:getAll', async () => {
  return settingsRepository.getAll();
});

ipcMain.handle('settings:set', async (_, key: string, value: string | null) => {
  settingsRepository.set(key, value);
  return true;
});

// =============================================================================
// IPC HANDLERS - Dialog
// =============================================================================

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'mts', 'm2ts', 'mxf', 'tod', 'mod'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

// =============================================================================
// IPC HANDLERS - Shell
// =============================================================================

ipcMain.handle('shell:openExternal', async (_, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('shell:openPath', async (_, filePath: string) => {
  await shell.openPath(filePath);
});

ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// =============================================================================
// IPC HANDLERS - Database
// =============================================================================

ipcMain.handle('database:getLocation', async () => {
  return getDefaultDatabasePath();
});

ipcMain.handle('database:getStats', async () => {
  return getDatabaseStats();
});

// =============================================================================
// IPC HANDLERS - Couples
// =============================================================================

ipcMain.handle('couples:findAll', async () => {
  return couplesRepository.findAll();
});

ipcMain.handle('couples:findById', async (_, id: number) => {
  return couplesRepository.findById(id);
});

ipcMain.handle('couples:findWithFiles', async (_, id: number) => {
  return couplesRepository.findWithFiles(id);
});

ipcMain.handle('couples:search', async (_, query: string) => {
  return couplesRepository.search(query);
});

ipcMain.handle('couples:getStats', async (_, id: number) => {
  return couplesRepository.getStats(id);
});

ipcMain.handle('couples:create', async (_, input: unknown) => {
  const validated = CoupleInputSchema.parse(input);
  return couplesRepository.create(validated);
});

ipcMain.handle('couples:update', async (_, id: number, input: unknown) => {
  const validated = CoupleInputSchema.partial().parse(input);
  return couplesRepository.update(id, validated);
});

ipcMain.handle('couples:delete', async (_, id: number) => {
  return couplesRepository.delete(id);
});

ipcMain.handle('couples:exportJson', async (_, id: number) => {
  const data = couplesRepository.exportToJson(id);
  if (!data) return null;

  // Show save dialog
  const result = await dialog.showSaveDialog({
    title: 'Export Couple Data',
    defaultPath: `couple-${id}-export.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePath) return null;

  // Write the file
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));

  // Update export timestamp
  couplesRepository.updateExportTimestamp(id, result.filePath);

  return result.filePath;
});

// =============================================================================
// IPC HANDLERS - Cameras
// =============================================================================

ipcMain.handle('cameras:findAll', async () => {
  return camerasRepository.findAllWithPatterns();
});

ipcMain.handle('cameras:findById', async (_, id: number) => {
  return camerasRepository.findWithPatterns(id);
});

ipcMain.handle('cameras:create', async (_, input: unknown) => {
  const validated = CameraInputSchema.parse(input);
  return camerasRepository.create(validated);
});

ipcMain.handle('cameras:update', async (_, id: number, input: unknown) => {
  const validated = CameraInputSchema.partial().parse(input);
  return camerasRepository.update(id, validated);
});

ipcMain.handle('cameras:delete', async (_, id: number) => {
  return camerasRepository.delete(id);
});

ipcMain.handle('cameras:setDefault', async (_, id: number) => {
  return camerasRepository.setDefault(id);
});

ipcMain.handle('cameras:findByMedium', async (_, medium: string) => {
  return camerasRepository.findByMedium(medium as any);
});

ipcMain.handle('cameras:matchFile', async (_, filePath: string) => {
  try {
    // Get all cameras with patterns
    const cameras = camerasRepository.findAllWithPatterns();
    if (cameras.length === 0) {
      return null;
    }

    // Try to get metadata for make/model detection
    let detectedMake: string | null = null;
    let detectedModel: string | null = null;
    let detectedMedium: 'dadcam' | 'super8' | 'modern' = 'modern';

    try {
      const mediaInfo = await getMediaInfo(filePath);
      detectedMake = mediaInfo.make;
      detectedModel = mediaInfo.model;

      // Detect medium from resolution
      if (mediaInfo.width && mediaInfo.height) {
        detectedMedium = detectMediumFromMetadata(
          mediaInfo.width,
          mediaInfo.height,
          null,
          mediaInfo.frameRate
        );
      }
    } catch {
      // Metadata extraction failed, proceed with filename matching only
    }

    // Match the file
    const result = matchFileWithDefault(
      filePath,
      cameras,
      detectedMedium,
      detectedMake,
      detectedModel
    );

    return result;
  } catch (error) {
    console.error('[cameras:matchFile] Error:', error);
    return null;
  }
});

// =============================================================================
// IPC HANDLERS - Camera Patterns
// =============================================================================

ipcMain.handle('cameraPatterns:findByCamera', async (_, cameraId: number) => {
  return cameraPatternsRepository.findByCamera(cameraId);
});

ipcMain.handle('cameraPatterns:create', async (_, input: unknown) => {
  const validated = CameraPatternInputSchema.parse(input);
  return cameraPatternsRepository.create(validated);
});

ipcMain.handle('cameraPatterns:delete', async (_, id: number) => {
  return cameraPatternsRepository.delete(id);
});

// =============================================================================
// IPC HANDLERS - Files
// =============================================================================

ipcMain.handle('files:findAll', async (_, filters?: unknown) => {
  return filesRepository.findAllWithCamera(filters as any);
});

ipcMain.handle('files:findById', async (_, id: number) => {
  return filesRepository.findById(id);
});

ipcMain.handle('files:findByCouple', async (_, coupleId: number) => {
  return filesRepository.findByCouple(coupleId);
});

ipcMain.handle('files:findByHash', async (_, hash: string) => {
  return filesRepository.findByHash(hash);
});

ipcMain.handle('files:getMetadata', async (_, id: number) => {
  return filesRepository.getMetadata(id);
});

ipcMain.handle('files:updateCamera', async (_, id: number, cameraId: number | null) => {
  return filesRepository.updateCamera(id, cameraId);
});

ipcMain.handle('files:delete', async (_, id: number) => {
  return filesRepository.delete(id);
});

// =============================================================================
// IPC HANDLERS - Scenes
// =============================================================================

ipcMain.handle('scenes:detect', async (_, fileId: number) => {
  try {
    const file = filesRepository.findById(fileId);
    if (!file || !file.original_path) {
      return [];
    }

    // Run scene detection
    const result = await detectScenes(file.original_path, {
      method: 'content',
      threshold: 0.3,
      minSceneDuration: 1,
    });

    // Save scenes to database
    const savedScenes = [];
    for (const scene of result.scenes) {
      const saved = scenesRepository.create({
        file_id: fileId,
        scene_number: scene.scene_number,
        start_time: scene.start_time,
        end_time: scene.end_time,
        duration: scene.duration,
        start_frame: scene.start_frame,
        end_frame: scene.end_frame,
        detection_method: result.method,
      });
      savedScenes.push(saved);
    }

    return savedScenes;
  } catch (error) {
    console.error('[scenes:detect] Error:', error);
    return [];
  }
});

ipcMain.handle('scenes:findByFile', async (_, fileId: number) => {
  return scenesRepository.findByFile(fileId);
});

ipcMain.handle('scenes:update', async (_, sceneId: number, updates: unknown) => {
  return scenesRepository.update(sceneId, updates as any);
});

ipcMain.handle('scenes:delete', async (_, sceneId: number) => {
  return scenesRepository.delete(sceneId);
});

// =============================================================================
// IPC HANDLERS - Import
// =============================================================================

ipcMain.handle('import:files', async (_, filePaths: string[], coupleId?: number) => {
  try {
    const result = await importController.importFiles(filePaths, {
      coupleId,
      window: mainWindow ?? undefined,
    });
    return result;
  } catch (error) {
    console.error('[import:files] Error:', error);
    throw error;
  }
});

ipcMain.handle('import:directory', async (_, dirPath: string, coupleId?: number) => {
  try {
    const result = await importController.importDirectory(dirPath, {
      coupleId,
      window: mainWindow ?? undefined,
    });
    return result;
  } catch (error) {
    console.error('[import:directory] Error:', error);
    throw error;
  }
});

ipcMain.handle('import:scan', async (_, dirPath: string) => {
  try {
    return await importController.scanDirectory(dirPath);
  } catch (error) {
    console.error('[import:scan] Error:', error);
    throw error;
  }
});

ipcMain.handle('import:cancel', async () => {
  return importController.cancelImport();
});

ipcMain.handle('import:status', async () => {
  return importController.getStatus();
});

// =============================================================================
// IPC HANDLERS - Export
// =============================================================================

ipcMain.handle('export:screenshot', async (_, input: {
  fileId: number;
  timeSeconds: number;
  aspectRatio?: string;
  width?: number;
}) => {
  try {
    const file = filesRepository.findById(input.fileId);
    if (!file || !file.original_path) {
      return null;
    }

    // Get camera for LUT path
    let lutPath: string | undefined;
    if (file.camera_id) {
      const camera = camerasRepository.findById(file.camera_id);
      if (camera?.lut_path) {
        lutPath = camera.lut_path;
      }
    }

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Export Screenshot',
      defaultPath: `${path.basename(file.original_filename, path.extname(file.original_filename))}_screenshot.jpg`,
      filters: [
        { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
        { name: 'PNG', extensions: ['png'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await exportScreenshot(file.original_path, {
      timeSeconds: input.timeSeconds,
      outputPath: result.filePath,
      aspectRatio: input.aspectRatio as any,
      width: input.width,
      lutPath,
    });

    return result.filePath;
  } catch (error) {
    console.error('[export:screenshot] Error:', error);
    return null;
  }
});

ipcMain.handle('export:clip', async (_, input: {
  fileId: number;
  startTime: number;
  endTime: number;
  aspectRatio?: string;
  normalizeAudio?: boolean;
}) => {
  try {
    const file = filesRepository.findById(input.fileId);
    if (!file || !file.original_path) {
      return null;
    }

    // Get camera for LUT path
    let lutPath: string | undefined;
    if (file.camera_id) {
      const camera = camerasRepository.findById(file.camera_id);
      if (camera?.lut_path) {
        lutPath = camera.lut_path;
      }
    }

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Export Clip',
      defaultPath: `${path.basename(file.original_filename, path.extname(file.original_filename))}_clip.mp4`,
      filters: [
        { name: 'MP4', extensions: ['mp4'] },
        { name: 'MOV', extensions: ['mov'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await exportClip(file.original_path, {
      startTime: input.startTime,
      endTime: input.endTime,
      outputPath: result.filePath,
      aspectRatio: input.aspectRatio as any,
      lutPath,
      normalizeAudio: input.normalizeAudio,
      onProgress: (percent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('export:progress', { percent });
        }
      },
    });

    return result.filePath;
  } catch (error) {
    console.error('[export:clip] Error:', error);
    return null;
  }
});

// =============================================================================
// IPC HANDLERS - Sharpness
// =============================================================================

ipcMain.handle('sharpness:analyze', async (_, fileId: number, options?: {
  startTime?: number;
  endTime?: number;
  sampleInterval?: number;
}) => {
  try {
    const file = filesRepository.findById(fileId);
    if (!file || !file.original_path) {
      return null;
    }

    const result = await findSharpestFrame(file.original_path, {
      startTime: options?.startTime,
      endTime: options?.endTime,
      sampleInterval: options?.sampleInterval ?? 1,
    });

    return result;
  } catch (error) {
    console.error('[sharpness:analyze] Error:', error);
    return null;
  }
});

ipcMain.handle('sharpness:getScore', async (_, fileId: number, timeSeconds?: number) => {
  try {
    const file = filesRepository.findById(fileId);
    if (!file || !file.original_path) {
      return null;
    }

    // Use middle of video if no time specified
    const time = timeSeconds ?? (file.duration_seconds ? file.duration_seconds / 2 : 0);

    const score = await getSharpnessScore(file.original_path, time);
    return score;
  } catch (error) {
    console.error('[sharpness:getScore] Error:', error);
    return null;
  }
});

// =============================================================================
// IPC HANDLERS - AI
// =============================================================================

ipcMain.handle('ai:getStatus', async () => {
  try {
    return await litellmService.getStatus();
  } catch (error) {
    console.error('[ai:getStatus] Error:', error);
    return { installed: false, running: false, managedByApp: false, port: 4000, configuredModels: [], lastError: String(error) };
  }
});

ipcMain.handle('ai:start', async (_, settings: LiteLLMSettings) => {
  try {
    const success = await litellmService.start(settings);
    return { success };
  } catch (error) {
    console.error('[ai:start] Error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ai:stop', async () => {
  try {
    litellmService.stop();
    return { success: true };
  } catch (error) {
    console.error('[ai:stop] Error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ai:caption', async (_, input: {
  fileId: number;
  timeSeconds: number;
  model?: string;
  prompt?: string;
}) => {
  try {
    const file = filesRepository.findById(input.fileId);
    if (!file || !file.original_path) {
      return { success: false, error: 'File not found' };
    }

    const result = await captioningService.captionFrame(file.original_path, input.timeSeconds, {
      model: input.model,
      prompt: input.prompt,
    });

    return { success: true, ...result };
  } catch (error) {
    console.error('[ai:caption] Error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ai:captionScene', async (_, input: {
  fileId: number;
  sceneId: number;
  model?: string;
  useSharpestFrame?: boolean;
}) => {
  try {
    const file = filesRepository.findById(input.fileId);
    if (!file || !file.original_path) {
      return { success: false, error: 'File not found' };
    }

    const scene = scenesRepository.findById(input.sceneId);
    if (!scene) {
      return { success: false, error: 'Scene not found' };
    }

    const result = await captioningService.captionScene(file.original_path, {
      start_time: scene.start_time,
      end_time: scene.end_time,
      scene_number: scene.scene_number,
    }, {
      model: input.model,
      useSharpestFrame: input.useSharpestFrame ?? true,
    });

    // Update scene with caption
    scenesRepository.update(scene.id, {
      caption: result.caption,
      wedding_moment: result.weddingMoment,
    });

    return { success: true, ...result };
  } catch (error) {
    console.error('[ai:captionScene] Error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ai:captionAllScenes', async (_, input: {
  fileId: number;
  model?: string;
}) => {
  try {
    const file = filesRepository.findById(input.fileId);
    if (!file || !file.original_path) {
      return { success: false, error: 'File not found' };
    }

    const scenes = scenesRepository.findByFile(input.fileId);
    if (scenes.length === 0) {
      return { success: false, error: 'No scenes found for file' };
    }

    const results = await captioningService.captionAllScenes(
      file.original_path,
      scenes.map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
        scene_number: s.scene_number,
      })),
      {
        model: input.model,
        onProgress: (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai:captionProgress', progress);
          }
        },
      }
    );

    // Update scenes with captions
    for (const result of results) {
      const scene = scenes.find(s => s.scene_number === result.sceneNumber);
      if (scene && result.caption) {
        scenesRepository.update(scene.id, {
          caption: result.caption,
          wedding_moment: result.weddingMoment,
        });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[ai:captionAllScenes] Error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ai:detectMoment', async (_, input: {
  fileId: number;
  timeSeconds: number;
  model?: string;
}) => {
  try {
    const file = filesRepository.findById(input.fileId);
    if (!file || !file.original_path) {
      return { success: false, error: 'File not found' };
    }

    // Extract frame
    const { getFrameBuffer } = await import('../services/ffmpeg-service');
    const frameBuffer = await getFrameBuffer(file.original_path, input.timeSeconds);
    const base64 = frameBuffer.toString('base64');

    const result = await litellmService.detectWeddingMoment(base64, input.model || 'caption-local');

    return { success: true, ...result };
  } catch (error) {
    console.error('[ai:detectMoment] Error:', error);
    return { success: false, error: String(error) };
  }
});

// =============================================================================
// IPC HANDLERS - Jobs
// =============================================================================

ipcMain.handle('jobs:status', async () => {
  return jobsRepository.getStats();
});

ipcMain.handle('jobs:cancel', async (_, jobId: number) => {
  return jobsRepository.cancel(jobId);
});

// =============================================================================
// IPC HANDLERS - Weddings (Photography CMS)
// =============================================================================

ipcMain.handle('weddings:create', async (_, input: CreateWeddingInput) => {
  return weddingsRepository.create(input);
});

ipcMain.handle('weddings:findById', async (_, id: string) => {
  return weddingsRepository.findById(id);
});

ipcMain.handle('weddings:findAll', async (_, filters?: WeddingFilters) => {
  return weddingsRepository.findAll(filters);
});

ipcMain.handle('weddings:update', async (_, id: string, input: UpdateWeddingInput) => {
  return weddingsRepository.update(id, input);
});

ipcMain.handle('weddings:updateStatus', async (_, id: string, status: WeddingStatus, notes?: string) => {
  return weddingsRepository.updateStatus(id, status, notes);
});

ipcMain.handle('weddings:delete', async (_, id: string) => {
  return weddingsRepository.delete(id);
});

ipcMain.handle('weddings:getHistory', async (_, id: string) => {
  return weddingsRepository.getStatusHistory(id);
});

ipcMain.handle('weddings:getDashboardStats', async () => {
  return weddingsRepository.getDashboardStats();
});

ipcMain.handle('weddings:getMonthlyStats', async (_, year: number, month: number) => {
  return weddingsRepository.getMonthlyStats(year, month);
});

ipcMain.handle('weddings:getYearlyStats', async (_, year: number) => {
  return weddingsRepository.getYearlyStats(year);
});

ipcMain.handle('weddings:getForMonth', async (_, year: number, month: number) => {
  return weddingsRepository.getWeddingsForMonth(year, month);
});

ipcMain.handle('weddings:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const folderPath = result.filePaths[0];

  // Count images in folder
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.cr2', '.nef', '.arw', '.raw', '.dng'];
  let imageCount = 0;

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.includes(ext)) {
          imageCount++;
        }
      }
    }
  } catch {
    // Ignore errors reading directory
  }

  // Try to parse metadata from folder name
  // Common formats: "2024-06-15 Smith & Jones", "Smith Jones Wedding", etc.
  const folderName = path.basename(folderPath);
  const parsedMeta: { partnerAName?: string; partnerBName?: string; weddingDate?: string } = {};

  // Try to extract date
  const dateMatch = folderName.match(/(\d{4}-\d{2}-\d{2})|(\d{2}-\d{2}-\d{4})/);
  if (dateMatch) {
    parsedMeta.weddingDate = dateMatch[1] || dateMatch[2];
  }

  // Try to extract names from "Name & Name" pattern
  const nameMatch = folderName.match(/([A-Z][a-z]+)\s*[&+]\s*([A-Z][a-z]+)/);
  if (nameMatch) {
    parsedMeta.partnerAName = nameMatch[1];
    parsedMeta.partnerBName = nameMatch[2];
  }

  return {
    path: folderPath,
    imageCount,
    parsedMeta: Object.keys(parsedMeta).length > 0 ? parsedMeta : undefined,
  };
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the main window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Create window when ready
  app.whenReady().then(() => {
    // Initialize database first
    console.log('[Main] Initializing database...');
    initializeDatabase();
    console.log('[Main] Database initialized');

    createWindow();

    // macOS: Re-create window when dock icon clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  // Quit when all windows are closed (except on macOS)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Clean up before quit
  app.on('before-quit', () => {
    console.log('[Main] Stopping AI services...');
    litellmService.stop();
    console.log('[Main] Closing database...');
    closeDatabase();
  });

  // Cleanup orphan LiteLLM process on startup
  litellmService.cleanupOrphan();
}
