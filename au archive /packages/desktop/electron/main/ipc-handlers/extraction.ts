/**
 * Extraction Service IPC Handlers
 *
 * Handles extraction:* channels for Document Intelligence extraction.
 * Provides access to the multi-provider extraction system (spaCy, Ollama, cloud).
 *
 * Channels:
 * - extraction:extract - Extract from text
 * - extraction:extractBatch - Batch extraction
 * - extraction:getProviders - List all providers
 * - extraction:getProviderStatus - Get single provider status
 * - extraction:updateProvider - Update provider config
 * - extraction:testProvider - Test a provider
 * - extraction:healthCheck - System health check
 *
 * @version 1.0
 */

import { ipcMain } from 'electron';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { Kysely } from 'kysely';
import {
  getExtractionService,
  getExtractionQueueService,
  getAutoTaggerService,
  shutdownExtractionService,
  shutdownExtractionQueueService,
  type ExtractionInput,
  type ExtractionOptions,
  type BatchExtractionRequest,
  type ProviderConfig,
} from '../../services/extraction';
import { getPreprocessingService } from '../../services/extraction/preprocessing-service';
import { getConflictDetectionService } from '../../services/extraction/conflict-detection-service';
import { getTimelineMergerService } from '../../services/extraction/timeline-merger-service';
import {
  getPromptsSummary,
  getAllVersions,
  getDefaultVersion,
  setDefaultVersion,
} from '../../services/extraction/agents/versioned-prompts';
import type { Database as DatabaseTypes } from '../database.types';

let dbInstance: SqliteDatabase | null = null;

/**
 * Register all extraction IPC handlers
 */
export function registerExtractionHandlers(
  db: Kysely<DatabaseTypes>,
  sqliteDb: SqliteDatabase
): void {
  dbInstance = sqliteDb;
  const service = getExtractionService(sqliteDb);

  // Initialize service in background
  service.initialize().catch((error) => {
    console.error('[ExtractionHandlers] Failed to initialize:', error);
  });

  // ==========================================================================
  // Extraction
  // ==========================================================================

  /**
   * Extract from text
   *
   * Input: {
   *   text: string,
   *   sourceType: 'web_source' | 'document' | 'note' | 'media_caption',
   *   sourceId: string,
   *   locid?: string,
   *   subid?: string,
   *   extractTypes?: Array<'dates' | 'people' | 'organizations' | 'locations' | 'summary' | 'title'>,
   *   articleDate?: string,
   *   locationName?: string,
   *   options?: ExtractionOptions
   * }
   */
  ipcMain.handle('extraction:extract', async (_, input: ExtractionInput & { options?: ExtractionOptions }) => {
    try {
      const { options, ...extractionInput } = input;
      const result = await service.extract(extractionInput, options);
      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:extract failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Extract from a web source by ID
   */
  ipcMain.handle('extraction:extractFromWebSource', async (_, sourceId: string, options?: ExtractionOptions) => {
    try {
      // Get the web source
      const source = db
        .selectFrom('web_sources')
        .select(['source_id', 'extracted_text', 'locid', 'subid', 'extracted_date', 'title'])
        .where('source_id', '=', sourceId)
        .executeTakeFirst();

      const sourceData = await source;

      if (!sourceData || !sourceData.extracted_text) {
        return {
          success: false,
          error: 'Web source not found or has no text',
        };
      }

      // Get location name for context
      let locationName: string | undefined;
      if (sourceData.locid) {
        const location = await db
          .selectFrom('locs')
          .select(['locnam'])
          .where('locid', '=', sourceData.locid)
          .executeTakeFirst();
        locationName = location?.locnam;
      }

      const result = await service.extract(
        {
          text: sourceData.extracted_text,
          sourceType: 'web_source',
          sourceId: sourceData.source_id,
          locid: sourceData.locid ?? undefined,
          subid: sourceData.subid ?? undefined,
          articleDate: sourceData.extracted_date ?? undefined,
          locationName,
        },
        options
      );

      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:extractFromWebSource failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Batch extraction
   */
  ipcMain.handle('extraction:extractBatch', async (_, request: BatchExtractionRequest) => {
    try {
      const result = await service.extractBatch(request);
      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:extractBatch failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ==========================================================================
  // Provider Management
  // ==========================================================================

  /**
   * Get all provider configurations
   */
  ipcMain.handle('extraction:getProviders', async () => {
    try {
      const configs = service.getAllConfigs();
      return { success: true, providers: configs };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:getProviders failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Get provider statuses (with availability check)
   */
  ipcMain.handle('extraction:getProviderStatuses', async () => {
    try {
      const statuses = await service.getProviderStatuses();
      return { success: true, statuses };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:getProviderStatuses failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Update provider configuration
   */
  ipcMain.handle(
    'extraction:updateProvider',
    async (_, providerId: string, updates: Partial<ProviderConfig>) => {
      try {
        const config = await service.updateProviderConfig(providerId, updates);
        if (!config) {
          return { success: false, error: `Provider ${providerId} not found` };
        }
        return { success: true, config };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:updateProvider failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Add a new provider
   */
  ipcMain.handle('extraction:addProvider', async (_, config: ProviderConfig) => {
    try {
      await service.addProvider(config);
      return { success: true };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:addProvider failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Remove a provider
   */
  ipcMain.handle('extraction:removeProvider', async (_, providerId: string) => {
    try {
      await service.removeProvider(providerId);
      return { success: true };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:removeProvider failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Test a provider with sample text
   */
  ipcMain.handle('extraction:testProvider', async (_, providerId: string, testText?: string) => {
    const defaultText =
      'The Sterling Steel Factory was built in 1923 by John Sterling. ' +
      'It employed 500 workers at its peak before closing in 2008 due to foreign competition.';

    try {
      const result = await service.testProvider(providerId, testText || defaultText);
      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:testProvider failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ==========================================================================
  // Health & Diagnostics
  // ==========================================================================

  /**
   * Health check
   */
  ipcMain.handle('extraction:healthCheck', async () => {
    try {
      const health = await service.healthCheck();
      return { success: true, health };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:healthCheck failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ==========================================================================
  // Ollama-specific
  // ==========================================================================

  /**
   * Test Ollama connection
   */
  ipcMain.handle('extraction:testOllamaConnection', async (_, host?: string, port?: number) => {
    try {
      const { OllamaProvider } = await import('../../services/extraction/providers/ollama-provider');

      const testConfig: ProviderConfig = {
        id: 'test-ollama',
        name: 'Test Ollama',
        type: 'ollama',
        enabled: true,
        priority: 999,
        settings: {
          host: host || 'localhost',
          port: port || 11434,
          model: 'qwen2.5:7b',
          timeout: 10000,
        },
      };

      const provider = new OllamaProvider(testConfig);
      const result = await provider.testConnection();
      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:testOllamaConnection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * List available Ollama models
   */
  ipcMain.handle('extraction:listOllamaModels', async (_, host?: string, port?: number) => {
    try {
      const url = `http://${host || 'localhost'}:${port || 11434}/api/tags`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = (await response.json()) as { models: Array<{ name: string; size: number }> };
      return {
        success: true,
        models: (data.models || []).map((m) => ({
          name: m.name,
          size: m.size,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Pull an Ollama model
   */
  ipcMain.handle(
    'extraction:pullOllamaModel',
    async (_, modelName: string, host?: string, port?: number) => {
      try {
        const { OllamaProvider } = await import('../../services/extraction/providers/ollama-provider');

        const testConfig: ProviderConfig = {
          id: 'pull-ollama',
          name: 'Pull Ollama',
          type: 'ollama',
          enabled: true,
          priority: 999,
          settings: {
            host: host || 'localhost',
            port: port || 11434,
            model: modelName,
          },
        };

        const provider = new OllamaProvider(testConfig);
        const result = await provider.pullModel(modelName);
        return { success: result.success, message: result.message };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ==========================================================================
  // Extraction Queue (OPT-120)
  // ==========================================================================

  const queueService = getExtractionQueueService(sqliteDb);

  /**
   * Start the extraction queue background processor
   */
  ipcMain.handle('extraction:queue:start', async () => {
    try {
      await queueService.start();
      return { success: true };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:queue:start failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Stop the extraction queue background processor
   */
  ipcMain.handle('extraction:queue:stop', async () => {
    try {
      queueService.stop();
      return { success: true };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:queue:stop failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Manually enqueue an extraction job
   */
  ipcMain.handle(
    'extraction:queue:enqueue',
    async (
      _,
      sourceType: 'web_source' | 'document' | 'media',
      sourceId: string,
      locid: string | null,
      tasks?: string[],
      priority?: number
    ) => {
      try {
        const queueId = await queueService.enqueue(
          sourceType,
          sourceId,
          locid,
          tasks,
          priority
        );
        return { success: true, queueId };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:queue:enqueue failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Get queue status
   */
  ipcMain.handle('extraction:queue:status', async () => {
    try {
      const status = queueService.getStatus();
      return { success: true, status };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:queue:status failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Cleanup old completed/failed jobs
   */
  ipcMain.handle('extraction:queue:cleanup', async (_, olderThanDays?: number) => {
    try {
      const count = queueService.cleanup(olderThanDays);
      return { success: true, cleaned: count };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:queue:cleanup failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Start queue processor automatically
  queueService.start().catch((error) => {
    console.error('[ExtractionHandlers] Failed to start queue processor:', error);
  });

  // ==========================================================================
  // Auto-Tagger (OPT-120)
  // ==========================================================================

  const autoTagger = getAutoTaggerService(sqliteDb);

  /**
   * Detect tags from text
   */
  ipcMain.handle(
    'extraction:tagger:detectTags',
    async (_, text: string, buildYear?: number | string | null) => {
      try {
        const result = autoTagger.detectTags(text, buildYear);
        return { success: true, result };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:tagger:detectTags failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Tag a specific location
   */
  ipcMain.handle('extraction:tagger:tagLocation', async (_, locid: string) => {
    try {
      const result = await autoTagger.tagLocation(locid);
      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:tagger:tagLocation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Tag all untagged locations
   */
  ipcMain.handle('extraction:tagger:tagAllUntagged', async () => {
    try {
      const result = await autoTagger.tagAllUntagged();
      return { success: true, result };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:tagger:tagAllUntagged failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ==========================================================================
  // Entity Queries (OPT-120)
  // ==========================================================================

  /**
   * Get entities (people, organizations) for a location
   */
  ipcMain.handle('extraction:entities:getByLocation', async (_, locid: string) => {
    try {
      const entities = sqliteDb.prepare(`
        SELECT
          extraction_id,
          entity_type,
          entity_name,
          entity_role,
          date_range,
          confidence,
          context_sentence,
          status,
          created_at
        FROM entity_extractions
        WHERE locid = ? AND status IN ('approved', 'pending')
        ORDER BY entity_type, entity_name
      `).all(locid);

      return { success: true, entities };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:entities:getByLocation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Update entity status (approve/reject)
   */
  ipcMain.handle(
    'extraction:entities:updateStatus',
    async (_, extractionId: string, status: 'approved' | 'rejected' | 'pending') => {
      try {
        sqliteDb.prepare(`
          UPDATE entity_extractions
          SET status = ?, updated_at = datetime('now')
          WHERE extraction_id = ?
        `).run(status, extractionId);

        return { success: true };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:entities:updateStatus failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ==========================================================================
  // Preprocessing (NEW - Phase 5)
  // ==========================================================================

  const preprocessingService = getPreprocessingService();

  /**
   * Preprocess text using spaCy
   */
  ipcMain.handle(
    'extraction:preprocess',
    async (_, text: string, articleDate?: string, maxSentences?: number) => {
      try {
        const result = await preprocessingService.preprocess(text, articleDate, maxSentences);
        return { success: true, result };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:preprocess failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Check if preprocessing service is available
   */
  ipcMain.handle('extraction:preprocess:isAvailable', async () => {
    try {
      const available = await preprocessingService.isAvailable();
      return { success: true, available };
    } catch (error) {
      return { success: false, available: false };
    }
  });

  /**
   * Get verb categories from spaCy
   */
  ipcMain.handle('extraction:preprocess:verbCategories', async () => {
    try {
      const categories = await preprocessingService.getVerbCategories();
      return { success: true, categories };
    } catch (error) {
      return { success: false, categories: {} };
    }
  });

  // ==========================================================================
  // Profiles (NEW - Phase 6)
  // ==========================================================================

  /**
   * Get people profiles for a location
   */
  ipcMain.handle('extraction:profiles:people:getByLocation', async (_, locid: string) => {
    try {
      const profiles = sqliteDb.prepare(`
        SELECT * FROM people_profiles
        WHERE locid = ?
        ORDER BY confidence DESC, full_name ASC
      `).all(locid);

      // Parse JSON fields
      const parsed = profiles.map((p: Record<string, unknown>) => ({
        ...p,
        key_facts: JSON.parse((p.key_facts as string) || '[]'),
        source_refs: JSON.parse((p.source_refs as string) || '[]'),
        aliases: JSON.parse((p.aliases as string) || '[]'),
        social_links: p.social_links ? JSON.parse(p.social_links as string) : null,
      }));

      return { success: true, profiles: parsed };
    } catch (error) {
      console.error('[ExtractionHandlers] profiles:people:getByLocation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get company profiles for a location
   */
  ipcMain.handle('extraction:profiles:companies:getByLocation', async (_, locid: string) => {
    try {
      const profiles = sqliteDb.prepare(`
        SELECT * FROM company_profiles
        WHERE locid = ?
        ORDER BY confidence DESC, full_name ASC
      `).all(locid);

      // Parse JSON fields
      const parsed = profiles.map((p: Record<string, unknown>) => ({
        ...p,
        key_facts: JSON.parse((p.key_facts as string) || '[]'),
        source_refs: JSON.parse((p.source_refs as string) || '[]'),
        aliases: JSON.parse((p.aliases as string) || '[]'),
      }));

      return { success: true, profiles: parsed };
    } catch (error) {
      console.error('[ExtractionHandlers] profiles:companies:getByLocation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update person profile status
   */
  ipcMain.handle(
    'extraction:profiles:people:updateStatus',
    async (_, profileId: string, status: 'pending' | 'approved' | 'rejected' | 'merged') => {
      try {
        sqliteDb.prepare(`
          UPDATE people_profiles
          SET status = ?, updated_at = datetime('now')
          WHERE profile_id = ?
        `).run(status, profileId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  /**
   * Update company profile status
   */
  ipcMain.handle(
    'extraction:profiles:companies:updateStatus',
    async (_, profileId: string, status: 'pending' | 'approved' | 'rejected' | 'merged') => {
      try {
        sqliteDb.prepare(`
          UPDATE company_profiles
          SET status = ?, updated_at = datetime('now')
          WHERE profile_id = ?
        `).run(status, profileId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  /**
   * Search profiles across all locations
   */
  ipcMain.handle('extraction:profiles:search', async (_, query: string, type?: 'people' | 'companies') => {
    try {
      const searchPattern = `%${query}%`;
      const results: { people: unknown[]; companies: unknown[] } = { people: [], companies: [] };

      if (!type || type === 'people') {
        results.people = sqliteDb.prepare(`
          SELECT p.*, l.locnam
          FROM people_profiles p
          LEFT JOIN locs l ON p.locid = l.locid
          WHERE p.full_name LIKE ? OR p.normalized_name LIKE ?
          ORDER BY p.confidence DESC
          LIMIT 50
        `).all(searchPattern, searchPattern);
      }

      if (!type || type === 'companies') {
        results.companies = sqliteDb.prepare(`
          SELECT c.*, l.locnam
          FROM company_profiles c
          LEFT JOIN locs l ON c.locid = l.locid
          WHERE c.full_name LIKE ? OR c.normalized_name LIKE ?
          ORDER BY c.confidence DESC
          LIMIT 50
        `).all(searchPattern, searchPattern);
      }

      return { success: true, results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ==========================================================================
  // Conflicts (NEW - Phase 7)
  // ==========================================================================

  const conflictService = getConflictDetectionService(sqliteDb);

  /**
   * Get conflicts for a location
   */
  ipcMain.handle(
    'extraction:conflicts:getByLocation',
    async (_, locid: string, includeResolved?: boolean) => {
      try {
        const conflicts = conflictService.getConflictsForLocation(locid, includeResolved);
        return { success: true, conflicts };
      } catch (error) {
        console.error('[ExtractionHandlers] conflicts:getByLocation failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  /**
   * Get conflict summary for a location
   */
  ipcMain.handle('extraction:conflicts:getSummary', async (_, locid: string) => {
    try {
      const summary = conflictService.getConflictSummary(locid);
      return { success: true, summary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Resolve a conflict
   */
  ipcMain.handle(
    'extraction:conflicts:resolve',
    async (
      _,
      conflictId: string,
      resolution: 'claim_a' | 'claim_b' | 'both_valid' | 'neither' | 'merged',
      notes?: string,
      resolvedBy?: string
    ) => {
      try {
        const conflict = conflictService.resolveConflict({
          conflict_id: conflictId,
          resolution,
          resolution_notes: notes,
          resolved_by: resolvedBy,
        });

        if (!conflict) {
          return { success: false, error: 'Conflict not found' };
        }

        return { success: true, conflict };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  /**
   * Detect conflicts for a location
   */
  ipcMain.handle('extraction:conflicts:detect', async (_, locid: string) => {
    try {
      const result = await conflictService.detectTimelineConflicts(locid);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Suggest resolution for a conflict
   */
  ipcMain.handle('extraction:conflicts:suggestResolution', async (_, conflictId: string) => {
    try {
      const conflict = conflictService.getConflictById(conflictId);
      if (!conflict) {
        return { success: false, error: 'Conflict not found' };
      }

      const suggestion = conflictService.suggestResolution(conflict);
      return { success: true, suggestion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get source authority list
   */
  ipcMain.handle('extraction:conflicts:getSourceAuthorities', async () => {
    try {
      const authorities = conflictService.getAllSourceAuthorities();
      return { success: true, authorities };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Set source authority tier
   */
  ipcMain.handle(
    'extraction:conflicts:setSourceAuthority',
    async (_, domain: string, tier: 1 | 2 | 3 | 4, notes?: string) => {
      try {
        const authority = conflictService.setSourceAuthority(domain, tier, notes);
        return { success: true, authority };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ==========================================================================
  // Timeline Merging (NEW - Phase 8)
  // ==========================================================================

  const timelineMerger = getTimelineMergerService(sqliteDb);

  /**
   * Deduplicate timeline events for a location
   */
  ipcMain.handle('extraction:timeline:deduplicate', async (_, locid: string) => {
    try {
      const result = timelineMerger.deduplicateLocation(locid);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get timeline merger config
   */
  ipcMain.handle('extraction:timeline:getMergeConfig', async () => {
    try {
      const config = timelineMerger.getConfig();
      return { success: true, config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update timeline merger config
   */
  ipcMain.handle('extraction:timeline:updateMergeConfig', async (_, config: Record<string, unknown>) => {
    try {
      timelineMerger.updateConfig(config as Parameters<typeof timelineMerger.updateConfig>[0]);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ==========================================================================
  // Extracted Addresses (NEW - LLM Tools Overhaul)
  // ==========================================================================

  /**
   * Get extracted addresses for a location
   */
  ipcMain.handle('extraction:addresses:getByLocation', async (_, locid: string, includeRejected?: boolean) => {
    try {
      let query = `
        SELECT
          ea.*,
          ws.title as source_title,
          ws.url as source_url,
          ws.domain as source_domain
        FROM extracted_addresses ea
        LEFT JOIN web_sources ws ON ea.source_id = ws.source_id
        WHERE ea.locid = ?
      `;

      if (!includeRejected) {
        query += ` AND ea.status != 'rejected'`;
      }

      query += ` ORDER BY ea.confidence DESC, ea.created_at DESC`;

      const addresses = sqliteDb.prepare(query).all(locid);

      // Parse JSON fields if present
      const parsed = addresses.map((a: Record<string, unknown>) => ({
        ...a,
        suggested_corrections: a.suggested_corrections
          ? JSON.parse(a.suggested_corrections as string)
          : null,
      }));

      return { success: true, addresses: parsed };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:addresses:getByLocation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Apply an extracted address to the location
   * Updates the location's address fields and marks the extraction as applied
   */
  ipcMain.handle(
    'extraction:addresses:apply',
    async (_, addressId: string, userId?: string) => {
      try {
        // Get the extracted address
        const address = sqliteDb.prepare(`
          SELECT * FROM extracted_addresses WHERE address_id = ?
        `).get(addressId) as Record<string, unknown> | undefined;

        if (!address) {
          return { success: false, error: 'Address not found' };
        }

        // Update the location with the extracted address fields
        const updateFields: string[] = [];
        const updateValues: (string | null)[] = [];

        if (address.street) {
          updateFields.push('locstr = ?');
          updateValues.push(address.street as string);
        }
        if (address.city) {
          updateFields.push('loccit = ?');
          updateValues.push(address.city as string);
        }
        if (address.county) {
          updateFields.push('loccty = ?');
          updateValues.push(address.county as string);
        }
        if (address.state) {
          updateFields.push('locsta = ?');
          updateValues.push(address.state as string);
        }
        if (address.zipcode) {
          updateFields.push('loczip = ?');
          updateValues.push(address.zipcode as string);
        }

        if (updateFields.length > 0) {
          updateValues.push(address.locid as string);
          sqliteDb.prepare(`
            UPDATE locs SET ${updateFields.join(', ')} WHERE locid = ?
          `).run(...updateValues);
        }

        // Mark the extracted address as applied
        sqliteDb.prepare(`
          UPDATE extracted_addresses
          SET status = 'applied', applied_at = datetime('now'), applied_by = ?
          WHERE address_id = ?
        `).run(userId || null, addressId);

        return { success: true };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:addresses:apply failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Reject an extracted address
   */
  ipcMain.handle('extraction:addresses:reject', async (_, addressId: string, userId?: string) => {
    try {
      sqliteDb.prepare(`
        UPDATE extracted_addresses
        SET status = 'rejected', applied_at = datetime('now'), applied_by = ?
        WHERE address_id = ?
      `).run(userId || null, addressId);

      return { success: true };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:addresses:reject failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Approve an extracted address (mark as verified but don't apply)
   */
  ipcMain.handle('extraction:addresses:approve', async (_, addressId: string, userId?: string) => {
    try {
      sqliteDb.prepare(`
        UPDATE extracted_addresses
        SET status = 'approved', applied_by = ?
        WHERE address_id = ?
      `).run(userId || null, addressId);

      return { success: true };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:addresses:approve failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Get count of pending addresses for a location
   */
  ipcMain.handle('extraction:addresses:count', async (_, locid: string) => {
    try {
      const result = sqliteDb.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied
        FROM extracted_addresses
        WHERE locid = ?
      `).get(locid) as Record<string, number>;

      return { success: true, counts: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Save extracted addresses from LLM extraction
   */
  ipcMain.handle(
    'extraction:addresses:save',
    async (
      _,
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
    ) => {
      try {
        const insertStmt = sqliteDb.prepare(`
          INSERT OR REPLACE INTO extracted_addresses (
            address_id, locid, source_id, source_type,
            street, city, county, state, zipcode,
            full_address, confidence, context_sentence, verb_context,
            status, matches_location, suggested_corrections, created_at
          ) VALUES (?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))
        `);

        let savedCount = 0;
        for (const addr of addresses) {
          const addressId = `addr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Find corrections for this address
          const relevantCorrections = corrections?.filter((c) =>
            addr.fullAddress.toLowerCase().includes(c.suggestedValue.toLowerCase())
          );

          insertStmt.run(
            addressId,
            locid,
            sourceId,
            addr.street || null,
            addr.city || null,
            addr.county || null,
            addr.state || null,
            addr.zipcode || null,
            addr.fullAddress,
            addr.confidence,
            addr.contextSentence || null,
            addr.verbContext || null,
            addr.isLocationAddress ? 1 : 0,
            relevantCorrections?.length ? JSON.stringify(relevantCorrections) : null
          );
          savedCount++;
        }

        return { success: true, savedCount };
      } catch (error) {
        console.error('[ExtractionHandlers] extraction:addresses:save failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ==========================================================================
  // Versioned Prompts (NEW - Phase 4)
  // ==========================================================================

  /**
   * Get all prompt versions summary
   */
  ipcMain.handle('extraction:prompts:getSummary', async () => {
    try {
      const summary = getPromptsSummary();
      return { success: true, summary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get versions for a prompt type
   */
  ipcMain.handle('extraction:prompts:getVersions', async (_, type: string) => {
    try {
      const versions = getAllVersions(type as Parameters<typeof getAllVersions>[0]);
      const defaultVersion = getDefaultVersion(type as Parameters<typeof getDefaultVersion>[0]);
      return { success: true, versions, defaultVersion };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Set default prompt version
   */
  ipcMain.handle('extraction:prompts:setDefault', async (_, type: string, version: string) => {
    try {
      const success = setDefaultVersion(
        type as Parameters<typeof setDefaultVersion>[0],
        version
      );
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ==========================================================================
  // Research Counts (LLM Tools Overhaul - conditional visibility)
  // ==========================================================================

  /**
   * Get all research section counts for a location in one efficient call
   * Used for conditional visibility of Research accordions
   */
  ipcMain.handle('extraction:research:getCounts', async (_, locid: string) => {
    try {
      // Timeline events count
      const timelineResult = sqliteDb.prepare(`
        SELECT COUNT(*) as total
        FROM location_timeline
        WHERE locid = ?
      `).get(locid) as { total: number } | undefined;

      // People profiles count (try profiles first, fall back to entities)
      let peopleCount = 0;
      try {
        const profilesResult = sqliteDb.prepare(`
          SELECT COUNT(*) as count FROM people_profiles WHERE locid = ?
        `).get(locid) as { count: number } | undefined;
        peopleCount = profilesResult?.count || 0;
      } catch {
        // Fallback to entity_extractions
        const entitiesResult = sqliteDb.prepare(`
          SELECT COUNT(*) as count FROM entity_extractions
          WHERE locid = ? AND entity_type = 'person'
        `).get(locid) as { count: number } | undefined;
        peopleCount = entitiesResult?.count || 0;
      }

      // Companies count
      let companiesCount = 0;
      try {
        const profilesResult = sqliteDb.prepare(`
          SELECT COUNT(*) as count FROM company_profiles WHERE locid = ?
        `).get(locid) as { count: number } | undefined;
        companiesCount = profilesResult?.count || 0;
      } catch {
        // Fallback to entity_extractions
        const entitiesResult = sqliteDb.prepare(`
          SELECT COUNT(*) as count FROM entity_extractions
          WHERE locid = ? AND entity_type = 'organization'
        `).get(locid) as { count: number } | undefined;
        companiesCount = entitiesResult?.count || 0;
      }

      // Addresses count
      let addressesCount = 0;
      try {
        const addressesResult = sqliteDb.prepare(`
          SELECT COUNT(*) as count FROM extracted_addresses WHERE locid = ?
        `).get(locid) as { count: number } | undefined;
        addressesCount = addressesResult?.count || 0;
      } catch {
        // Table might not exist yet
        addressesCount = 0;
      }

      return {
        success: true,
        counts: {
          timeline: timelineResult?.total || 0,
          people: peopleCount,
          companies: companiesCount,
          addresses: addressesCount,
          total: (timelineResult?.total || 0) + peopleCount + companiesCount + addressesCount
        }
      };
    } catch (error) {
      console.error('[ExtractionHandlers] extraction:research:getCounts failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        counts: { timeline: 0, people: 0, companies: 0, addresses: 0, total: 0 }
      };
    }
  });
}

/**
 * Shutdown extraction service
 */
export async function shutdownExtractionHandlers(): Promise<void> {
  shutdownExtractionQueueService();
  await shutdownExtractionService();
}
