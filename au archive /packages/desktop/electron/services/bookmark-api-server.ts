/**
 * bookmark-api-server.ts
 *
 * HTTP server that receives bookmark data from the browser extension.
 * Runs on localhost:47123 - only accepts local connections for security.
 *
 * Migration Note (OPT-109): Now uses web_sources table instead of bookmarks.
 * HTTP API endpoint names preserved for extension backward compatibility.
 *
 * Endpoints:
 * - GET  /api/status          - Health check
 * - POST /api/bookmark        - Save a web source (with optional subid)
 * - POST /api/location        - Create a new location
 * - GET  /api/locations       - Search locations
 * - GET  /api/search          - Unified search for locations AND sub-locations
 * - GET  /api/recent          - Recent web sources
 * - GET  /api/recent-locations - Recently used locations
 */
import http from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getLogger } from './logger-service';
import {
  notifyWebSourceSaved,
  notifyLocationsUpdated,
} from './websocket-server';
import { detectSourceType } from './source-type-detector';
import { JobQueue, IMPORT_QUEUES } from './job-queue';
import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import type { SQLiteWebSourcesRepository, WebSource } from '../repositories/sqlite-websources-repository';
import type { SQLiteLocationRepository } from '../repositories/sqlite-location-repository';
import type { SQLiteSubLocationRepository } from '../repositories/sqlite-sublocation-repository';

// OPT-115: Extension capture data structure
// OPT-121: Enhanced with session data for authenticated re-fetch
interface ExtensionCapture {
  url?: string;
  title?: string;
  screenshot?: string; // Base64 PNG data URL
  html?: string;
  textContent?: string;
  wordCount?: number;
  domain?: string;
  canonicalUrl?: string;
  language?: string;
  favicon?: string;
  openGraph?: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
    siteName?: string;
  };
  twitterCards?: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
    creator?: string;
  };
  meta?: {
    author?: string;
    description?: string;
    keywords?: string;
    publishDate?: string;
    modifiedDate?: string;
    publisher?: string;
  };
  schemaOrg?: unknown[];
  links?: Array<{ url: string; text: string; rel?: string }>;
  images?: Array<{
    url: string;
    srcset?: string;
    alt?: string;
    width?: number;
    height?: number;
    caption?: string;
    credit?: string;
    attribution?: string;
    isHero?: boolean;
  }>;
  imageCount?: number;
  linkCount?: number;
  capturedAt?: string;
  // OPT-121: Session data for authenticated re-fetch
  // These are captured from the user's active session and stored securely
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    expirationDate?: number;
  }>;
  localStorage?: string; // JSON-stringified localStorage entries
  sessionStorage?: string; // JSON-stringified sessionStorage entries
  // OPT-121: Research Browser state
  userAgent?: string;
  viewport?: { width: number; height: number };
}

const PORT = 47123;
const logger = getLogger();

// Cache for archive base path
let cachedArchiveBasePath: string | null = null;

/**
 * Get archive base path from settings or fallback to userData
 * OPT-121: Now properly reads from database settings
 */
async function getArchiveBasePath(): Promise<string> {
  if (cachedArchiveBasePath) return cachedArchiveBasePath;

  const userData = app.getPath('userData');

  // OPT-121: Try to read archive_folder from database settings
  try {
    const dbPath = path.join(userData, 'au-archive.db');
    if (fs.existsSync(dbPath)) {
      // Use dynamic import for better-sqlite3 since it's a native module
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });
      const result = db.prepare("SELECT value FROM settings WHERE key = 'archive_folder'").get() as { value: string } | undefined;
      if (result?.value) {
        cachedArchiveBasePath = result.value;
        logger.info('BookmarkAPI', `[OPT-121] Using configured archive path: ${cachedArchiveBasePath}`);
      }
      db.close();
    }
  } catch (err) {
    logger.warn('BookmarkAPI', `[OPT-121] Could not read archive_folder from database: ${err}`);
  }

  // Fallback to userData if not set
  if (!cachedArchiveBasePath) {
    cachedArchiveBasePath = path.join(userData, 'archive');
    logger.info('BookmarkAPI', `[OPT-121] Using fallback archive path: ${cachedArchiveBasePath}`);
  }

  // Ensure directory exists
  try {
    await fs.promises.mkdir(cachedArchiveBasePath, { recursive: true });
  } catch {
    // Directory might already exist
  }

  return cachedArchiveBasePath;
}

/**
 * OPT-115: Process extension capture data
 * Saves screenshot and HTML immediately, stores all metadata
 */
async function processExtensionCapture(
  sourceId: string,
  url: string,
  capture: ExtensionCapture
): Promise<void> {
  if (!webSourcesRepository) {
    logger.warn('BookmarkAPI', 'Cannot process capture: repository not initialized');
    return;
  }

  try {
    // Get archive base path for storing files
    const archiveBase = await getArchiveBasePath();
    const websourcesDir = path.join(archiveBase, '_websources', sourceId);

    // Create directory if it doesn't exist
    await fs.promises.mkdir(websourcesDir, { recursive: true });

    let extensionScreenshotPath: string | null = null;
    let extensionHtmlPath: string | null = null;

    // Save screenshot if present
    if (capture.screenshot && capture.screenshot.startsWith('data:image/')) {
      try {
        const screenshotFilename = `${sourceId}_extension_screenshot.png`;
        const screenshotPath = path.join(websourcesDir, screenshotFilename);

        // Extract base64 data from data URL
        const base64Data = capture.screenshot.split(',')[1];
        if (base64Data) {
          await fs.promises.writeFile(screenshotPath, Buffer.from(base64Data, 'base64'));
          extensionScreenshotPath = screenshotPath;
          logger.info('BookmarkAPI', `[OPT-115] Saved extension screenshot: ${screenshotFilename}`);
        }
      } catch (err) {
        logger.error('BookmarkAPI', `Failed to save screenshot: ${err}`);
      }
    }

    // Save HTML if present
    if (capture.html) {
      try {
        const htmlFilename = `${sourceId}_extension.html`;
        const htmlPath = path.join(websourcesDir, htmlFilename);
        await fs.promises.writeFile(htmlPath, capture.html, 'utf-8');
        extensionHtmlPath = htmlPath;
        logger.info('BookmarkAPI', `[OPT-115] Saved extension HTML: ${htmlFilename}`);
      } catch (err) {
        logger.error('BookmarkAPI', `Failed to save HTML: ${err}`);
      }
    }

    // Build update object with all extracted metadata
    const updateData: Record<string, unknown> = {
      capture_method: 'extension',
      extension_captured_at: capture.capturedAt || new Date().toISOString(),
      extension_screenshot_path: extensionScreenshotPath,
      extension_html_path: extensionHtmlPath,

      // Domain
      domain: capture.domain || null,
      canonical_url: capture.canonicalUrl || null,
      language: capture.language || null,

      // Content stats
      word_count: capture.wordCount || 0,
      image_count: capture.imageCount || capture.images?.length || 0,

      // Extracted text (for immediate partial archive)
      extracted_text: capture.textContent?.substring(0, 100000) || null, // Limit to 100KB

      // Open Graph metadata
      og_title: capture.openGraph?.title || null,
      og_description: capture.openGraph?.description || null,
      og_image: capture.openGraph?.image || null,

      // Consolidated extracted fields (from meta tags)
      extracted_title: capture.openGraph?.title || capture.meta?.author || capture.title || null,
      extracted_author: capture.meta?.author || null,
      extracted_date: capture.meta?.publishDate || null,
      extracted_publisher: capture.meta?.publisher || capture.openGraph?.siteName || null,

      // Full JSON dumps for advanced querying
      twitter_card_json: capture.twitterCards ? JSON.stringify(capture.twitterCards) : null,
      schema_org_json: capture.schemaOrg?.length ? JSON.stringify(capture.schemaOrg) : null,
      extracted_links: capture.links?.length ? JSON.stringify(capture.links) : null,
      page_metadata_json: JSON.stringify({
        openGraph: capture.openGraph,
        twitterCards: capture.twitterCards,
        meta: capture.meta,
        schemaOrg: capture.schemaOrg,
        favicon: capture.favicon,
        capturedAt: capture.capturedAt,
        captureMethod: 'extension',
      }),

      // Mark as partially complete (extension capture done, puppeteer pending)
      status: 'partial',
      component_status: JSON.stringify({
        screenshot: extensionScreenshotPath ? 'done' : 'pending',
        html: extensionHtmlPath ? 'done' : 'pending',
        pdf: 'pending',
        warc: 'pending',
        images: 'pending',
        videos: 'pending',
        text: capture.textContent ? 'done' : 'pending',
      }),
    };

    // Update web source with all metadata
    await webSourcesRepository.update(sourceId, updateData);

    // Store images metadata in web_source_images table
    if (capture.images && capture.images.length > 0) {
      try {
        for (let i = 0; i < capture.images.length; i++) {
          const img = capture.images[i];
          await webSourcesRepository.insertImage(sourceId, i, {
            url: img.url,
            alt: img.alt || undefined,
            caption: img.caption || undefined,
            credit: img.credit || undefined,
            attribution: img.attribution || undefined,
            srcsetVariants: img.srcset ? [img.srcset] : undefined,
            width: img.width || undefined,
            height: img.height || undefined,
            isHero: img.isHero,
          });
        }
        logger.info('BookmarkAPI', `[OPT-115] Stored ${capture.images.length} image metadata records`);
      } catch (err) {
        logger.error('BookmarkAPI', `Failed to store image metadata: ${err}`);
      }
    }

    // OPT-121: Store session data securely for authenticated re-fetch
    // This allows Puppeteer to use the same cookies for PDF/WARC generation
    if (capture.cookies || capture.localStorage || capture.sessionStorage) {
      try {
        const sessionFilename = `${sourceId}_session.json`;
        const sessionPath = path.join(websourcesDir, sessionFilename);

        // Store session data (sensitive - not exposed to renderer)
        const sessionData = {
          capturedAt: capture.capturedAt || new Date().toISOString(),
          domain: capture.domain,
          userAgent: capture.userAgent,
          viewport: capture.viewport,
          // Cookies for authenticated requests
          cookies: capture.cookies || [],
          // Storage data (may contain auth tokens)
          localStorage: capture.localStorage || '{}',
          sessionStorage: capture.sessionStorage || '{}',
        };

        await fs.promises.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
        logger.info('BookmarkAPI', `[OPT-121] Stored session data: ${sessionFilename} (${capture.cookies?.length || 0} cookies)`);
      } catch (err) {
        logger.error('BookmarkAPI', `[OPT-121] Failed to store session data: ${err}`);
      }
    }

    logger.info('BookmarkAPI', `[OPT-115] Extension capture processed for ${sourceId}`);
  } catch (err) {
    logger.error('BookmarkAPI', `[OPT-115] Extension capture processing error: ${err}`);
  }
}

let webSourcesRepository: SQLiteWebSourcesRepository | null = null;
let locationsRepository: SQLiteLocationRepository | null = null;
let subLocationsRepository: SQLiteSubLocationRepository | null = null;
let server: http.Server | null = null;
let jobQueue: JobQueue | null = null;
let database: Kysely<Database> | null = null;

/**
 * Parse JSON body from incoming request
 */
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response with CORS headers
 */
function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Map WebSource to legacy bookmark response format for extension compatibility
 */
function mapToBookmarkResponse(source: WebSource): {
  bookmark_id: string;
  url: string;
  title: string | null;
  locid: string | null;
  subid: string | null;
  bookmark_date: string;
  source_type: string;
} {
  return {
    bookmark_id: source.source_id,
    url: source.url,
    title: source.title,
    locid: source.locid,
    subid: source.subid,
    bookmark_date: source.created_at,
    source_type: source.source_type,
  };
}

/**
 * Handle incoming HTTP requests
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    sendJson(res, 200, {});
    return;
  }

  logger.info('BookmarkAPI', `${method} ${path}`);

  try {
    // GET /api/status - Check if app is running
    if (method === 'GET' && path === '/api/status') {
      sendJson(res, 200, { running: true, version: '2.0.0' });
      return;
    }

    // POST /api/bookmark - Save a web source (endpoint name kept for extension compat)
    // OPT-115: Now handles full page capture from extension
    if (method === 'POST' && path === '/api/bookmark') {
      if (!webSourcesRepository) {
        sendJson(res, 500, { error: 'Web sources repository not initialized' });
        return;
      }

      const body = await parseBody(req);

      if (!body.url || typeof body.url !== 'string') {
        sendJson(res, 400, { error: 'URL is required' });
        return;
      }

      // Check for duplicate before creating
      const existingSource = await webSourcesRepository.findByUrl(body.url);
      if (existingSource) {
        // Return existing source info with duplicate flag for premium UX
        sendJson(res, 200, {
          success: true,
          duplicate: true,
          bookmark_id: existingSource.source_id,
          source_type: existingSource.source_type,
          message: `Already saved${existingSource.locnam ? ` to ${existingSource.locnam}` : ''}`,
        });
        return;
      }

      // Auto-detect source type from URL
      const detectedType = detectSourceType(body.url);

      // OPT-115: Extract capture data from extension
      const capture = body.capture as ExtensionCapture | undefined;

      try {
        const source = await webSourcesRepository.create({
          url: body.url,
          title: typeof body.title === 'string' ? body.title : null,
          locid: typeof body.locid === 'string' ? body.locid : null,
          subid: typeof body.subid === 'string' ? body.subid : null,
          source_type: detectedType,
          auth_imp: null,
        });

        // OPT-115: Process extension capture data
        if (capture) {
          await processExtensionCapture(source.source_id, body.url, capture);
        }

        // OPT-115: Auto-queue Puppeteer job for PDF/WARC/full-page screenshot
        // This runs AFTER extension capture completes to fill in what extension can't do
        if (jobQueue && database) {
          try {
            // Check if job already exists (duplicate prevention)
            const existingJobs = await database
              .selectFrom('jobs')
              .select('job_id')
              .where('queue', '=', IMPORT_QUEUES.WEBSOURCE_ARCHIVE)
              .where('status', 'in', ['pending', 'processing'])
              .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
              .execute();

            if (existingJobs.length === 0) {
              await jobQueue.addJob({
                queue: IMPORT_QUEUES.WEBSOURCE_ARCHIVE,
                payload: { sourceId: source.source_id },
                priority: 5, // Lower priority than media imports (default 10)
              });
              logger.info('BookmarkAPI', `[OPT-115] Auto-queued Puppeteer archive job for ${source.source_id}`);
            } else {
              logger.info('BookmarkAPI', `[OPT-115] Archive job already queued for ${source.source_id}`);
            }
          } catch (queueError) {
            // Don't fail create if queue fails - just log and continue
            logger.error('BookmarkAPI', `[OPT-115] Failed to queue archive job: ${queueError}`);
          }
        }

        // Notify WebSocket clients about the new web source
        notifyWebSourceSaved(source.source_id, source.locid, source.subid, source.source_type);

        // Return with backward-compatible field names for extension
        sendJson(res, 201, {
          success: true,
          bookmark_id: source.source_id,
          source_type: source.source_type,
          captured: !!capture, // Let extension know capture was processed
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('BookmarkAPI', `Create web source error: ${message}`);
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // POST /api/location - Create a new location from the extension
    if (method === 'POST' && path === '/api/location') {
      if (!locationsRepository) {
        sendJson(res, 500, { error: 'Locations repository not initialized' });
        return;
      }

      const body = await parseBody(req);

      if (!body.name || typeof body.name !== 'string') {
        sendJson(res, 400, { error: 'Location name is required' });
        return;
      }

      try {
        const location = await locationsRepository.create({
          locnam: body.name.trim(),
          address: {
            state:
              typeof body.state === 'string'
                ? body.state.toUpperCase().substring(0, 2)
                : undefined,
            verified: false,
          },
          category: typeof body.type === 'string' ? body.type : undefined,
          // Required boolean defaults
          historic: false,
          favorite: false,
          project: false,
          docInterior: false,
          docExterior: false,
          docDrone: false,
          docWebHistory: false,
          docMapFind: false,
          locnamVerified: false,
          akanamVerified: false,
          isHostOnly: false,
        });

        // Notify WebSocket clients about the new location
        notifyLocationsUpdated();

        sendJson(res, 201, {
          success: true,
          locid: location.locid,
          locnam: location.locnam,
        });
      } catch (error) {
        logger.error('BookmarkAPI', `Create location error: ${error}`);
        sendJson(res, 500, { error: 'Failed to create location' });
      }
      return;
    }

    // GET /api/locations?search=query - Search locations for autocomplete
    if (method === 'GET' && path === '/api/locations') {
      if (!locationsRepository) {
        sendJson(res, 500, { error: 'Locations repository not initialized' });
        return;
      }

      const search = url.searchParams.get('search') || '';
      const locations = await locationsRepository.findAll({ search, limit: 10 });

      sendJson(res, 200, {
        locations: locations.map((loc) => ({
          locid: loc.locid,
          locnam: loc.locnam,
          address_state: loc.address?.state || null,
        })),
      });
      return;
    }

    // GET /api/search?q=query - Unified search for locations AND sub-locations
    if (method === 'GET' && path === '/api/search') {
      if (!locationsRepository || !subLocationsRepository) {
        sendJson(res, 500, { error: 'Repositories not initialized' });
        return;
      }

      const query = (url.searchParams.get('q') || '').toLowerCase().trim();
      const limit = parseInt(url.searchParams.get('limit') || '15', 10);

      if (!query) {
        sendJson(res, 200, { results: [] });
        return;
      }

      // Search locations
      const locations = await locationsRepository.findAll({ search: query, limit: 10 });
      const locationResults = locations.map((loc) => ({
        type: 'location' as const,
        locid: loc.locid,
        subid: null,
        name: loc.locnam,
        parentName: null,
        address_state: loc.address?.state || null,
      }));

      // Search sub-locations: We need to search across all sub-locations
      // Since there's no search method, we'll get all locations and filter their sub-locations
      const allLocations = await locationsRepository.findAll({ limit: 100 });
      const subLocationResults: Array<{
        type: 'sublocation';
        locid: string;
        subid: string;
        name: string;
        parentName: string;
        address_state: string | null;
      }> = [];

      for (const loc of allLocations) {
        const sublocs = await subLocationsRepository.findByLocationId(loc.locid);
        for (const subloc of sublocs) {
          const matchesName = subloc.subnam.toLowerCase().includes(query);
          const matchesAka = subloc.akanam?.toLowerCase().includes(query);

          if (matchesName || matchesAka) {
            subLocationResults.push({
              type: 'sublocation',
              locid: loc.locid,
              subid: subloc.subid,
              name: subloc.subnam,
              parentName: loc.locnam,
              address_state: loc.address?.state || null,
            });
          }
        }
        // Stop if we have enough sub-location results
        if (subLocationResults.length >= 10) break;
      }

      // Combine and limit results (locations first, then sub-locations)
      const allResults = [...locationResults, ...subLocationResults].slice(0, limit);

      sendJson(res, 200, { results: allResults });
      return;
    }

    // GET /api/recent?limit=5 - Get recent web sources (endpoint name kept for compat)
    if (method === 'GET' && path === '/api/recent') {
      if (!webSourcesRepository) {
        sendJson(res, 500, { error: 'Web sources repository not initialized' });
        return;
      }

      const limit = parseInt(url.searchParams.get('limit') || '5', 10);
      const sources = await webSourcesRepository.findRecent(limit);

      // Map to legacy format for extension compatibility
      sendJson(res, 200, { bookmarks: sources.map(mapToBookmarkResponse) });
      return;
    }

    // GET /api/recent-locations?limit=5 - Get recently used/created locations
    if (method === 'GET' && path === '/api/recent-locations') {
      if (!webSourcesRepository || !locationsRepository) {
        sendJson(res, 500, { error: 'Repositories not initialized' });
        return;
      }

      const limit = parseInt(url.searchParams.get('limit') || '5', 10);
      const seenLocids = new Set<string>();
      const recentLocations: Array<{ locid: string; locnam: string; address_state: string | null }> = [];

      // First: Get locations from recent web sources (most recently used)
      const recentSources = await webSourcesRepository.findRecent(50);
      for (const source of recentSources) {
        if (source.locid && !seenLocids.has(source.locid)) {
          seenLocids.add(source.locid);
          try {
            const location = await locationsRepository.findById(source.locid);
            if (location) {
              recentLocations.push({
                locid: location.locid,
                locnam: location.locnam,
                address_state: location.address?.state || null,
              });
            }
          } catch {
            // Location may have been deleted, skip
          }
          if (recentLocations.length >= limit) break;
        }
      }

      // Second: Fill remaining slots with recently created locations
      if (recentLocations.length < limit) {
        const allLocations = await locationsRepository.findAll();
        // findAll returns ordered by locadd desc (most recent first)
        for (const location of allLocations) {
          if (!seenLocids.has(location.locid)) {
            seenLocids.add(location.locid);
            recentLocations.push({
              locid: location.locid,
              locnam: location.locnam,
              address_state: location.address?.state || null,
            });
            if (recentLocations.length >= limit) break;
          }
        }
      }

      sendJson(res, 200, { locations: recentLocations });
      return;
    }

    // 404 for unknown routes
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    logger.error('BookmarkAPI', `Error: ${error}`);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/**
 * Start the HTTP server
 *
 * @param webSourcesRepo - Web sources repository (OPT-109 replacement for bookmarks)
 * @param locationsRepo - Locations repository
 * @param subLocationsRepo - Sub-locations repository
 * @param db - Kysely database instance (OPT-115: needed for job queue)
 */
export function startBookmarkAPIServer(
  webSourcesRepo: SQLiteWebSourcesRepository,
  locationsRepo: SQLiteLocationRepository,
  subLocationsRepo: SQLiteSubLocationRepository,
  db?: Kysely<Database>
): Promise<void> {
  return new Promise((resolve, reject) => {
    webSourcesRepository = webSourcesRepo;
    locationsRepository = locationsRepo;
    subLocationsRepository = subLocationsRepo;

    // OPT-115: Initialize job queue for auto-archiving
    if (db) {
      database = db;
      jobQueue = new JobQueue(db);
      logger.info('BookmarkAPI', '[OPT-115] Job queue initialized for auto-archiving');
    }

    server = http.createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        logger.error('BookmarkAPI', `Unhandled error: ${error}`);
        sendJson(res, 500, { error: 'Internal server error' });
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error('BookmarkAPI', `Port ${PORT} is already in use`);
        reject(new Error(`Port ${PORT} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      logger.info('BookmarkAPI', `Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

/**
 * Stop the HTTP server
 */
export function stopBookmarkAPIServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        logger.info('BookmarkAPI', 'Server stopped');
        server = null;
        webSourcesRepository = null;
        locationsRepository = null;
        subLocationsRepository = null;
        jobQueue = null;
        database = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Check if server is running
 */
export function isBookmarkAPIServerRunning(): boolean {
  return server !== null && server.listening;
}
