/**
 * Nightfox Films - Electron Main Process
 *
 * Entry point for the desktop application.
 * Handles window creation, IPC registration, and app lifecycle.
 */

import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initializeDatabase, closeDatabase, getDatabaseStats, getDefaultDatabasePath } from './database';
import {
  settingsRepository,
  camerasRepository,
  cameraPatternsRepository,
  couplesRepository,
  lensesRepository,
  filesRepository,
  scenesRepository,
  jobsRepository,
  equipmentRepository,
  filmStockRepository,
  processingLabsRepository,
  cameraLoansRepository,
  filmUsageRepository,
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
  // Signature matching & training
  loadSignatureDatabase,
  matchSignature,
  searchSignatures,
  getSignatureDatabaseStats,
  startTrainingSession,
  getTrainingSession,
  cancelTrainingSession,
  addTrainingFiles,
  removeTrainingFile,
  analyzeTrainingFiles,
  exportSignatureJson,
  // USB device & camera registration
  getConnectedUSBDevices,
  getConnectedCameras,
  getConnectedJVCDevices,
  getRegisteredCameras,
  registerCamera,
  updateCamera,
  deleteRegisteredCamera,
  syncConnectedCameras,
  registerConnectedDevice,
  findCameraByUSBSerial,
  findCameraByVolumeUUID,
  findCameraForMountPoint,
  // Document sync
  syncCoupleDocuments,
  // Thumbnails
  generateAllThumbnails,
  // Screenshot Tool (ML Pipeline)
  screenshotToolService,
  type LiteLLMSettings,
} from '../services';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register custom protocol scheme BEFORE app is ready (required by Electron)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

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
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      {
        name: 'Video Files',
        extensions: [
          'mp4', 'mov', 'avi', 'mkv', 'mts', 'm2ts', 'mxf', 'tod', 'mod',
          '3gp', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'vob', 'dv', 'r3d', 'braw',
        ],
      },
      {
        name: 'Sidecar Files',
        extensions: ['xml', 'xmp', 'srt', 'vtt', 'edl', 'fcpxml', 'aaf', 'omf', 'mhl', 'md5'],
      },
      {
        name: 'Audio Files',
        extensions: ['wav', 'mp3', 'aac', 'flac', 'm4a', 'aiff', 'ogg', 'wma'],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:selectLutFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select LUT File',
    properties: ['openFile'],
    filters: [
      { name: 'LUT Files', extensions: ['cube', '3dlut'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

// =============================================================================
// IPC HANDLERS - LUT Files
// =============================================================================

// Bundled LUT mapping: suggestedLut string -> actual file path
const BUNDLED_LUTS: Record<string, string> = {
  'Sony S-Log3 to Rec.709': 'Sony_Special_Sauce.cube',
  'Sony S-Log3': 'Sony_Special_Sauce.cube',
  'Sony Secret Sauce': 'Sony_Special_Sauce.cube',
  'Fuji F-Log2 to Rec.709': 'XH2S_FLog2_FGamut_to_WDR_BT.709_33grid.cube',
  'Fuji F-Log2': 'XH2S_FLog2_FGamut_to_WDR_BT.709_33grid.cube',
};

function getLutsDir(): string {
  // Development: resources/luts relative to project root
  const devPath = path.join(__dirname, '../../../resources/luts');
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  // Production: resources/luts in app resources
  const prodPath = path.join(process.resourcesPath || '', 'luts');
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }
  return devPath;
}

ipcMain.handle('luts:getAvailable', async () => {
  const lutsDir = getLutsDir();
  if (!fs.existsSync(lutsDir)) {
    return [];
  }
  const files = fs.readdirSync(lutsDir).filter(f => f.endsWith('.cube') || f.endsWith('.3dlut'));
  return files.map(f => ({
    name: f.replace(/\.(cube|3dlut)$/, '').replace(/_/g, ' '),
    path: path.join(lutsDir, f),
  }));
});

ipcMain.handle('luts:resolveSuggested', async (_, suggestedLut: string) => {
  if (!suggestedLut) return null;
  const lutFile = BUNDLED_LUTS[suggestedLut];
  if (!lutFile) return null;
  const lutPath = path.join(getLutsDir(), lutFile);
  return fs.existsSync(lutPath) ? lutPath : null;
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

// Workflow methods
ipcMain.handle('couples:updateStatus', async (_, id: number, status: string) => {
  return couplesRepository.updateStatus(id, status as any);
});

ipcMain.handle('couples:findByStatus', async (_, status: string) => {
  return couplesRepository.findByStatus(status as any);
});

ipcMain.handle('couples:getForMonth', async (_, year: number, month: number) => {
  return couplesRepository.getForMonth(year, month);
});

ipcMain.handle('couples:getDashboardStats', async () => {
  return couplesRepository.getDashboardStats();
});

ipcMain.handle('couples:getWhatsNextData', async () => {
  return couplesRepository.getWhatsNextData();
});

ipcMain.handle('couples:getMonthlyStats', async (_, year: number, month: number) => {
  return couplesRepository.getMonthlyStats(year, month);
});

ipcMain.handle('couples:getYearlyStats', async (_, year: number) => {
  return couplesRepository.getYearlyStats(year);
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
// IPC HANDLERS - Lenses
// =============================================================================

ipcMain.handle('lenses:findAll', async () => {
  return lensesRepository.findAll();
});

ipcMain.handle('lenses:findById', async (_, id: number) => {
  return lensesRepository.findById(id);
});

ipcMain.handle('lenses:findByMake', async (_, make: string) => {
  return lensesRepository.findByMake(make);
});

ipcMain.handle('lenses:findByMount', async (_, mount: string) => {
  return lensesRepository.findByMount(mount);
});

ipcMain.handle('lenses:search', async (_, query: string) => {
  return lensesRepository.search(query);
});

ipcMain.handle('lenses:getUniqueMakes', async () => {
  return lensesRepository.getUniqueMakes();
});

ipcMain.handle('lenses:getUniqueMounts', async () => {
  return lensesRepository.getUniqueMounts();
});

ipcMain.handle('lenses:create', async (_, input: unknown) => {
  // Simple validation - LensInput is straightforward
  const validated = input as { name: string; make?: string; model?: string; focal_length?: string; aperture?: string; mount?: string; notes?: string };
  if (!validated.name) {
    throw new Error('Lens name is required');
  }
  return lensesRepository.create(validated);
});

ipcMain.handle('lenses:update', async (_, id: number, input: unknown) => {
  return lensesRepository.update(id, input as any);
});

ipcMain.handle('lenses:delete', async (_, id: number) => {
  return lensesRepository.delete(id);
});

ipcMain.handle('lenses:getLensUsageStats', async () => {
  return lensesRepository.getLensUsageStats();
});

// =============================================================================
// IPC HANDLERS - Equipment
// =============================================================================

ipcMain.handle('equipment:findAll', async () => {
  return equipmentRepository.findAll();
});

ipcMain.handle('equipment:findAllIncludingInactive', async () => {
  return equipmentRepository.findAllIncludingInactive();
});

ipcMain.handle('equipment:findById', async (_, id: number) => {
  return equipmentRepository.findById(id);
});

ipcMain.handle('equipment:findByType', async (_, type: string) => {
  return equipmentRepository.findByType(type as any);
});

ipcMain.handle('equipment:findByMedium', async (_, medium: string) => {
  return equipmentRepository.findByMedium(medium as any);
});

ipcMain.handle('equipment:findByStatus', async (_, status: string) => {
  return equipmentRepository.findByStatus(status as any);
});

ipcMain.handle('equipment:findAvailable', async () => {
  return equipmentRepository.findAvailable();
});

ipcMain.handle('equipment:findLoanerEligible', async () => {
  return equipmentRepository.findLoanerEligible();
});

ipcMain.handle('equipment:findAvailableForLoan', async () => {
  return equipmentRepository.findAvailableForLoan();
});

ipcMain.handle('equipment:search', async (_, query: string) => {
  return equipmentRepository.search(query);
});

ipcMain.handle('equipment:create', async (_, input: unknown) => {
  return equipmentRepository.create(input as any);
});

ipcMain.handle('equipment:update', async (_, id: number, input: unknown) => {
  return equipmentRepository.update(id, input as any);
});

ipcMain.handle('equipment:updateStatus', async (_, id: number, status: string) => {
  return equipmentRepository.updateStatus(id, status as any);
});

ipcMain.handle('equipment:delete', async (_, id: number) => {
  return equipmentRepository.delete(id);
});

ipcMain.handle('equipment:getCountsByType', async () => {
  return equipmentRepository.getCountsByType();
});

ipcMain.handle('equipment:getCountsByStatus', async () => {
  return equipmentRepository.getCountsByStatus();
});

// =============================================================================
// IPC HANDLERS - Film Stock
// =============================================================================

ipcMain.handle('filmStock:findAll', async () => {
  return filmStockRepository.findAll();
});

ipcMain.handle('filmStock:findById', async (_, id: number) => {
  return filmStockRepository.findById(id);
});

ipcMain.handle('filmStock:findByType', async (_, type: string) => {
  return filmStockRepository.findByType(type as any);
});

ipcMain.handle('filmStock:findByFormat', async (_, format: string) => {
  return filmStockRepository.findByFormat(format as any);
});

ipcMain.handle('filmStock:findInStock', async () => {
  return filmStockRepository.findInStock();
});

ipcMain.handle('filmStock:findLowStock', async (_, threshold?: number) => {
  return filmStockRepository.findLowStock(threshold);
});

ipcMain.handle('filmStock:findOutOfStock', async () => {
  return filmStockRepository.findOutOfStock();
});

ipcMain.handle('filmStock:create', async (_, input: unknown) => {
  return filmStockRepository.create(input as any);
});

ipcMain.handle('filmStock:update', async (_, id: number, input: unknown) => {
  return filmStockRepository.update(id, input as any);
});

ipcMain.handle('filmStock:adjustQuantity', async (_, id: number, adjustment: number) => {
  return filmStockRepository.adjustQuantity(id, adjustment);
});

ipcMain.handle('filmStock:delete', async (_, id: number) => {
  return filmStockRepository.delete(id);
});

ipcMain.handle('filmStock:getTotalInventoryValue', async () => {
  return filmStockRepository.getTotalInventoryValue();
});

ipcMain.handle('filmStock:getInventoryByFormat', async () => {
  return filmStockRepository.getInventoryByFormat();
});

// =============================================================================
// IPC HANDLERS - Processing Labs
// =============================================================================

ipcMain.handle('processingLabs:findAll', async () => {
  return processingLabsRepository.findAll();
});

ipcMain.handle('processingLabs:findById', async (_, id: number) => {
  return processingLabsRepository.findById(id);
});

ipcMain.handle('processingLabs:findByMinRating', async (_, minRating: number) => {
  return processingLabsRepository.findByMinRating(minRating);
});

ipcMain.handle('processingLabs:findByService', async (_, service: string) => {
  return processingLabsRepository.findByService(service);
});

ipcMain.handle('processingLabs:search', async (_, query: string) => {
  return processingLabsRepository.search(query);
});

ipcMain.handle('processingLabs:create', async (_, input: unknown) => {
  return processingLabsRepository.create(input as any);
});

ipcMain.handle('processingLabs:update', async (_, id: number, input: unknown) => {
  return processingLabsRepository.update(id, input as any);
});

ipcMain.handle('processingLabs:delete', async (_, id: number) => {
  return processingLabsRepository.delete(id);
});

ipcMain.handle('processingLabs:getLabUsageStats', async () => {
  return processingLabsRepository.getLabUsageStats();
});

// =============================================================================
// IPC HANDLERS - Camera Loans
// =============================================================================

ipcMain.handle('loans:findAll', async () => {
  return cameraLoansRepository.findAll();
});

ipcMain.handle('loans:findAllWithDetails', async () => {
  return cameraLoansRepository.findAllWithDetails();
});

ipcMain.handle('loans:findById', async (_, id: number) => {
  return cameraLoansRepository.findById(id);
});

ipcMain.handle('loans:findByIdWithDetails', async (_, id: number) => {
  return cameraLoansRepository.findByIdWithDetails(id);
});

ipcMain.handle('loans:findByCouple', async (_, coupleId: number) => {
  return cameraLoansRepository.findByCouple(coupleId);
});

ipcMain.handle('loans:findByEquipment', async (_, equipmentId: number) => {
  return cameraLoansRepository.findByEquipment(equipmentId);
});

ipcMain.handle('loans:findByStatus', async (_, status: string) => {
  return cameraLoansRepository.findByStatus(status as any);
});

ipcMain.handle('loans:findActive', async () => {
  return cameraLoansRepository.findActive();
});

ipcMain.handle('loans:findNeedingAttention', async () => {
  return cameraLoansRepository.findNeedingAttention();
});

ipcMain.handle('loans:findOverdue', async () => {
  return cameraLoansRepository.findOverdue();
});

ipcMain.handle('loans:checkAvailability', async (_, equipmentId: number, startDate: string, endDate: string, excludeLoanId?: number) => {
  return cameraLoansRepository.checkAvailability(equipmentId, startDate, endDate, excludeLoanId);
});

ipcMain.handle('loans:create', async (_, input: unknown) => {
  return cameraLoansRepository.create(input as any);
});

ipcMain.handle('loans:update', async (_, id: number, input: unknown) => {
  return cameraLoansRepository.update(id, input as any);
});

ipcMain.handle('loans:transitionStatus', async (_, id: number, newStatus: string, additionalData?: unknown) => {
  return cameraLoansRepository.transitionStatus(id, newStatus as any, additionalData as any);
});

ipcMain.handle('loans:delete', async (_, id: number) => {
  return cameraLoansRepository.delete(id);
});

ipcMain.handle('loans:getCountsByStatus', async () => {
  return cameraLoansRepository.getCountsByStatus();
});

ipcMain.handle('loans:getCountsByEventType', async () => {
  return cameraLoansRepository.getCountsByEventType();
});

// =============================================================================
// IPC HANDLERS - Film Usage
// =============================================================================

ipcMain.handle('filmUsage:findAll', async () => {
  return filmUsageRepository.findAll();
});

ipcMain.handle('filmUsage:findAllWithDetails', async () => {
  return filmUsageRepository.findAllWithDetails();
});

ipcMain.handle('filmUsage:findById', async (_, id: number) => {
  return filmUsageRepository.findById(id);
});

ipcMain.handle('filmUsage:findByIdWithDetails', async (_, id: number) => {
  return filmUsageRepository.findByIdWithDetails(id);
});

ipcMain.handle('filmUsage:findByCouple', async (_, coupleId: number) => {
  return filmUsageRepository.findByCouple(coupleId);
});

ipcMain.handle('filmUsage:findByLoan', async (_, loanId: number) => {
  return filmUsageRepository.findByLoan(loanId);
});

ipcMain.handle('filmUsage:findByLab', async (_, labId: number) => {
  return filmUsageRepository.findByLab(labId);
});

ipcMain.handle('filmUsage:findPendingAtLab', async () => {
  return filmUsageRepository.findPendingAtLab();
});

ipcMain.handle('filmUsage:findAwaitingPhysicalReturn', async () => {
  return filmUsageRepository.findAwaitingPhysicalReturn();
});

ipcMain.handle('filmUsage:create', async (_, input: unknown) => {
  return filmUsageRepository.create(input as any);
});

ipcMain.handle('filmUsage:update', async (_, id: number, input: unknown) => {
  return filmUsageRepository.update(id, input as any);
});

ipcMain.handle('filmUsage:markSentToLab', async (_, id: number, labId: number, trackingNumber?: string) => {
  return filmUsageRepository.markSentToLab(id, labId, trackingNumber);
});

ipcMain.handle('filmUsage:markScansReceived', async (_, id: number, downloadUrl?: string, resolution?: string, format?: string) => {
  return filmUsageRepository.markScansReceived(id, downloadUrl, resolution, format);
});

ipcMain.handle('filmUsage:markPhysicalReceived', async (_, id: number, trackingNumber?: string) => {
  return filmUsageRepository.markPhysicalReceived(id, trackingNumber);
});

ipcMain.handle('filmUsage:delete', async (_, id: number) => {
  return filmUsageRepository.delete(id);
});

ipcMain.handle('filmUsage:getTotalCartridgesByCouple', async (_, coupleId: number) => {
  return filmUsageRepository.getTotalCartridgesByCouple(coupleId);
});

ipcMain.handle('filmUsage:getTotalCostByCouple', async (_, coupleId: number) => {
  return filmUsageRepository.getTotalCostByCouple(coupleId);
});

ipcMain.handle('filmUsage:getUsageByFilmStock', async () => {
  return filmUsageRepository.getUsageByFilmStock();
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

ipcMain.handle('files:getThumbnail', async (_, fileId: number) => {
  try {
    const file = filesRepository.findById(fileId);
    if (!file || !file.blake3) {
      return null;
    }

    // Get couple info to find thumbnail path
    if (!file.couple_id) {
      return null;
    }

    const couple = couplesRepository.findById(file.couple_id);
    if (!couple || !couple.working_path || !couple.folder_name) {
      return null;
    }

    // Determine couple directory: if working_path already ends with folder_name, don't duplicate
    let coupleDir: string;
    if (couple.working_path.endsWith(couple.folder_name)) {
      coupleDir = couple.working_path;
    } else {
      coupleDir = path.join(couple.working_path, couple.folder_name);
    }

    // Thumbnail path: {coupleDir}/thumbnails/{hash}.jpg
    const thumbnailPath = path.join(coupleDir, 'thumbnails', `${file.blake3}.jpg`);

    // Check if thumbnail exists
    if (!fs.existsSync(thumbnailPath)) {
      return null;
    }

    // Read and return as base64 data URL
    const buffer = fs.readFileSync(thumbnailPath);
    const base64 = buffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    console.error('[files:getThumbnail] Error:', error);
    return null;
  }
});

ipcMain.handle('files:getThumbnailByHash', async (_, hash: string, coupleId: number) => {
  try {
    const couple = couplesRepository.findById(coupleId);
    if (!couple || !couple.working_path || !couple.folder_name) {
      return null;
    }

    // Determine couple directory: if working_path already ends with folder_name, don't duplicate
    let coupleDir: string;
    if (couple.working_path.endsWith(couple.folder_name)) {
      coupleDir = couple.working_path;
    } else {
      coupleDir = path.join(couple.working_path, couple.folder_name);
    }

    // Thumbnail path: {coupleDir}/thumbnails/{hash}.jpg
    const thumbnailPath = path.join(coupleDir, 'thumbnails', `${hash}.jpg`);

    // Check if thumbnail exists
    if (!fs.existsSync(thumbnailPath)) {
      return null;
    }

    // Read and return as base64 data URL
    const buffer = fs.readFileSync(thumbnailPath);
    const base64 = buffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    console.error('[files:getThumbnailByHash] Error:', error);
    return null;
  }
});

ipcMain.handle('files:getProxyByHash', async (_, hash: string, coupleId: number) => {
  try {
    const couple = couplesRepository.findById(coupleId);
    if (!couple || !couple.working_path || !couple.folder_name) {
      return null;
    }

    // Determine couple directory: if working_path already ends with folder_name, don't duplicate
    let coupleDir: string;
    if (couple.working_path.endsWith(couple.folder_name)) {
      coupleDir = couple.working_path;
    } else {
      coupleDir = path.join(couple.working_path, couple.folder_name);
    }

    // Proxy path: {coupleDir}/proxies/{hash}_proxy.mp4
    const proxyPath = path.join(coupleDir, 'proxies', `${hash}_proxy.mp4`);

    // Check if proxy exists
    if (!fs.existsSync(proxyPath)) {
      console.log('[files:getProxyByHash] Proxy not found:', proxyPath);
      return null;
    }

    // Return media:// protocol URL (handled by custom protocol handler)
    return `media://proxy/${coupleId}/${hash}`;
  } catch (error) {
    console.error('[files:getProxyByHash] Error:', error);
    return null;
  }
});

ipcMain.handle('files:regenerateThumbnails', async (_, coupleId: number) => {
  try {
    console.log(`[files:regenerateThumbnails] Starting for couple ${coupleId}`);

    const couple = couplesRepository.findById(coupleId);
    if (!couple || !couple.working_path || !couple.folder_name) {
      return { success: false, error: 'Couple not found or missing working path', regenerated: 0 };
    }

    // Determine couple directory
    let coupleDir: string;
    if (couple.working_path.endsWith(couple.folder_name)) {
      coupleDir = couple.working_path;
    } else {
      coupleDir = path.join(couple.working_path, couple.folder_name);
    }

    // Get all video files for this couple
    const files = filesRepository.findByCouple(coupleId).filter(f => f.file_type === 'video');
    console.log(`[files:regenerateThumbnails] Found ${files.length} video files`);

    // Get all cameras for LUT lookup
    const cameras = camerasRepository.findAll();
    const cameraMap = new Map(cameras.map(c => [c.id, c]));

    let regenerated = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!file.managed_path) {
        console.log(`[files:regenerateThumbnails] Skipping ${file.original_filename} - no managed path`);
        continue;
      }

      // Get camera LUT if available
      const camera = file.camera_id ? cameraMap.get(file.camera_id) : null;
      const lutPath = camera?.lut_path || undefined;

      if (lutPath) {
        console.log(`[files:regenerateThumbnails] Using LUT from ${camera?.name}: ${lutPath}`);
      }

      try {
        const result = await generateAllThumbnails(
          file.managed_path,
          coupleDir,
          file.blake3,
          { lutPath }
        );

        if (result.thumbnail.success && result.thumbnail.thumbnailPath) {
          filesRepository.updateThumbnailPath(file.id, result.thumbnail.thumbnailPath);
          regenerated++;
          console.log(`[files:regenerateThumbnails] Regenerated thumbnail for ${file.original_filename}`);
        } else if (result.thumbnail.error) {
          errors.push(`${file.original_filename}: ${result.thumbnail.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${file.original_filename}: ${msg}`);
      }
    }

    console.log(`[files:regenerateThumbnails] Done: ${regenerated} regenerated, ${errors.length} errors`);
    return {
      success: true,
      regenerated,
      total: files.length,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('[files:regenerateThumbnails] Error:', error);
    return { success: false, error: String(error), regenerated: 0 };
  }
});

// =============================================================================
// IPC HANDLERS - Screenshots
// =============================================================================

import { screenshotsRepository } from '../repositories/screenshots-repository';
import type { ScreenshotFilters } from '../repositories/screenshots-repository';

ipcMain.handle('screenshots:findByFile', async (_, fileId: number) => {
  return screenshotsRepository.findByFile(fileId);
});

ipcMain.handle('screenshots:findByCouple', async (_, coupleId: number) => {
  return screenshotsRepository.findByCouple(coupleId);
});

ipcMain.handle('screenshots:findSelected', async (_, coupleId: number) => {
  return screenshotsRepository.findSelected(coupleId);
});

ipcMain.handle('screenshots:findAll', async (_, filters?: ScreenshotFilters) => {
  return screenshotsRepository.findAll(filters);
});

ipcMain.handle('screenshots:getStats', async (_, coupleId: number) => {
  return screenshotsRepository.getStats(coupleId);
});

ipcMain.handle('screenshots:setSelected', async (_, id: number, selected: boolean) => {
  return screenshotsRepository.setSelected(id, selected);
});

ipcMain.handle('screenshots:setRating', async (_, id: number, rating: number) => {
  return screenshotsRepository.setRating(id, rating);
});

ipcMain.handle('screenshots:setAsThumbnail', async (_, fileId: number, screenshotId: number) => {
  return screenshotsRepository.setAsThumbnail(fileId, screenshotId);
});

ipcMain.handle('screenshots:autoSetThumbnail', async (_, fileId: number) => {
  return screenshotsRepository.autoSetThumbnail(fileId);
});

ipcMain.handle('screenshots:delete', async (_, id: number) => {
  return screenshotsRepository.delete(id);
});

ipcMain.handle('screenshots:getImage', async (_, screenshotId: number) => {
  try {
    const screenshot = screenshotsRepository.findById(screenshotId);
    if (!screenshot || !screenshot.preview_path) {
      return null;
    }

    // Check if file exists
    if (!fs.existsSync(screenshot.preview_path)) {
      console.log('[screenshots:getImage] File not found:', screenshot.preview_path);
      return null;
    }

    // Read and return as base64 data URL
    const buffer = fs.readFileSync(screenshot.preview_path);
    const base64 = buffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    console.error('[screenshots:getImage] Error:', error);
    return null;
  }
});

ipcMain.handle('screenshots:export', async (_, screenshotId: number, presetId: number, outputPath: string) => {
  try {
    const screenshot = screenshotsRepository.findById(screenshotId);
    if (!screenshot) {
      return { success: false, error: 'Screenshot not found' };
    }

    // Use raw_path for export if available, otherwise preview_path
    const sourcePath = screenshot.raw_path || screenshot.preview_path;
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: 'Source image not found' };
    }

    // Get export preset from database
    const db = require('./database').getDatabase();
    const preset = db.prepare('SELECT * FROM export_presets WHERE id = ?').get(presetId);
    if (!preset) {
      return { success: false, error: 'Export preset not found' };
    }

    // Get crop coordinates if preset needs cropping
    const crops = screenshot.crops_json ? JSON.parse(screenshot.crops_json) : {};
    const aspectKey = preset.aspect_ratio.replace(':', ':'); // e.g., '9:16', '1:1', '16:9'
    const crop = crops[aspectKey];

    // Build ffmpeg command for export
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    let filterChain = '';

    // Apply crop if needed and preset isn't original
    if (crop && preset.aspect_ratio !== 'original') {
      filterChain = `crop=${crop.width}:${crop.height}:${crop.x1}:${crop.y1}`;
    }

    // Apply scale if max dimensions specified
    if (preset.max_width || preset.max_height) {
      const scaleFilter = preset.max_width && preset.max_height
        ? `scale='min(${preset.max_width},iw)':'min(${preset.max_height},ih)':force_original_aspect_ratio=decrease`
        : preset.max_width
          ? `scale='min(${preset.max_width},iw)':-1`
          : `scale=-1:'min(${preset.max_height},ih)'`;

      filterChain = filterChain ? `${filterChain},${scaleFilter}` : scaleFilter;
    }

    // Build ffmpeg command
    const quality = preset.quality || 90;
    let cmd = `ffmpeg -y -i "${sourcePath}"`;
    if (filterChain) {
      cmd += ` -vf "${filterChain}"`;
    }
    cmd += ` -q:v ${Math.floor((100 - quality) / 5 + 1)} "${outputPath}"`;

    await execAsync(cmd);

    return {
      success: true,
      outputPath,
      width: crop?.width || preset.max_width,
      height: crop?.height || preset.max_height,
    };
  } catch (error) {
    console.error('[screenshots:export] Error:', error);
    return { success: false, error: String(error) };
  }
});

// =============================================================================
// IPC HANDLERS - Jobs
// =============================================================================

ipcMain.handle('jobs:getStats', async () => {
  return jobsRepository.getStats();
});

ipcMain.handle('jobs:findPending', async (_, limit?: number) => {
  return jobsRepository.findPending(limit);
});

ipcMain.handle('jobs:findByFile', async (_, fileId: number) => {
  return jobsRepository.findByFile(fileId);
});

ipcMain.handle('jobs:findDead', async () => {
  return jobsRepository.findDead();
});

ipcMain.handle('jobs:retry', async (_, id: number) => {
  return jobsRepository.retry(id);
});

ipcMain.handle('jobs:cancel', async (_, id: number) => {
  return jobsRepository.cancel(id);
});

ipcMain.handle('jobs:queueScreenshots', async (_, fileId: number) => {
  const file = filesRepository.findById(fileId);
  if (!file) {
    return { success: false, error: 'File not found' };
  }

  const { JobWorker } = await import('../services/job-worker');
  const job = JobWorker.createJob(
    'screenshot_extract',
    { file_path: file.managed_path || file.original_path },
    { file_id: file.id, couple_id: file.couple_id }
  );

  return { success: true, jobId: job.id };
});

// =============================================================================
// IPC HANDLERS - Export Presets
// =============================================================================

ipcMain.handle('exportPresets:findAll', async () => {
  const db = require('./database').getDatabase();
  return db.prepare('SELECT * FROM export_presets ORDER BY id').all();
});

ipcMain.handle('exportPresets:findById', async (_, id: number) => {
  const db = require('./database').getDatabase();
  return db.prepare('SELECT * FROM export_presets WHERE id = ?').get(id);
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

ipcMain.handle('import:files', async (_, filePaths: string[], options?: { coupleId?: number; copyToManaged?: boolean; managedStoragePath?: string; footageTypeOverride?: 'wedding' | 'date_night' | 'rehearsal' | 'other' }) => {
  try {
    // Expand directories to individual files (recursive)
    const allFiles: string[] = [];

    for (const inputPath of filePaths) {
      const stat = await fs.promises.stat(inputPath);
      if (stat.isDirectory()) {
        // Recursively scan directory for supported files
        const { files } = await importController.scanDirectory(inputPath);
        allFiles.push(...files);
      } else {
        allFiles.push(inputPath);
      }
    }

    if (allFiles.length === 0) {
      return {
        total: 0,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        errors: 0,
        files: [],
      };
    }

    const result = await importController.importFiles(allFiles, {
      coupleId: options?.coupleId,
      copyToManaged: options?.copyToManaged,
      managedStoragePath: options?.managedStoragePath,
      footageTypeOverride: options?.footageTypeOverride,
      window: mainWindow ?? undefined,
    });
    return result;
  } catch (error) {
    console.error('[import:files] Error:', error);
    throw error;
  }
});

ipcMain.handle('import:directory', async (_, dirPath: string, options?: { coupleId?: number; copyToManaged?: boolean; managedStoragePath?: string }) => {
  try {
    const result = await importController.importDirectory(dirPath, {
      coupleId: options?.coupleId,
      copyToManaged: options?.copyToManaged,
      managedStoragePath: options?.managedStoragePath,
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
// IPC HANDLERS - Documents
// =============================================================================

ipcMain.handle('documents:sync', async (_, coupleId: number) => {
  try {
    const result = await syncCoupleDocuments(coupleId);
    return result;
  } catch (error) {
    console.error('[documents:sync] Error:', error);
    return {
      success: false,
      documentsPath: null,
      filesWritten: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
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
    return await litellmService.getEnhancedStatus();
  } catch (error) {
    console.error('[ai:getStatus] Error:', error);
    return {
      installed: false,
      running: false,
      managedByApp: false,
      port: 4000,
      configuredModels: [],
      lastError: String(error),
      ollamaAvailable: false,
      configuredProviders: [],
    };
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

// =============================================================================
// IPC HANDLERS - Camera Signatures Database
// =============================================================================

ipcMain.handle('signatures:search', async (_, query: string, limit?: number) => {
  try {
    return searchSignatures(query, limit);
  } catch (error) {
    console.error('[signatures:search] Error:', error);
    return [];
  }
});

ipcMain.handle('signatures:getStats', async () => {
  try {
    return getSignatureDatabaseStats();
  } catch (error) {
    console.error('[signatures:getStats] Error:', error);
    return { version: '0.0.0', camera_count: 0, manufacturers: 0, categories: {}, mediums: {} };
  }
});

ipcMain.handle('signatures:match', async (_, filePath: string, exifMake?: string, exifModel?: string) => {
  try {
    return matchSignature(filePath, exifMake, exifModel);
  } catch (error) {
    console.error('[signatures:match] Error:', error);
    return null;
  }
});

ipcMain.handle('signatures:load', async () => {
  try {
    const db = loadSignatureDatabase();
    return { version: db.version, camera_count: db.camera_count, generated_at: db.generated_at };
  } catch (error) {
    console.error('[signatures:load] Error:', error);
    return null;
  }
});

// =============================================================================
// IPC HANDLERS - Camera Training
// =============================================================================

ipcMain.handle('cameraTrainer:startSession', async () => {
  try {
    return startTrainingSession();
  } catch (error) {
    console.error('[cameraTrainer:startSession] Error:', error);
    throw error;
  }
});

ipcMain.handle('cameraTrainer:getSession', async () => {
  return getTrainingSession();
});

ipcMain.handle('cameraTrainer:cancelSession', async () => {
  cancelTrainingSession();
  return true;
});

ipcMain.handle('cameraTrainer:addFiles', async (_, paths: string[]) => {
  try {
    return await addTrainingFiles(paths);
  } catch (error) {
    console.error('[cameraTrainer:addFiles] Error:', error);
    throw error;
  }
});

ipcMain.handle('cameraTrainer:removeFile', async (_, filePath: string) => {
  try {
    removeTrainingFile(filePath);
    return getTrainingSession();
  } catch (error) {
    console.error('[cameraTrainer:removeFile] Error:', error);
    throw error;
  }
});

ipcMain.handle('cameraTrainer:analyze', async () => {
  try {
    return await analyzeTrainingFiles();
  } catch (error) {
    console.error('[cameraTrainer:analyze] Error:', error);
    throw error;
  }
});

ipcMain.handle('cameraTrainer:exportSignature', async (_, signature: unknown) => {
  try {
    const json = exportSignatureJson(signature as any);

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Export Camera Signature',
      defaultPath: 'camera-signature.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    fs.writeFileSync(result.filePath, json);
    return result.filePath;
  } catch (error) {
    console.error('[cameraTrainer:exportSignature] Error:', error);
    throw error;
  }
});

ipcMain.handle('cameraTrainer:selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'mts', 'm2ts', 'mxf', 'mpg', 'mpeg', 'r3d', 'braw'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('cameraTrainer:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// =============================================================================
// USB DEVICE & CAMERA REGISTRATION HANDLERS
// =============================================================================

ipcMain.handle('usb:getDevices', async () => {
  try {
    return await getConnectedUSBDevices();
  } catch (error) {
    console.error('[USB] Failed to get devices:', error);
    return [];
  }
});

ipcMain.handle('usb:getCameras', async () => {
  try {
    return await getConnectedCameras();
  } catch (error) {
    console.error('[USB] Failed to get cameras:', error);
    return [];
  }
});

ipcMain.handle('usb:getJVCDevices', async () => {
  try {
    return await getConnectedJVCDevices();
  } catch (error) {
    console.error('[USB] Failed to get JVC devices:', error);
    return [];
  }
});

ipcMain.handle('usb:syncCameras', async () => {
  try {
    return await syncConnectedCameras();
  } catch (error) {
    console.error('[USB] Failed to sync cameras:', error);
    return { connected: [], unregistered: [] };
  }
});

ipcMain.handle('cameraRegistry:getAll', async () => {
  try {
    return getRegisteredCameras();
  } catch (error) {
    console.error('[CameraRegistry] Failed to get cameras:', error);
    return [];
  }
});

ipcMain.handle('cameraRegistry:register', async (_, input: {
  name: string;
  make: string;
  model: string;
  volumeUUID?: string | null;
  usbSerial?: string | null;
  vendorId?: number | null;
  productId?: number | null;
  physicalSerial?: string | null;
  notes?: string | null;
}) => {
  try {
    return registerCamera(
      input.name,
      input.make,
      input.model,
      input.volumeUUID,
      input.usbSerial,
      input.vendorId,
      input.productId,
      input.physicalSerial,
      input.notes
    );
  } catch (error) {
    console.error('[CameraRegistry] Failed to register camera:', error);
    throw error;
  }
});

ipcMain.handle('cameraRegistry:registerConnected', async (_, input: {
  volumeUUID: string;
  cameraName: string;
  physicalSerial?: string;
  notes?: string;
}) => {
  try {
    return await registerConnectedDevice(
      input.volumeUUID,
      input.cameraName,
      input.physicalSerial,
      input.notes
    );
  } catch (error) {
    console.error('[CameraRegistry] Failed to register connected device:', error);
    throw error;
  }
});

ipcMain.handle('cameraRegistry:update', async (_, input: {
  cameraId: string;
  updates: { name?: string; notes?: string; physicalSerial?: string; volumeUUID?: string };
}) => {
  try {
    return updateCamera(input.cameraId, input.updates);
  } catch (error) {
    console.error('[CameraRegistry] Failed to update camera:', error);
    throw error;
  }
});

ipcMain.handle('cameraRegistry:delete', async (_, cameraId: string) => {
  try {
    return deleteRegisteredCamera(cameraId);
  } catch (error) {
    console.error('[CameraRegistry] Failed to delete camera:', error);
    throw error;
  }
});

ipcMain.handle('cameraRegistry:findBySerial', async (_, serial: string) => {
  try {
    return findCameraByUSBSerial(serial);
  } catch (error) {
    console.error('[CameraRegistry] Failed to find camera:', error);
    return null;
  }
});

ipcMain.handle('cameraRegistry:findByVolumeUUID', async (_, volumeUUID: string) => {
  try {
    return findCameraByVolumeUUID(volumeUUID);
  } catch (error) {
    console.error('[CameraRegistry] Failed to find camera by volume UUID:', error);
    return null;
  }
});

ipcMain.handle('cameraRegistry:findForMountPoint', async (_, mountPoint: string) => {
  try {
    return await findCameraForMountPoint(mountPoint);
  } catch (error) {
    console.error('[CameraRegistry] Failed to find camera for mount point:', error);
    return null;
  }
});

// =============================================================================
// IPC HANDLERS - Screenshot Tool (ML Pipeline)
// =============================================================================

ipcMain.handle('screenshotTool:start', async () => {
  try {
    await screenshotToolService.start();
    return { success: true };
  } catch (error) {
    console.error('[ScreenshotTool] Failed to start:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:stop', async () => {
  try {
    screenshotToolService.stop();
    return { success: true };
  } catch (error) {
    console.error('[ScreenshotTool] Failed to stop:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:health', async () => {
  try {
    const health = await screenshotToolService.healthCheck();
    return { healthy: !!health, ...health };
  } catch (error) {
    return { healthy: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:progress', async () => {
  try {
    return await screenshotToolService.getProgress();
  } catch (error) {
    return { progress: 0, message: '', complete: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:analyze', async (_, input: {
  videoPath: string;
  outputDir: string;
  options?: {
    sharpness_threshold?: number;
    cluster_eps?: number;
    cluster_min_samples?: number;
    ram_model_path?: string;
    lut_path?: string;
  };
}) => {
  try {
    // Validate paths
    if (!fs.existsSync(input.videoPath)) {
      return { success: false, error: `Video file not found: ${input.videoPath}` };
    }

    // Create output directory if needed
    if (!fs.existsSync(input.outputDir)) {
      fs.mkdirSync(input.outputDir, { recursive: true });
    }

    // Build options with LUT from camera (via database lookup)
    const options = { ...input.options };

    // Get camera's LUT from database (file -> camera -> lut_path)
    if (!options.lut_path) {
      const fileWithCamera = filesRepository.findByPathWithCamera(input.videoPath);

      if (fileWithCamera) {
        if (fileWithCamera.camera_lut_path) {
          options.lut_path = fileWithCamera.camera_lut_path;
          console.log(`[ScreenshotTool] Using LUT from camera "${fileWithCamera.camera_name}": ${fileWithCamera.camera_lut_path}`);
        } else if (fileWithCamera.camera_name) {
          console.log(`[ScreenshotTool] Camera "${fileWithCamera.camera_name}" has no LUT configured`);
        } else {
          console.log(`[ScreenshotTool] File found but no camera assigned: ${fileWithCamera.original_filename}`);
        }
      } else {
        console.log(`[ScreenshotTool] File not found in database: ${path.basename(input.videoPath)}`);
      }
    }

    const result = await screenshotToolService.analyzeVideo(
      input.videoPath,
      input.outputDir,
      options
    );

    // Send progress updates to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screenshotTool:analysisComplete', result);
    }

    return { success: true, result };
  } catch (error) {
    console.error('[ScreenshotTool] Analysis failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:detectScenes', async (_, input: {
  videoPath: string;
  threshold?: number;
}) => {
  try {
    if (!fs.existsSync(input.videoPath)) {
      return { success: false, error: `Video file not found: ${input.videoPath}` };
    }

    const scenes = await screenshotToolService.detectScenes(
      input.videoPath,
      input.threshold || 0.5
    );

    return { success: true, scenes };
  } catch (error) {
    console.error('[ScreenshotTool] Scene detection failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:detectFaces', async (_, input: {
  imagePath: string;
}) => {
  try {
    if (!fs.existsSync(input.imagePath)) {
      return { success: false, error: `Image not found: ${input.imagePath}` };
    }

    const faces = await screenshotToolService.detectFaces(input.imagePath);
    return { success: true, faces };
  } catch (error) {
    console.error('[ScreenshotTool] Face detection failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:tagImage', async (_, input: {
  imagePath: string;
}) => {
  try {
    if (!fs.existsSync(input.imagePath)) {
      return { success: false, error: `Image not found: ${input.imagePath}` };
    }

    const tags = await screenshotToolService.tagImage(input.imagePath);
    return { success: true, tags };
  } catch (error) {
    console.error('[ScreenshotTool] Tagging failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:generateCrops', async (_, input: {
  imagePath: string;
  faces?: unknown[];
}) => {
  try {
    if (!fs.existsSync(input.imagePath)) {
      return { success: false, error: `Image not found: ${input.imagePath}` };
    }

    const crops = await screenshotToolService.generateCrops(
      input.imagePath,
      input.faces as any
    );
    return { success: true, crops };
  } catch (error) {
    console.error('[ScreenshotTool] Crop generation failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:qualityScore', async (_, input: {
  imagePath: string;
}) => {
  try {
    if (!fs.existsSync(input.imagePath)) {
      return { success: false, error: `Image not found: ${input.imagePath}` };
    }

    const result = await screenshotToolService.getQualityScore(input.imagePath);
    return { success: true, ...result };
  } catch (error) {
    console.error('[ScreenshotTool] Quality scoring failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('screenshotTool:clusterFaces', async (_, input: {
  embeddings: number[][];
  eps?: number;
  minSamples?: number;
}) => {
  try {
    if (!input.embeddings || input.embeddings.length === 0) {
      return { success: false, error: 'No embeddings provided' };
    }

    const result = await screenshotToolService.clusterFaces(
      input.embeddings,
      input.eps || 0.5,
      input.minSamples || 2
    );
    return { success: true, ...result };
  } catch (error) {
    console.error('[ScreenshotTool] Clustering failed:', error);
    return { success: false, error: String(error) };
  }
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
    // Register media:// protocol handler for serving local video files
    protocol.handle('media', (request) => {
      // URL format: media://proxy/{coupleId}/{hash}
      // For custom protocols: hostname='proxy', pathname='/{coupleId}/{hash}'
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // Check hostname is 'proxy' and we have exactly 2 path parts (coupleId, hash)
      if (url.hostname === 'proxy' && pathParts.length === 2) {
        const coupleId = parseInt(pathParts[0], 10);
        const hash = pathParts[1];

        const couple = couplesRepository.findById(coupleId);
        if (!couple || !couple.working_path || !couple.folder_name) {
          return new Response('Not found', { status: 404 });
        }

        let coupleDir: string;
        if (couple.working_path.endsWith(couple.folder_name)) {
          coupleDir = couple.working_path;
        } else {
          coupleDir = path.join(couple.working_path, couple.folder_name);
        }

        const proxyPath = path.join(coupleDir, 'proxies', `${hash}_proxy.mp4`);

        if (!fs.existsSync(proxyPath)) {
          console.log('[media://] Proxy not found:', proxyPath);
          return new Response('Not found', { status: 404 });
        }

        // Return file using net.fetch for proper streaming
        return net.fetch(`file://${proxyPath}`);
      }

      console.log('[media://] Invalid request - hostname:', url.hostname, 'pathParts:', pathParts);
      return new Response('Invalid request', { status: 400 });
    });

    // Initialize database first
    console.log('[Main] Initializing database...');
    initializeDatabase();
    console.log('[Main] Database initialized');

    // Start background job worker
    console.log('[Main] Starting job worker...');
    (async () => {
      try {
        const { getJobWorker } = await import('../services/job-worker');
        const { registerJobHandlers } = await import('../services/job-handlers');
        const worker = getJobWorker();
        registerJobHandlers(worker);
        worker.start();
        console.log('[Main] Job worker started successfully');

        // Emit job progress to renderer
        worker.on('progress', (progress) => {
          console.log('[Main] Job progress:', progress.job_type, progress.progress_percent + '%');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('job:progress', progress);
          }
        });

        worker.on('error', (error) => {
          console.error('[Main] Job worker error:', error);
        });
      } catch (error) {
        console.error('[Main] Failed to start job worker:', error);
      }
    })();

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
  app.on('before-quit', async () => {
    console.log('[Main] Stopping job worker...');
    const { stopJobWorker } = await import('../services/job-worker');
    await stopJobWorker();
    console.log('[Main] Stopping AI services...');
    litellmService.stop();
    console.log('[Main] Stopping Screenshot Tool service...');
    screenshotToolService.stop();
    console.log('[Main] Closing database...');
    closeDatabase();
  });

  // Cleanup orphan LiteLLM process on startup
  litellmService.cleanupOrphan();
}
