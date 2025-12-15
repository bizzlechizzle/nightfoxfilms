/**
 * Web Source Orchestrator Service
 * OPT-109: Coordinates the complete web archiving pipeline
 * OPT-112: Enhanced with comprehensive metadata extraction
 *
 * This service orchestrates:
 * - Page capture (Screenshot, PDF, HTML, WARC)
 * - Content extraction (Images, Videos, Text)
 * - Metadata extraction (Open Graph, Schema.org, Dublin Core)
 * - Per-image and per-video metadata storage
 * - Repository updates
 * - Provenance hash generation
 * - Media linking to locations
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import {
  SQLiteWebSourcesRepository,
  WebSource,
  WebSourceInput,
  ComponentStatus,
} from '../repositories/sqlite-websources-repository';
import {
  captureScreenshot,
  capturePdf,
  captureHtml,
  captureWarc,
  captureAll,
  extractMetadata,
  CaptureOptions,
  closeBrowser,
  getBrowser,
} from './websource-capture-service';
import {
  extractImages,
  extractVideos,
  extractText,
  extractAll,
  ExtractionOptions,
  ExtractedImage,
  ExtractedVideo,
} from './websource-extraction-service';
import {
  extractPageMetadata,
  consolidateMetadata,
  PageMetadata,
  ImageDomContext,
} from './websource-metadata-service';
import { calculateHash, calculateHashBuffer } from './crypto-service';
import { getTimelineService } from '../main/ipc-handlers/timeline';
import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY } from './job-queue';
import { autoConvertToWACZ } from './wacz-service';

// =============================================================================
// Types and Interfaces
// =============================================================================

export interface ArchiveProgress {
  sourceId: string;
  url: string;
  phase: 'metadata' | 'capture' | 'extraction' | 'linking' | 'complete' | 'error';
  component?: string;
  progress: number; // 0-100
  message: string;
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

export interface ArchiveOptions {
  captureScreenshot?: boolean;
  capturePdf?: boolean;
  captureHtml?: boolean;
  captureWarc?: boolean;
  extractImages?: boolean;
  extractVideos?: boolean;
  extractText?: boolean;
  linkMedia?: boolean; // Link extracted media to location
  timeout?: number;
  maxImages?: number;
  maxVideos?: number;
}

const DEFAULT_OPTIONS: ArchiveOptions = {
  captureScreenshot: true,
  capturePdf: true,
  captureHtml: true,
  captureWarc: true,
  extractImages: true,
  extractVideos: true, // OPT-110: Always extract videos per user requirement
  extractText: true,
  linkMedia: true,
  timeout: 60000,
  maxImages: 50,
  maxVideos: 10, // OPT-110: Increased from 3 to allow more video extraction
};

// =============================================================================
// Orchestrator Class
// =============================================================================

export class WebSourceOrchestrator extends EventEmitter {
  private repository: SQLiteWebSourcesRepository;
  private archiveBasePath: string | null = null;
  private isProcessing = false;
  private currentSourceId: string | null = null;
  private jobQueue: JobQueue;

  constructor(private readonly db: Kysely<Database>) {
    super();
    this.repository = new SQLiteWebSourcesRepository(db);
    this.jobQueue = new JobQueue(db);
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Add a new URL to be archived
   */
  async addSource(input: WebSourceInput): Promise<WebSource> {
    return this.repository.create(input);
  }

  /**
   * Archive a single web source
   */
  async archiveSource(
    sourceId: string,
    options: ArchiveOptions = {}
  ): Promise<ArchiveResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    try {
      // Get source from repository
      const source = await this.repository.findById(sourceId);
      if (!source) {
        throw new Error(`Web source not found: ${sourceId}`);
      }

      // OPT-121: Check for existing extension capture data
      // Extension-first architecture: trust extension data when available
      const hasExtensionScreenshot = !!(source as unknown as { extension_screenshot_path?: string }).extension_screenshot_path;
      const hasExtensionHtml = !!(source as unknown as { extension_html_path?: string }).extension_html_path;
      const hasExtensionText = !!(source as unknown as { extracted_text?: string }).extracted_text;

      if (hasExtensionScreenshot || hasExtensionHtml) {
        console.log(`[OPT-121] Extension capture found: screenshot=${hasExtensionScreenshot}, html=${hasExtensionHtml}, text=${hasExtensionText}`);
      }

      // Mark as archiving
      await this.repository.markArchiving(sourceId);
      this.currentSourceId = sourceId;
      this.isProcessing = true;

      // Get archive base path
      const archivePath = await this.getArchivePath(source);
      await fs.promises.mkdir(archivePath, { recursive: true });

      // Initialize component status
      const componentStatus: ComponentStatus = {};

      // Phase 1: Extract metadata (basic from capture service)
      this.emitProgress(sourceId, source.url, 'metadata', undefined, 5, 'Extracting basic metadata...');
      const metadata = await extractMetadata(source.url, opts.timeout);

      // OPT-112: Extract comprehensive page metadata using dedicated service
      let pageMetadata: PageMetadata | null = null;
      let imageDomContext: ImageDomContext[] = [];
      try {
        this.emitProgress(sourceId, source.url, 'metadata', undefined, 10, 'Extracting structured metadata...');
        // We need a browser page to extract DOM metadata
        const browser = await getBrowser();
        const page = await browser.newPage();

        try {
          const response = await page.goto(source.url, {
            waitUntil: 'networkidle2',
            timeout: opts.timeout || 30000,
          });

          // Capture HTTP headers and status
          const responseHeaders: Record<string, string> = {};
          const headers = response?.headers() || {};
          for (const [key, value] of Object.entries(headers)) {
            responseHeaders[key] = String(value);
          }
          const responseStatus = response?.status() || null;

          // OPT-112: Check for bot detection / access denied responses
          if (responseStatus === 403) {
            const blockInfo = await this.detectBotBlock(page);
            if (blockInfo.isBlocked) {
              throw new Error(`ACCESS DENIED (403): ${blockInfo.reason}. The site is blocking automated access. Try visiting the URL in the Research Browser first to establish cookies.`);
            }
          }

          // Also check for soft blocks (200 status but captcha/challenge page)
          const softBlock = await this.detectBotBlock(page);
          if (softBlock.isBlocked) {
            console.warn(`OPT-112: Soft block detected: ${softBlock.reason}`);
            // Don't fail, but log the warning - content may be limited
          }

          // Extract comprehensive metadata from DOM
          pageMetadata = await extractPageMetadata(page, source.url, responseHeaders, responseStatus || undefined);
          imageDomContext = pageMetadata.images;

          // Consolidate to get best values
          const consolidated = consolidateMetadata(pageMetadata);

          // Override basic metadata with better extracted values
          if (consolidated.title) metadata.title = consolidated.title;
          if (consolidated.author) metadata.author = consolidated.author;
          if (consolidated.publishDate) metadata.date = consolidated.publishDate;
          if (consolidated.publisher) metadata.publisher = consolidated.publisher;
        } finally {
          await page.close().catch(() => {});
        }
      } catch (err) {
        console.error('OPT-112: Page metadata extraction failed, continuing with basic metadata:', err);
        // Continue with basic metadata - this is not a critical failure
      }

      // Phase 2: Capture page in various formats
      let screenshotPath: string | null = null;
      let pdfPath: string | null = null;
      let htmlPath: string | null = null;
      let warcPath: string | null = null;
      let screenshotHash: string | null = null;
      let pdfHash: string | null = null;
      let htmlHash: string | null = null;
      let warcHash: string | null = null;

      const captureOptions: CaptureOptions = {
        url: source.url,
        outputDir: archivePath,
        sourceId,
        timeout: opts.timeout,
        // Browsertrix-level archiving: run thorough behaviors to expand all content
        runBehaviors: 'thorough',
      };

      // OPT-121: Extension-first screenshot capture
      // Trust extension screenshot if available - it's captured from the user's authenticated session
      if (opts.captureScreenshot) {
        if (hasExtensionScreenshot) {
          // Use extension screenshot - it's from the user's real browser session
          const extScreenshotPath = (source as unknown as { extension_screenshot_path: string }).extension_screenshot_path;
          screenshotPath = extScreenshotPath;
          try {
            screenshotHash = await calculateHash(extScreenshotPath);
            componentStatus.screenshot = 'done';
            this.emitProgress(sourceId, source.url, 'capture', 'screenshot', 20, 'Using extension screenshot (authenticated session)');
            console.log(`[OPT-121] Using extension screenshot: ${extScreenshotPath}`);
          } catch (err) {
            console.warn(`[OPT-121] Extension screenshot file not found, falling back to Puppeteer: ${err}`);
            const result = await captureScreenshot(captureOptions);
            if (result.success) {
              screenshotPath = result.path || null;
              screenshotHash = result.hash || null;
              componentStatus.screenshot = 'done';
            } else {
              componentStatus.screenshot = 'failed';
            }
          }
        } else {
          // No extension screenshot - use Puppeteer (may get blocked on protected sites)
          this.emitProgress(sourceId, source.url, 'capture', 'screenshot', 20, 'Capturing screenshot...');
          const result = await captureScreenshot(captureOptions);
          if (result.success) {
            screenshotPath = result.path || null;
            screenshotHash = result.hash || null;
            componentStatus.screenshot = 'done';
          } else {
            componentStatus.screenshot = 'failed';
          }
        }
      } else {
        componentStatus.screenshot = 'skipped';
      }

      // PDF capture - always needs Puppeteer (extension can't generate PDF)
      // OPT-121: PDF may fail on protected sites - that's expected
      if (opts.capturePdf) {
        this.emitProgress(sourceId, source.url, 'capture', 'pdf', 30, 'Generating PDF...');
        const result = await capturePdf(captureOptions);
        if (result.success) {
          pdfPath = result.path || null;
          pdfHash = result.hash || null;
          componentStatus.pdf = 'done';
        } else {
          // OPT-121: Log but don't fail - PDF is nice-to-have if we have extension data
          if (hasExtensionScreenshot || hasExtensionHtml) {
            console.log(`[OPT-121] PDF capture failed (site may block automation) - extension data available as fallback`);
          }
          componentStatus.pdf = 'failed';
        }
      } else {
        componentStatus.pdf = 'skipped';
      }

      // OPT-121: Extension-first HTML capture
      // Trust extension HTML - it's from the actual rendered page the user saw
      if (opts.captureHtml) {
        if (hasExtensionHtml) {
          // Use extension HTML - it's the actual DOM from user's session
          const extHtmlPath = (source as unknown as { extension_html_path: string }).extension_html_path;
          // Copy to archive location with standard naming
          const destHtmlPath = path.join(archivePath, `${sourceId}.html`);
          try {
            await fs.promises.copyFile(extHtmlPath, destHtmlPath);
            htmlPath = destHtmlPath;
            htmlHash = await calculateHash(destHtmlPath);
            componentStatus.html = 'done';
            this.emitProgress(sourceId, source.url, 'capture', 'html', 40, 'Using extension HTML (authenticated session)');
            console.log(`[OPT-121] Using extension HTML: ${extHtmlPath} → ${destHtmlPath}`);
          } catch (err) {
            console.warn(`[OPT-121] Extension HTML copy failed, falling back to Puppeteer: ${err}`);
            const result = await captureHtml(captureOptions);
            if (result.success) {
              htmlPath = result.path || null;
              htmlHash = result.hash || null;
              componentStatus.html = 'done';
            } else {
              componentStatus.html = 'failed';
            }
          }
        } else {
          // No extension HTML - use Puppeteer (may get blocked)
          this.emitProgress(sourceId, source.url, 'capture', 'html', 40, 'Saving HTML...');
          const result = await captureHtml(captureOptions);
          if (result.success) {
            htmlPath = result.path || null;
            htmlHash = result.hash || null;
            componentStatus.html = 'done';
          } else {
            componentStatus.html = 'failed';
          }
        }
      } else {
        componentStatus.html = 'skipped';
      }

      // WARC capture - always needs Puppeteer (extension can't generate WARC)
      // OPT-121: WARC may fail on protected sites - that's expected
      if (opts.captureWarc) {
        this.emitProgress(sourceId, source.url, 'capture', 'warc', 50, 'Creating WARC archive...');
        const result = await captureWarc(captureOptions);
        if (result.success) {
          warcPath = result.path || null;
          warcHash = result.hash || null;
          componentStatus.warc = 'done';

          // OPT-121: Auto-convert WARC to WACZ for ReplayWeb.page compatibility
          if (warcPath) {
            this.emitProgress(sourceId, source.url, 'capture', 'wacz', 55, 'Converting to WACZ format...');
            try {
              const waczResult = await autoConvertToWACZ(warcPath, {
                title: source.title || metadata.title || 'Archived Page',
                url: source.url,
                ts: new Date().toISOString(),
                software: 'AU Archive',
              });
              if (waczResult.success) {
                console.log(`[OPT-121] WACZ created: ${waczResult.path}`);
                // Store WACZ path in repository (if column exists)
                try {
                  await this.repository.update(sourceId, { wacz_path: waczResult.path });
                } catch {
                  // wacz_path column might not exist yet - that's ok
                }
              } else {
                console.warn(`[OPT-121] WACZ conversion failed: ${waczResult.error}`);
              }
            } catch (waczError) {
              console.warn(`[OPT-121] WACZ conversion error: ${waczError}`);
              // Don't fail the archive if WACZ conversion fails
            }
          }
        } else {
          // OPT-121: Log but don't fail - WARC is nice-to-have if we have extension data
          if (hasExtensionScreenshot || hasExtensionHtml) {
            console.log(`[OPT-121] WARC capture failed (site may block automation) - extension data available as fallback`);
          }
          componentStatus.warc = 'failed';
        }
      } else {
        componentStatus.warc = 'skipped';
      }

      // Phase 3: Extract content
      // OPT-112: Pass DOM context for enhanced image metadata extraction
      const extractionOptions: ExtractionOptions = {
        url: source.url,
        outputDir: archivePath,
        sourceId,
        locid: source.locid || undefined,
        timeout: opts.timeout,
        maxImages: opts.maxImages,
        maxVideos: opts.maxVideos,
        imageDomContext: imageDomContext.length > 0 ? imageDomContext : undefined,
      };

      let extractedImages: ExtractedImage[] = [];
      let extractedVideos: ExtractedVideo[] = [];
      let wordCount = metadata.wordCount;
      let contentHash: string | null = null;
      let extractedTextContent: string | null = null; // OPT-110: Capture text for FTS5

      // Image extraction
      if (opts.extractImages) {
        this.emitProgress(sourceId, source.url, 'extraction', 'images', 60, 'Extracting images...');
        const result = await extractImages(extractionOptions);
        if (result.success) {
          extractedImages = result.images;
          componentStatus.images = 'done';
        } else {
          componentStatus.images = 'failed';
        }
      } else {
        componentStatus.images = 'skipped';
      }

      // Video extraction
      if (opts.extractVideos) {
        this.emitProgress(sourceId, source.url, 'extraction', 'videos', 70, 'Extracting videos...');
        const result = await extractVideos(extractionOptions);
        if (result.success) {
          extractedVideos = result.videos;
          componentStatus.videos = 'done';
        } else {
          componentStatus.videos = 'failed';
        }
      } else {
        componentStatus.videos = 'skipped';
      }

      // Text extraction
      if (opts.extractText) {
        this.emitProgress(sourceId, source.url, 'extraction', 'text', 80, 'Extracting text content...');
        const result = await extractText(extractionOptions);
        if (result.success && result.text) {
          wordCount = result.text.wordCount;
          contentHash = result.text.hash;
          extractedTextContent = result.text.content; // OPT-110: Capture text for FTS5 storage

          // OPT-120: Fallback to OG description when extracted content is too short
          // This handles JS-heavy sites like Zillow where main content is in metadata
          if (extractedTextContent && extractedTextContent.length < 200 && pageMetadata) {
            const ogDescription = pageMetadata.openGraph?.description;
            const schemaDescription = pageMetadata.schemaOrg?.[0]?.description;
            const metaDescription = pageMetadata.metaDescription;

            // Build enriched content from metadata
            const metaContent: string[] = [];
            if (ogDescription) metaContent.push(`[Open Graph] ${ogDescription}`);
            if (schemaDescription && schemaDescription !== ogDescription) {
              metaContent.push(`[Schema.org] ${schemaDescription}`);
            }
            if (metaDescription && metaDescription !== ogDescription && metaDescription !== schemaDescription) {
              metaContent.push(`[Meta Description] ${metaDescription}`);
            }

            if (metaContent.length > 0) {
              const enrichedContent = metaContent.join('\n\n') +
                (extractedTextContent.length > 0 ? '\n\n[Extracted Text] ' + extractedTextContent : '');

              console.log(`[WebSource] OPT-120: Enriched short content (${extractedTextContent.length} chars) with OG description (${enrichedContent.length} chars total)`);
              extractedTextContent = enrichedContent;
              wordCount = extractedTextContent.split(/\s+/).filter(w => w.length > 0).length;
            }
          }

          componentStatus.text = 'done';

          // Migration 73: Queue date extraction job if we have text content
          // Date extraction runs in background after text extraction completes
          if (extractedTextContent && extractedTextContent.length > 0) {
            try {
              await this.jobQueue.addJob({
                queue: IMPORT_QUEUES.DATE_EXTRACTION,
                payload: { sourceId },
                priority: JOB_PRIORITY.BACKGROUND,
              });
              console.log(`[WebSource] Queued date extraction job for ${sourceId}`);
            } catch (queueError) {
              // Don't fail the archive if job queueing fails
              console.error('[WebSource] Failed to queue date extraction job:', queueError);
            }
          }
        } else {
          componentStatus.text = 'failed';
        }
      } else {
        componentStatus.text = 'skipped';
      }

      // Phase 4: Link extracted media to location
      if (opts.linkMedia && source.locid && extractedImages.length > 0) {
        this.emitProgress(sourceId, source.url, 'linking', undefined, 85, 'Linking media to location...');
        await this.linkExtractedMedia(source.locid, source.subid, sourceId, extractedImages, extractedVideos);
      }

      // OPT-112: Store per-image metadata in web_source_images table
      // Note: Convert null to undefined for repository method compatibility
      if (extractedImages.length > 0) {
        this.emitProgress(sourceId, source.url, 'linking', undefined, 88, 'Storing image metadata...');
        try {
          await this.repository.insertSourceImages(sourceId, extractedImages.map(img => ({
            url: img.url,
            localPath: img.localPath,
            hash: img.hash,
            width: img.width,
            height: img.height,
            size: img.size,
            originalFilename: img.originalFilename || undefined,
            alt: img.alt || undefined,
            caption: img.caption || undefined,
            credit: img.credit || undefined,
            attribution: img.attribution || undefined,
            srcsetVariants: img.srcsetVariants,
            contextHtml: img.contextHtml || undefined,
            linkUrl: img.linkUrl || undefined,
            exifData: img.exifData || undefined,
            isHiRes: img.isHiRes,
            isHero: img.isHero,
          })));
        } catch (err) {
          console.error('OPT-112: Failed to store image metadata:', err);
        }
      }

      // OPT-112: Store per-video metadata in web_source_videos table
      // Note: Convert null to undefined for repository method compatibility
      if (extractedVideos.length > 0) {
        this.emitProgress(sourceId, source.url, 'linking', undefined, 90, 'Storing video metadata...');
        try {
          await this.repository.insertSourceVideos(sourceId, extractedVideos.map(vid => ({
            url: vid.url,
            localPath: vid.localPath,
            hash: vid.hash,
            title: vid.title || undefined,
            description: vid.description || undefined,
            duration: vid.duration || undefined,
            size: vid.size,
            platform: vid.platform,
            uploader: vid.uploader || undefined,
            uploaderUrl: vid.uploaderUrl || undefined,
            uploadDate: vid.uploadDate || undefined,
            viewCount: vid.viewCount || undefined,
            likeCount: vid.likeCount || undefined,
            tags: vid.tags,
            categories: vid.categories,
            thumbnailUrl: vid.thumbnailUrl || undefined,
            thumbnailPath: vid.thumbnailPath || undefined,
            metadataJson: vid.metadataJson || undefined,
          })));
        } catch (err) {
          console.error('OPT-112: Failed to store video metadata:', err);
        }
      }

      // OPT-112: Store page-level metadata (Open Graph, Schema.org, etc.)
      if (pageMetadata) {
        this.emitProgress(sourceId, source.url, 'linking', undefined, 92, 'Storing page metadata...');
        try {
          await this.repository.updatePageMetadata(sourceId, {
            domain: this.extractDomain(source.url),
            extractedLinks: pageMetadata.links,
            pageMetadata: {
              openGraph: pageMetadata.openGraph,
              schemaOrg: pageMetadata.schemaOrg,
              dublinCore: pageMetadata.dublinCore,
              twitterCards: pageMetadata.twitterCards,
              meta: {
                description: pageMetadata.metaDescription,
                keywords: pageMetadata.metaKeywords,
                robots: pageMetadata.metaRobots,
                author: pageMetadata.metaAuthor,
              },
            },
            httpHeaders: pageMetadata.httpHeaders,
            canonicalUrl: pageMetadata.canonicalUrl || undefined,
            language: pageMetadata.language || undefined,
          });
        } catch (err) {
          console.error('OPT-112: Failed to store page metadata:', err);
        }
      }

      // Calculate provenance hash (hash of all component hashes)
      const provenanceHash = this.calculateProvenanceHash({
        screenshotHash,
        pdfHash,
        htmlHash,
        warcHash,
        contentHash,
      });

      // Determine final status
      const hasAnySuccess =
        componentStatus.screenshot === 'done' ||
        componentStatus.pdf === 'done' ||
        componentStatus.html === 'done' ||
        componentStatus.warc === 'done' ||
        componentStatus.text === 'done';

      const hasAnyFailure =
        componentStatus.screenshot === 'failed' ||
        componentStatus.pdf === 'failed' ||
        componentStatus.html === 'failed' ||
        componentStatus.warc === 'failed' ||
        componentStatus.text === 'failed';

      if (hasAnySuccess && hasAnyFailure) {
        // Partial success - OPT-109 Fix: pass all successful component data
        // OPT-110: Now includes extracted_text for FTS5 search
        await this.repository.markPartial(sourceId, componentStatus, {
          archive_path: archivePath,
          screenshot_path: screenshotPath,
          pdf_path: pdfPath,
          html_path: htmlPath,
          warc_path: warcPath,
          screenshot_hash: screenshotHash,
          pdf_hash: pdfHash,
          html_hash: htmlHash,
          warc_hash: warcHash,
          content_hash: contentHash,
          provenance_hash: provenanceHash,
          extracted_title: metadata.title,
          extracted_author: metadata.author,
          extracted_date: metadata.date,
          extracted_publisher: metadata.publisher,
          extracted_text: extractedTextContent, // OPT-110: Store text for FTS5
          word_count: wordCount,
          image_count: extractedImages.length,
          video_count: extractedVideos.length,
        });
      } else if (hasAnySuccess) {
        // Complete success
        // OPT-110: Now includes extracted_text for FTS5 search
        await this.repository.markComplete(sourceId, {
          archive_path: archivePath,
          screenshot_path: screenshotPath,
          pdf_path: pdfPath,
          html_path: htmlPath,
          warc_path: warcPath,
          screenshot_hash: screenshotHash,
          pdf_hash: pdfHash,
          html_hash: htmlHash,
          warc_hash: warcHash,
          content_hash: contentHash,
          provenance_hash: provenanceHash,
          extracted_title: metadata.title,
          extracted_author: metadata.author,
          extracted_date: metadata.date,
          extracted_publisher: metadata.publisher,
          extracted_text: extractedTextContent, // OPT-110: Store text for FTS5
          word_count: wordCount,
          image_count: extractedImages.length,
          video_count: extractedVideos.length,
        });
      } else {
        // All failed
        await this.repository.markFailed(sourceId, 'All capture methods failed');
      }

      // Create version snapshot
      await this.repository.createVersion(sourceId, {
        archive_path: archivePath,
        screenshot_path: screenshotPath,
        pdf_path: pdfPath,
        html_path: htmlPath,
        warc_path: warcPath,
        screenshot_hash: screenshotHash,
        pdf_hash: pdfHash,
        html_hash: htmlHash,
        warc_hash: warcHash,
        content_hash: contentHash,
        word_count: wordCount,
        image_count: extractedImages.length,
        video_count: extractedVideos.length,
      });

      // OPT-119: Create timeline event for web page publish date
      if (source.locid && metadata.date) {
        try {
          const timelineService = getTimelineService();
          if (timelineService) {
            // Get current user for attribution
            const userSetting = await this.db
              .selectFrom('settings')
              .select('value')
              .where('key', '=', 'current_user')
              .executeTakeFirst();
            const currentUser = userSetting?.value || undefined;

            const displayTitle = metadata.title || source.title || 'Web Page';
            await timelineService.createWebPageEvent(
              source.locid,
              source.subid ?? null,
              sourceId,
              metadata.date,
              displayTitle,
              currentUser
            );
            console.log(`[WebSource] Created timeline event for ${sourceId} with date ${metadata.date} by ${currentUser}`);
          }
        } catch (timelineError) {
          // Don't fail the archive if timeline creation fails
          console.error('[WebSource] Failed to create timeline event:', timelineError);
        }
      }

      this.emitProgress(sourceId, source.url, 'complete', undefined, 100, 'Archive complete');

      return {
        success: true,
        sourceId,
        url: source.url,
        archivePath,
        screenshotPath,
        pdfPath,
        htmlPath,
        warcPath,
        extractedImages: extractedImages.length,
        extractedVideos: extractedVideos.length,
        wordCount,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.repository.markFailed(sourceId, errorMessage);
      this.emitProgress(sourceId, '', 'error', undefined, 0, errorMessage);

      return {
        success: false,
        sourceId,
        url: '',
        archivePath: null,
        screenshotPath: null,
        pdfPath: null,
        htmlPath: null,
        warcPath: null,
        extractedImages: 0,
        extractedVideos: 0,
        wordCount: 0,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    } finally {
      this.currentSourceId = null;
      this.isProcessing = false;
    }
  }

  /**
   * Archive all pending sources
   */
  async archivePending(
    limit: number = 10,
    options: ArchiveOptions = {}
  ): Promise<ArchiveResult[]> {
    const pendingSources = await this.repository.findPendingForArchive(limit);
    const results: ArchiveResult[] = [];

    for (const source of pendingSources) {
      const result = await this.archiveSource(source.source_id, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Re-archive an existing source (create new version)
   */
  async rearchiveSource(
    sourceId: string,
    options: ArchiveOptions = {}
  ): Promise<ArchiveResult> {
    // Reset to pending first
    await this.repository.resetToPending(sourceId);
    return this.archiveSource(sourceId, options);
  }

  /**
   * Cancel current archiving operation
   */
  async cancel(): Promise<void> {
    if (this.currentSourceId) {
      await this.repository.markFailed(this.currentSourceId, 'Cancelled by user');
    }
    await closeBrowser();
    this.isProcessing = false;
    this.currentSourceId = null;
  }

  /**
   * Get current processing status
   */
  getStatus(): { isProcessing: boolean; currentSourceId: string | null } {
    return {
      isProcessing: this.isProcessing,
      currentSourceId: this.currentSourceId,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Detect if the page is showing a bot detection challenge
   * OPT-112: Returns structured info about detected blocks
   */
  private async detectBotBlock(page: import('puppeteer-core').Page): Promise<{ isBlocked: boolean; reason: string }> {
    try {
      const blockInfo = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const bodyHtml = document.body?.innerHTML?.toLowerCase() || '';
        const title = document.title?.toLowerCase() || '';

        // Check for common bot detection indicators
        // OPT-121: Enhanced with CloudFront and comprehensive CDN error patterns
        const indicators = [
          // CloudFront (Amazon AWS) - OPT-121 critical addition
          { pattern: 'generated by cloudfront', reason: 'CloudFront 403 block' },
          { pattern: 'request could not be satisfied', reason: 'CloudFront request blocked' },
          { pattern: 'cloudfront request id', reason: 'CloudFront error page' },
          { pattern: 'there might be too much traffic', reason: 'CloudFront traffic limit' },
          { pattern: 'configuration error', reason: 'CloudFront configuration error' },
          // Generic access/error patterns
          { pattern: 'access denied', reason: 'Access Denied page' },
          { pattern: 'forbidden', reason: 'Forbidden response' },
          { pattern: 'blocked', reason: 'Request blocked' },
          { pattern: '403 error', reason: 'HTTP 403 Forbidden' },
          { pattern: '401 unauthorized', reason: 'HTTP 401 Unauthorized' },
          { pattern: '503 service', reason: 'HTTP 503 Service Unavailable' },
          { pattern: '502 bad gateway', reason: 'HTTP 502 Bad Gateway' },
          // CAPTCHA challenges
          { pattern: 'captcha', reason: 'CAPTCHA challenge' },
          { pattern: 'recaptcha', reason: 'reCAPTCHA challenge' },
          { pattern: 'hcaptcha', reason: 'hCaptcha challenge' },
          { pattern: 'verify you are human', reason: 'Human verification required' },
          { pattern: 'please verify', reason: 'Verification required' },
          { pattern: 'security check', reason: 'Security check required' },
          // Bot detection
          { pattern: 'unusual traffic', reason: 'Unusual traffic detected' },
          { pattern: 'automated access', reason: 'Automated access detected' },
          { pattern: 'bot detection', reason: 'Bot detection triggered' },
          // Cloudflare
          { pattern: 'cloudflare', reason: 'Cloudflare protection' },
          { pattern: 'ddos protection', reason: 'DDoS protection active' },
          { pattern: 'please wait while we verify', reason: 'Verification in progress' },
          { pattern: 'checking your browser', reason: 'Browser check in progress' },
          { pattern: 'just a moment', reason: 'Cloudflare "Just a moment" challenge' },
          { pattern: 'attention required', reason: 'Cloudflare attention required' },
          { pattern: 'ray id:', reason: 'Cloudflare Ray ID detected' },
          // Security services
          { pattern: 'perimeterx', reason: 'PerimeterX protection' },
          { pattern: 'distil', reason: 'Distil Networks protection' },
          { pattern: 'incapsula', reason: 'Incapsula protection' },
          { pattern: 'datadome', reason: 'DataDome protection' },
          { pattern: 'akamai', reason: 'Akamai protection' },
          { pattern: 'imperva', reason: 'Imperva protection' },
          { pattern: 'shape security', reason: 'Shape Security protection' },
          // Rate limiting
          { pattern: 'too many requests', reason: 'Rate limit exceeded' },
          { pattern: 'rate limit', reason: 'Rate limited' },
          { pattern: 'please try again later', reason: 'Temporary block' },
        ];

        for (const { pattern, reason } of indicators) {
          if (bodyText.includes(pattern) || title.includes(pattern)) {
            return { isBlocked: true, reason };
          }
        }

        // Check for suspiciously short pages (likely error pages)
        if (bodyText.length < 500 && (
          bodyText.includes('error') ||
          bodyText.includes('denied') ||
          bodyText.includes('forbidden')
        )) {
          return { isBlocked: true, reason: 'Suspiciously short error page' };
        }

        // Check for challenge iframes
        if (bodyHtml.includes('challenge-form') || bodyHtml.includes('challenge-running')) {
          return { isBlocked: true, reason: 'Challenge form detected' };
        }

        return { isBlocked: false, reason: '' };
      });

      return blockInfo;
    } catch (error) {
      // If evaluation fails, assume not blocked
      return { isBlocked: false, reason: '' };
    }
  }

  /**
   * Get archive path for a source
   * OPT-110: CORRECTED per CLAUDE.md requirement
   * Path: [archive]/locations/[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/org-doc-[LOC12]/_websources/[domain]-[source_id]/
   */
  private async getArchivePath(source: WebSource): Promise<string> {
    if (!this.archiveBasePath) {
      const result = await this.db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();
      this.archiveBasePath = result?.value || null;
    }

    if (!this.archiveBasePath) {
      throw new Error('Archive location not set');
    }

    let archivePath: string;

    if (source.locid) {
      // ADR-046: Look up location data for folder naming
      const location = await this.db
        .selectFrom('locs')
        .select(['locid', 'locnam', 'category', 'address_state'])
        .where('locid', '=', source.locid)
        .executeTakeFirst();

      if (!location) {
        throw new Error(`Location not found: ${source.locid}`);
      }

      // ADR-046: New folder path format
      // [base]/locations/[STATE]/[LOCID]/data/org-doc/_websources/[domain]-[source_id]/
      const state = (location.address_state || 'XX').toUpperCase();
      const locid = source.locid;

      // Extract domain for human-readable folder naming
      const domain = this.extractDomain(source.url);

      archivePath = path.join(
        this.archiveBasePath,
        'locations',
        state,
        locid,
        'data',
        'org-doc',
        '_websources',
        `${domain}-${source.source_id}`
      );
    } else {
      // Unlinked sources go to a shared folder
      archivePath = path.join(this.archiveBasePath, '_websources', source.source_id);
    }

    return archivePath;
  }

  /**
   * Extract domain from URL for folder naming
   * OPT-110: Human-readable folder names
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Sanitize string for folder name
   * OPT-110: Matches BagItService pattern for consistency
   */
  private sanitizeFolderName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }

  /**
   * Generate short name from location name
   * OPT-110: Matches BagItService pattern for consistency
   */
  private generateShortName(locnam: string): string {
    const words = locnam.split(/\s+/).slice(0, 3);
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('-');
  }

  /**
   * Link extracted media to location in database
   */
  private async linkExtractedMedia(
    locid: string,
    subid: string | null,
    sourceId: string,
    images: ExtractedImage[],
    _videos: ExtractedVideo[]
  ): Promise<void> {
    // Insert extracted images into imgs table with source tracking
    for (const image of images) {
      try {
        const imgnam = path.basename(image.localPath);
        await this.db
          .insertInto('imgs')
          .values({
            // Required fields
            imghash: image.hash,
            imgnam,
            imgnamo: imgnam,
            imgloc: image.localPath,
            imgloco: image.url,
            // Location linkage
            locid,
            subid,
            // OPT-109 web source tracking
            source_id: sourceId,
            source_url: image.url,
            extracted_from_web: 1,
            // Metadata
            meta_width: image.width,
            meta_height: image.height,
            file_size_bytes: image.size,
            // Defaults for required fields
            hidden: 0,
            is_live_photo: 0,
            preview_extracted: 0,
            xmp_synced: 0,
            is_contributed: 0,
            // Nullable fields
            auth_imp: null,
            imgadd: null,
            meta_exiftool: null,
            meta_date_taken: null,
            meta_camera_make: null,
            meta_camera_model: null,
            meta_gps_lat: null,
            meta_gps_lng: null,
            thumb_path: null,
            preview_path: null,
            thumb_path_sm: null,
            thumb_path_lg: null,
            xmp_modified_at: null,
            hidden_reason: null,
            imported_by_id: null,
            imported_by: null,
            media_source: 'Web Archive',
            contribution_source: null,
            preview_quality: null,
          })
          .onConflict((oc) => oc.column('imghash').doNothing())
          .execute();
      } catch (err) {
        console.error(`Failed to link image ${image.hash}:`, err);
      }
    }

    // Videos are typically not imported directly but stored in web source archive
    // They can be imported via the regular import flow if user chooses
  }

  /**
   * Calculate provenance hash from component hashes
   */
  private calculateProvenanceHash(hashes: {
    screenshotHash: string | null;
    pdfHash: string | null;
    htmlHash: string | null;
    warcHash: string | null;
    contentHash: string | null;
  }): string {
    // Concatenate all hashes that exist
    const combined = [
      hashes.screenshotHash,
      hashes.pdfHash,
      hashes.htmlHash,
      hashes.warcHash,
      hashes.contentHash,
    ]
      .filter(Boolean)
      .join('|');

    return calculateHashBuffer(Buffer.from(combined, 'utf-8'));
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    sourceId: string,
    url: string,
    phase: ArchiveProgress['phase'],
    component: string | undefined,
    progress: number,
    message: string
  ): void {
    this.emit('progress', {
      sourceId,
      url,
      phase,
      component,
      progress,
      message,
    } as ArchiveProgress);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let orchestratorInstance: WebSourceOrchestrator | null = null;

/**
 * Get or create the orchestrator instance
 */
export function getOrchestrator(db: Kysely<Database>): WebSourceOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new WebSourceOrchestrator(db);
  }
  return orchestratorInstance;
}

/**
 * Shutdown the orchestrator
 */
export async function shutdownOrchestrator(): Promise<void> {
  if (orchestratorInstance) {
    await orchestratorInstance.cancel();
    orchestratorInstance = null;
  }
  await closeBrowser();
}
