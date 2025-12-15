/**
 * Image Downloader Module
 *
 * Intelligent image downloading system for Abandoned Archive.
 * Features:
 * - URL pattern transformation (WordPress, CDNs, image hosts)
 * - Perceptual hashing for duplicate detection
 * - Staging area for candidate comparison
 * - Integration with existing import pipeline
 *
 * @module services/image-downloader
 */

// Perceptual hashing
export {
  PerceptualHashService,
  perceptualHashService,
  calculatePHash,
  calculatePHashBuffer,
  pHashDistance,
  arePHashSimilar,
  type PHashResult,
  type SimilarImage,
} from './perceptual-hash-service';

// URL pattern transformation
export {
  UrlPatternTransformer,
  createUrlPatternTransformer,
  urlPatternTransformer,
  type UrlPattern,
  type TransformResult,
  type SiteType,
} from './url-pattern-transformer';

// URL validation
export {
  validateImageUrl,
  validateImageUrls,
  findBestUrl,
  compareByQuality,
  getFormatFromContentType,
  getFilenameFromUrl,
  isLikelyThumbnail,
  type UrlValidation,
  type ValidatedCandidate,
} from './url-validator';

// Download staging
export {
  DownloadStagingService,
  createDownloadStagingService,
  type StagedImage,
  type ComparisonGroup,
  type StagingStats,
} from './download-staging-service';

// Main orchestrator
export {
  DownloadOrchestrator,
  createDownloadOrchestrator,
  type DiscoveredImage,
  type ProcessedImage,
  type ProcessPageResult,
  type ProcessPageOptions,
  type SourceRecord,
} from './download-orchestrator';

// Backfill job
export { backfillPerceptualHashes, type BackfillResult } from './phash-backfill-job';
