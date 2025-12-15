/**
 * IPC Handlers - Main Entry Point
 * Registers all IPC handlers by delegating to modular handler files
 *
 * LILBITS Compliance: Each handler module is <300 lines
 *
 * Modules:
 * - locations.ts: location:* handlers
 * - location-authors.ts: location-authors:* handlers (Migration 25 - Phase 3)
 * - stats-settings.ts: stats:* and settings:* handlers
 * - shell-dialog.ts: shell:* and dialog:* handlers
 * - imports.ts: imports:* handlers
 * - media-import.ts: media selection, expansion, import handlers
 * - media-processing.ts: media viewing, thumbnails, cache handlers
 * - notes.ts: notes:* handlers
 * - projects.ts: projects:* handlers
 * - websources.ts: websources:* handlers (OPT-109, replaces bookmarks)
 * - users.ts: users:* handlers
 * - sublocations.ts: sublocation:* handlers
 * - database.ts: database:* handlers
 * - health.ts: health:* handlers
 * - geocode.ts: geocode:* handlers
 * - research-browser.ts: research:* handlers (external browser)
 */

import { getDatabase } from '../database';
import { registerLocationHandlers } from './locations';
import { registerLocationAuthorsHandlers } from './location-authors';
import { registerStatsHandlers, registerSettingsHandlers, registerLibpostalHandlers } from './stats-settings';
import { registerShellHandlers, registerDialogHandlers } from './shell-dialog';
import { registerImportsHandlers } from './imports';
import { registerMediaImportHandlers } from './media-import';
import { registerMediaProcessingHandlers } from './media-processing';
import { registerNotesHandlers } from './notes';
import { registerProjectsHandlers } from './projects';
import { registerUsersHandlers } from './users';
import { registerDatabaseHandlers } from './database';
import { registerHealthHandlers } from './health';
import { registerGeocodeHandlers } from './geocode';
import { registerSubLocationHandlers } from './sublocations';
import { registerResearchBrowserHandlers } from './research-browser';
import { registerRefMapsHandlers } from './ref-maps';
import { registerImportIntelligenceHandlers } from './import-intelligence';
import { registerStorageHandlers } from './storage';
import { registerBagItHandlers } from './bagit';
import { registerImportV2Handlers, initializeJobWorker, shutdownJobWorker } from './import-v2';
import { registerMonitoringHandlers, setMainWindow as setMonitoringMainWindow } from './monitoring';
import { registerWebSourcesHandlers } from './websources';
import { registerTimelineHandlers } from './timeline';
import { registerImageDownloaderHandlers } from './image-downloader';
import { registerDateEngineHandlers } from './date-engine';
import { registerExtractionHandlers, shutdownExtractionHandlers } from './extraction';
import { registerTaggingHandlers } from './tagging';
import { registerOllamaLifecycleHandlers } from './ollama-lifecycle';
import {
  initializeBrowserImageCapture,
  cleanupBrowserImageCapture,
} from '../../services/image-downloader/browser-image-capture';
import { getRawDatabase } from '../database';
import { cleanupOrphanOllama, stopOllama } from '../../services/ollama-lifecycle-service';
import { registerCredentialHandlers } from './credentials';
import { registerLiteLLMHandlers, shutdownLiteLLM, cleanupOrphanLiteLLM } from './litellm';
import { registerCostTrackingHandlers } from './cost-tracking';

export function registerIpcHandlers() {
  const db = getDatabase();

  // Location handlers (returns locationRepo for media handlers)
  const locationRepo = registerLocationHandlers(db);

  // Stats and settings
  registerStatsHandlers(db);
  registerSettingsHandlers(db);

  // Shell and dialog
  registerShellHandlers();
  registerDialogHandlers();

  // Imports (returns importRepo for media handlers)
  const importRepo = registerImportsHandlers(db);

  // Media import handlers (returns services for processing handlers)
  const { mediaRepo, exifToolService, ffmpegService } = registerMediaImportHandlers(db, locationRepo, importRepo);

  // Media processing handlers
  registerMediaProcessingHandlers(db, mediaRepo, exifToolService, ffmpegService);

  // Entity handlers
  registerNotesHandlers(db);
  registerProjectsHandlers(db);
  registerUsersHandlers(db);
  registerSubLocationHandlers(db);

  // OPT-109: Web Sources Archiving (replaces simple bookmarks)
  registerWebSourcesHandlers(db);

  // Migration 25 - Phase 3: Location authors (multi-user attribution)
  registerLocationAuthorsHandlers(db);

  // Database operations
  registerDatabaseHandlers();

  // Health monitoring
  registerHealthHandlers();

  // Geocoding
  registerGeocodeHandlers(db);

  // Kanye11: Address parsing with libpostal
  registerLibpostalHandlers();

  // Research browser (external Ungoogled Chromium)
  registerResearchBrowserHandlers();

  // Reference maps (imported KML, GPX, GeoJSON, CSV)
  registerRefMapsHandlers(db);

  // Import intelligence (smart location matching)
  registerImportIntelligenceHandlers(db);

  // Storage monitoring
  registerStorageHandlers();

  // BagIt self-documenting archive (RFC 8493)
  registerBagItHandlers(db);

  // Import System v2.0 (5-step pipeline + background jobs)
  registerImportV2Handlers(db);
  initializeJobWorker(db);

  // Monitoring & Audit System (Migration 51)
  registerMonitoringHandlers(db);

  // Timeline events (Migration 69)
  registerTimelineHandlers(db);

  // Image Downloader (Migration 72 - pHash, URL patterns, staging)
  registerImageDownloaderHandlers(db);

  // Date Engine (Migration 73 - NLP date extraction from web sources)
  registerDateEngineHandlers(db);

  // Document Intelligence Extraction (spaCy + Ollama + Cloud providers)
  const sqliteDb = getRawDatabase();
  registerExtractionHandlers(db, sqliteDb);

  // Migration 76: RAM++ Image Auto-Tagging
  // Per CLAUDE.md Rule 9: Local LLMs for background tasks only
  registerTaggingHandlers(db);

  // OPT-125: Ollama Lifecycle Management (auto-start/stop)
  // Clean up orphan from previous crash, register handlers
  cleanupOrphanOllama();
  registerOllamaLifecycleHandlers();

  // Credential Management (Migration 85)
  // Secure API key storage using Electron safeStorage
  registerCredentialHandlers();

  // LiteLLM Proxy Gateway (Migration 86)
  // Unified AI gateway for cloud providers
  // Clean up orphan from previous crash, register handlers
  cleanupOrphanLiteLLM();
  registerLiteLLMHandlers();

  // Cost Tracking (Migration 88)
  // Track LLM usage costs for cloud providers
  registerCostTrackingHandlers(sqliteDb);

  // Browser Image Capture (network monitoring, context menu)
  initializeBrowserImageCapture({
    filter: {
      minSize: 5000, // Ignore tiny images
    },
  });

  console.log('IPC handlers registered (modular)');
}

// Export job worker shutdown for app cleanup
export { shutdownJobWorker };

// Export browser capture cleanup for app shutdown
export { cleanupBrowserImageCapture };

// Export extraction service shutdown for app cleanup
export { shutdownExtractionHandlers };

// Export monitoring window setter for alert notifications
export { setMonitoringMainWindow };

// Export Ollama lifecycle cleanup for app shutdown
export { stopOllama as stopOllamaLifecycle };

// Export LiteLLM lifecycle cleanup for app shutdown
export { shutdownLiteLLM as stopLiteLLMLifecycle };
