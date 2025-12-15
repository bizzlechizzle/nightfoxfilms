// Database table type definitions for Kysely
import type { Generated } from 'kysely';

export interface Database {
  locs: LocsTable;
  slocs: SlocsTable;
  imgs: ImgsTable;
  vids: VidsTable;
  docs: DocsTable;
  maps: MapsTable;
  settings: SettingsTable;
  imports: ImportsTable;
  notes: NotesTable;
  projects: ProjectsTable;
  project_locations: ProjectLocationsTable;
  users: UsersTable;
  location_authors: LocationAuthorsTable;
  location_views: LocationViewsTable;
  video_proxies: VideoProxiesTable;
  ref_maps: RefMapsTable;
  ref_map_points: RefMapPointsTable;
  location_exclusions: LocationExclusionsTable;
  sidecar_imports: SidecarImportsTable;
  // Migration 49: Import System v2.0
  jobs: JobsTable;
  import_sessions: ImportSessionsTable;
  job_dead_letter: JobDeadLetterTable;
  // Migration 51: Monitoring & Audit System
  metrics: MetricsTable;
  traces: TracesTable;
  job_audit_log: JobAuditLogTable;
  import_audit_log: ImportAuditLogTable;
  alert_history: AlertHistoryTable;
  health_snapshots: HealthSnapshotsTable;
  // Migration 57-60: OPT-109 Web Sources Archiving
  web_sources: WebSourcesTable;
  web_source_versions: WebSourceVersionsTable;
  // Migration 66: OPT-111 Enhanced Web Source Metadata
  web_source_images: WebSourceImagesTable;
  web_source_videos: WebSourceVideosTable;
  // Migration 69: Timeline events
  location_timeline: LocationTimelineTable;
  // Migration 73: Date Engine - NLP date extraction
  date_extractions: DateExtractionsTable;
  date_engine_learning: DateEngineLearningTable;
  date_patterns: DatePatternsTable;
  // Migration 74: Document Intelligence
  extraction_providers: ExtractionProvidersTable;
  entity_extractions: EntityExtractionsTable;
  document_summaries: DocumentSummariesTable;
  // Migration 75: Extraction Pipeline
  extraction_queue: ExtractionQueueTable;
  // Migration 76: RAM++ Image Auto-Tagging
  location_tag_summary: LocationTagSummaryTable;
  image_tagging_queue: ImageTaggingQueueTable;
  // Migration 84: Extracted Addresses (LLM Tools Overhaul)
  extracted_addresses: ExtractedAddressesTable;
}

// Locations table
export interface LocsTable {
  // Identity (BLAKE3 16-char hash - ADR-046)
  locid: string;

  // Basic Info
  locnam: string;
  slocnam: string | null;
  akanam: string | null;

  // Classification
  category: string | null;
  class: string | null;

  // GPS (Primary Source of Truth)
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  gps_source: string | null;
  gps_verified_on_map: number;
  gps_captured_at: string | null;
  gps_leaflet_data: string | null;
  // Kanye9: Track cascade geocoding tier for accurate zoom levels
  gps_geocode_tier: number | null;     // 1-5 (1=full address, 5=state only)
  gps_geocode_query: string | null;    // The query that succeeded

  // Address (Secondary, Optional)
  address_street: string | null;
  address_city: string | null;
  address_county: string | null;
  address_state: string | null;
  address_zipcode: string | null;
  address_confidence: string | null;
  address_geocoded_at: string | null;

  // Address Normalization (Kanye9: Raw + Normalized storage)
  address_raw: string | null;           // Original input exactly as entered
  address_normalized: string | null;    // Formatted normalized string
  address_parsed_json: string | null;   // JSON of parsed components
  address_source: string | null;        // 'libpostal' | 'fallback' | 'nominatim' | 'manual'

  // Address Verification (DECISION-010: Verification tracking)
  address_verified: number;             // 0/1 - User confirmed address is correct
  address_verified_at: string | null;   // ISO timestamp when verified
  address_verified_by: string | null;   // 'user' (future: 'api', 'import')

  // GPS Verification Metadata (DECISION-010: gps_verified_on_map already exists)
  gps_verified_at: string | null;       // ISO timestamp when verified
  gps_verified_by: string | null;       // 'user' (future: 'api', 'import')

  // Location-level Verification (DECISION-010: Computed when BOTH address AND GPS verified)
  location_verified: number;            // 0/1 - Set when both address_verified AND gps_verified_on_map are 1
  location_verified_at: string | null;  // ISO timestamp when both became verified

  // Cultural Region (DECISION-011: User-entered, subjective, does NOT count toward Location ✓)
  cultural_region: string | null;

  // Census Regions (DECISION-012: Auto-populated from state/GPS, offline-first)
  census_region: string | null;     // Northeast, Midwest, South, West
  census_division: string | null;   // New England, Middle Atlantic, etc. (9 divisions)
  state_direction: string | null;   // e.g., "Eastern NY", "Central TX"

  // DECISION-017: Country Cultural Region and geographic hierarchy
  country_cultural_region: string | null;           // 50 national-level regions (NYC Metro, Cascadia, etc.)
  country_cultural_region_verified: number;         // 0/1 - User verified the country cultural region
  local_cultural_region_verified: number;           // 0/1 - User verified the local cultural region
  country: string | null;                           // Default: "United States"
  continent: string | null;                         // Default: "North America"

  // Status
  condition: string | null;
  status: string | null;
  documentation: string | null;
  access: string | null;
  historic: number;
  favorite: number;

  // DECISION-013: Information box fields
  built_year: string | null;       // Text storage for year, range, or date
  built_type: string | null;       // 'year', 'range', 'date' for UI formatting
  abandoned_year: string | null;
  abandoned_type: string | null;
  project: number;                 // 0/1 boolean for project membership
  doc_interior: number;            // 0/1 Documentation checkboxes
  doc_exterior: number;
  doc_drone: number;
  doc_web_history: number;
  doc_map_find: number;            // 0/1 Map Find documentation checkbox

  // Status tracking
  status_changed_at: string | null; // ISO timestamp when status last changed

  // DECISION-019: Information Box overhaul fields
  historical_name: string | null;  // Historical/original name of location
  locnam_verified: number;         // 0/1 - User verified location name is correct
  historical_name_verified: number; // 0/1 - User verified historical name is correct
  akanam_verified: number;         // 0/1 - User verified AKA name is correct

  // Hero Image (Kanye6: User-selected featured image for card thumbnails)
  hero_imghash: string | null;
  hero_focal_x: number;           // 0-1 horizontal position (0.5 = center)
  hero_focal_y: number;           // 0-1 vertical position (0.5 = center)

  // Relationships
  sublocs: string | null;
  is_host_only: number;  // 0/1 - Location is a host/campus expecting sub-locations (OPT-062)

  // Metadata
  locadd: string | null;
  locup: string | null;
  auth_imp: string | null;

  // Activity Tracking (Migration 25)
  created_by_id: string | null;    // User ID who created the location
  created_by: string | null;       // Username for display
  modified_by_id: string | null;   // User ID who last modified
  modified_by: string | null;      // Username for display
  modified_at: string | null;      // ISO timestamp of last modification

  // View tracking (Migration 33)
  view_count: number;              // Number of times location has been viewed
  last_viewed_at: string | null;   // ISO timestamp of last view

  // BagIt Archive (Migration 40) - Self-documenting archive per RFC 8493
  bag_status: string | null;       // 'none' | 'valid' | 'complete' | 'incomplete' | 'invalid'
  bag_last_verified: string | null; // ISO timestamp of last integrity check
  bag_last_error: string | null;   // Error message if validation failed

  // Regions
  regions: string | null;
  state: string | null;

  // Media Stats (Migration 55) - Cached counts from location-stats job
  img_count: number;
  vid_count: number;
  doc_count: number;
  map_count: number;
  total_size_bytes: number;
  earliest_media_date: string | null;
  latest_media_date: string | null;
  stats_updated_at: string | null;

  // Migration 75: Auto-tagging for extraction pipeline
  location_type: string | null;  // golf-course, factory, hospital, etc.
  era: string | null;           // pre-1900, 1900-1930, etc.
}

// Sub-Locations table
export interface SlocsTable {
  // Identity (BLAKE3 16-char hash - ADR-046)
  subid: string;
  locid: string;

  subnam: string;
  ssubname: string | null;

  // Migration 28: Enhanced sub-location fields
  category: string | null;
  // Migration 65: Sub-location class (separate taxonomy from host locations)
  class: string | null;
  status: string | null;
  hero_imghash: string | null;
  hero_focal_x: number;           // 0-1 horizontal position (0.5 = center)
  hero_focal_y: number;           // 0-1 vertical position (0.5 = center)
  is_primary: number;  // 0 or 1

  // Activity tracking
  created_date: string | null;
  created_by: string | null;
  modified_date: string | null;
  modified_by: string | null;

  // Migration 31: Sub-location GPS (separate from host location)
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  gps_source: string | null;
  gps_verified_on_map: number;  // 0 or 1
  gps_captured_at: string | null;

  // Migration 32: AKA name (historicalName removed)
  akanam: string | null;

  // Migration 56 (OPT-093): Sub-location stats
  img_count: number;
  vid_count: number;
  doc_count: number;
  map_count: number;
  total_size_bytes: number;
  earliest_media_date: string | null;
  latest_media_date: string | null;
  stats_updated_at: string | null;

  // Migration 56 (OPT-093): Sub-location BagIt
  bag_status: string | null;
  bag_last_verified: string | null;
  bag_last_error: string | null;
}

// Images table
export interface ImgsTable {
  imghash: string;
  imgnam: string;
  imgnamo: string;
  imgloc: string;
  imgloco: string;

  locid: string | null;
  subid: string | null;

  auth_imp: string | null;
  imgadd: string | null;

  meta_exiftool: string | null;

  // Extracted metadata
  meta_width: number | null;
  meta_height: number | null;
  meta_date_taken: string | null;
  meta_camera_make: string | null;
  meta_camera_model: string | null;
  meta_gps_lat: number | null;
  meta_gps_lng: number | null;

  // Thumbnails and previews (Migration 8)
  thumb_path: string | null;
  preview_path: string | null;
  preview_extracted: number;

  // Multi-tier thumbnails (Migration 9 - Premium Archive)
  thumb_path_sm: string | null;  // 400px - grid view (1x)
  thumb_path_lg: string | null;  // 800px - grid view (2x HiDPI)

  // XMP sync status (Migration 8)
  xmp_synced: number;
  xmp_modified_at: string | null;

  // Hidden/Live Photo fields (Migration 23)
  hidden: number;
  hidden_reason: string | null;
  is_live_photo: number;

  // Activity Tracking (Migration 25)
  imported_by_id: string | null;   // User ID who imported this media
  imported_by: string | null;      // Username for display
  media_source: string | null;     // e.g., "Personal camera", "Facebook archive", "Web archive"

  // Contributor Tracking (Migration 26)
  is_contributed: number;          // 0 = author shot it, 1 = contributor
  contribution_source: string | null; // e.g., "John Smith via text", "FB group"

  // Migration 30: Preview quality tracking for RAW files
  preview_quality: string | null;  // 'full' | 'embedded' | 'low'

  // Migration 44 (OPT-047): File size tracking for archive size queries
  file_size_bytes: number | null;

  // NOTE: darktable columns exist in DB but are deprecated/unused
  // darktable_path, darktable_processed, darktable_processed_at - REMOVED from app

  // Migration 59 (OPT-109): Web source extraction tracking
  source_id: string | null;        // FK to web_sources - which web source this was extracted from
  source_url: string | null;       // Original URL where this image was found
  extracted_from_web: number;      // 0/1 - Was this extracted from a web source?

  // Migration 72: Perceptual hash for duplicate detection
  phash: string | null;            // 16-char hex DCT perceptual hash

  // Migration 76: RAM++ Image Auto-Tagging
  auto_tags: string | null;              // JSON array: ["abandoned", "factory", "graffiti"]
  auto_tags_source: string | null;       // 'ram++' | 'florence' | 'manual' | 'hybrid'
  auto_tags_confidence: string | null;   // JSON: {"abandoned": 0.95, "factory": 0.87}
  auto_tags_at: string | null;           // ISO timestamp when tags were generated
  quality_score: number | null;          // 0-1 quality score for hero selection
  view_type: string | null;              // 'interior' | 'exterior' | 'aerial' | 'detail'

  // Migration 89: VLM Enhancement (Stage 2 deep analysis)
  vlm_description: string | null;        // Rich natural language description
  vlm_caption: string | null;            // Short caption for alt text
  vlm_architectural_style: string | null;// Art Deco, Mid-Century Modern, etc.
  vlm_period_json: string | null;        // JSON: {start, end, confidence, reasoning}
  vlm_condition_json: string | null;     // JSON: {overall, score, details, observations}
  vlm_features_json: string | null;      // JSON array of notable features
  vlm_keywords_json: string | null;      // JSON array of search keywords
  vlm_model: string | null;              // Model used (qwen3-vl, llava, etc.)
  vlm_enhanced_at: string | null;        // ISO timestamp of enhancement
}

// Videos table
export interface VidsTable {
  vidhash: string;
  vidnam: string;
  vidnamo: string;
  vidloc: string;
  vidloco: string;

  locid: string | null;
  subid: string | null;

  auth_imp: string | null;
  vidadd: string | null;

  meta_ffmpeg: string | null;
  meta_exiftool: string | null;

  // Extracted metadata
  meta_duration: number | null;
  meta_width: number | null;
  meta_height: number | null;
  meta_codec: string | null;
  meta_fps: number | null;
  meta_date_taken: string | null;
  // FIX 3.2: GPS from video metadata (dashcams, phones)
  meta_gps_lat: number | null;
  meta_gps_lng: number | null;

  // Poster frames (Migration 8)
  thumb_path: string | null;
  poster_extracted: number;

  // Multi-tier thumbnails (Migration 9 - Premium Archive)
  thumb_path_sm: string | null;  // 400px - grid view (1x)
  thumb_path_lg: string | null;  // 800px - grid view (2x HiDPI)
  preview_path: string | null;   // 1920px - lightbox

  // XMP sync status (Migration 8)
  xmp_synced: number;
  xmp_modified_at: string | null;

  // Hidden/Live Photo fields (Migration 23)
  hidden: number;
  hidden_reason: string | null;
  is_live_photo: number;

  // Activity Tracking (Migration 25)
  imported_by_id: string | null;   // User ID who imported this media
  imported_by: string | null;      // Username for display
  media_source: string | null;     // e.g., "Personal camera", "Facebook archive", "Web archive"

  // Contributor Tracking (Migration 26)
  is_contributed: number;          // 0 = author shot it, 1 = contributor
  contribution_source: string | null; // e.g., "John Smith via text", "FB group"

  // Migration 44 (OPT-047): File size tracking for archive size queries
  file_size_bytes: number | null;

  // Migration 46 (OPT-055): DJI SRT telemetry data
  // JSON summary of parsed telemetry from matching SRT file
  // Contains: frames, duration_sec, gps_bounds, altitude_range, speed_max_ms
  srt_telemetry: string | null;

  // Migration 59 (OPT-109): Web source extraction tracking
  source_id: string | null;        // FK to web_sources - which web source this was extracted from
  source_url: string | null;       // Original URL where this video was found
  extracted_from_web: number;      // 0/1 - Was this extracted from a web source?
}

// Documents table
export interface DocsTable {
  dochash: string;
  docnam: string;
  docnamo: string;
  docloc: string;
  docloco: string;

  locid: string | null;
  subid: string | null;

  auth_imp: string | null;
  docadd: string | null;

  meta_exiftool: string | null;

  // Document-specific metadata
  meta_page_count: number | null;
  meta_author: string | null;
  meta_title: string | null;

  // Hidden fields (Migration 23)
  hidden: number;
  hidden_reason: string | null;

  // Activity Tracking (Migration 25)
  imported_by_id: string | null;   // User ID who imported this media
  imported_by: string | null;      // Username for display
  media_source: string | null;     // e.g., "Personal camera", "Facebook archive", "Web archive"

  // Contributor Tracking (Migration 27)
  is_contributed: number;          // 0 = author shot it, 1 = contributor
  contribution_source: string | null; // e.g., "John Smith via text", "FB group"

  // Migration 44 (OPT-047): File size tracking for archive size queries
  file_size_bytes: number | null;
}

// Maps table
export interface MapsTable {
  maphash: string;
  mapnam: string;
  mapnamo: string;
  maploc: string;
  maploco: string;

  locid: string | null;
  subid: string | null;

  auth_imp: string | null;
  mapadd: string | null;

  meta_exiftool: string | null;
  meta_map: string | null;
  // FIX 3.4: GPS from parsed GPX/KML files
  meta_gps_lat: number | null;
  meta_gps_lng: number | null;

  reference: string | null;
  map_states: string | null;
  map_verified: number;

  // Multi-tier thumbnails (Migration 9 - Premium Archive)
  thumb_path_sm: string | null;  // 400px - grid view (1x)
  thumb_path_lg: string | null;  // 800px - grid view (2x HiDPI)
  preview_path: string | null;   // 1920px - lightbox

  // Activity Tracking (Migration 25)
  imported_by_id: string | null;   // User ID who imported this media
  imported_by: string | null;      // Username for display
  media_source: string | null;     // e.g., "Personal camera", "Facebook archive", "Web archive"

  // Migration 44 (OPT-047): File size tracking for archive size queries
  file_size_bytes: number | null;
}

// Settings table
export interface SettingsTable {
  key: string;
  value: string;
}

// Imports table
export interface ImportsTable {
  import_id: string;
  locid: string | null;
  import_date: string;
  auth_imp: string | null;
  img_count: number;
  vid_count: number;
  doc_count: number;
  map_count: number;
  notes: string | null;
}

// Notes table
export interface NotesTable {
  note_id: string;
  locid: string;
  note_text: string;
  note_date: string;
  auth_imp: string | null;
  note_type: string;
}

// Projects table
export interface ProjectsTable {
  project_id: string;
  project_name: string;
  description: string | null;
  created_date: string;
  auth_imp: string | null;
}

// Project Locations junction table
export interface ProjectLocationsTable {
  project_id: string;
  locid: string;
  added_date: string;
}

// Users table
export interface UsersTable {
  user_id: string;
  username: string;
  display_name: string | null;
  created_date: string;
  // Authentication (Migration 24)
  pin_hash: string | null;
  is_active: number;
  last_login: string | null;
}

// Location Authors junction table (Migration 25)
export interface LocationAuthorsTable {
  locid: string;
  user_id: string;
  role: string;      // 'creator', 'documenter', 'contributor'
  added_at: string;  // ISO timestamp
}

// Location Views table (Migration 34) - Per-user view tracking
export interface LocationViewsTable {
  view_id: string;
  locid: string;
  user_id: string;
  viewed_at: string;  // ISO timestamp
}

// Video Proxies table (Migration 36, updated Migration 45 OPT-053)
// Per OPT-053 Immich Model: Proxies generated at import, stored alongside originals, never purged
export interface VideoProxiesTable {
  vidhash: string;           // Primary key, matches vids table
  proxy_path: string;       // Path to proxy file (alongside original: .{hash}.proxy.mp4)
  generated_at: string;     // ISO timestamp when proxy was created
  last_accessed: string;    // DEPRECATED (OPT-053): No longer used, proxies are permanent
  file_size_bytes: number | null;
  original_width: number | null;
  original_height: number | null;
  proxy_width: number | null;
  proxy_height: number | null;
  proxy_version: number | null;  // Migration 45: Track proxy encoding version for re-encode
}

// Migration 37: Reference Maps - User-imported map files
export interface RefMapsTable {
  map_id: string;
  map_name: string;
  file_path: string;
  file_type: string;        // kml, kmz, gpx, geojson, csv, shp
  point_count: number;
  imported_at: string;
  imported_by: string | null;
}

// Migration 37: Reference Map Points - Extracted from imported maps
export interface RefMapPointsTable {
  point_id: string;
  map_id: string;
  name: string | null;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  raw_metadata: string | null;  // JSON blob
  // Migration 39: AKA names from merged duplicate pins
  aka_names: string | null;     // Pipe-separated alternate names
  // Migration 42: Link to location when GPS is applied (enrichment)
  linked_locid: string | null;  // Location that received GPS from this ref point
  linked_at: string | null;     // ISO timestamp when link was created
}

// Migration 38: Location Exclusions - "Different place" decisions
// ADR: ADR-pin-conversion-duplicate-prevention.md
// Stores user decisions that two names refer to different places
export interface LocationExclusionsTable {
  exclusion_id: string;
  name_a: string;
  name_b: string;
  decided_at: string;
  decided_by: string | null;
}

// Migration 41: Sidecar Imports - Metadata-only imports from XML sidecars
// When a media file has a matching .xml sidecar, we can import just the metadata
// without bringing the actual media file into the archive
export interface SidecarImportsTable {
  sidecar_id: string;
  original_filename: string;    // e.g., "IMG_1234.jpg"
  original_path: string;        // Full path to original media file
  xml_filename: string;         // e.g., "IMG_1234.xml"
  xml_path: string;             // Full path to XML sidecar file
  xml_content: string | null;   // Raw XML content
  parsed_metadata: string | null; // Parsed JSON metadata
  media_type: string | null;    // 'image', 'video', etc.
  import_date: string;          // ISO timestamp
  imported_by: string | null;   // Username for display
  imported_by_id: string | null; // User ID reference
  locid: string | null;         // Location reference
  subid: string | null;         // Sub-location reference
}

// Migration 49: Jobs table - SQLite-backed priority queue
// Per Import Spec v2.0: Priority queue with dependency support
export interface JobsTable {
  job_id: string;
  queue: string;               // Queue name: 'exiftool', 'thumbnail', 'proxy', etc.
  priority: number;            // Higher = more important (default: 10)
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  payload: string;             // JSON serialized job data
  depends_on: string | null;   // job_id this job depends on
  attempts: number;            // Number of attempts so far
  max_attempts: number;        // Maximum retry attempts (default: 3)
  error: string | null;        // Error message if failed
  result: string | null;       // JSON serialized result if completed
  created_at: string;          // ISO timestamp
  started_at: string | null;   // ISO timestamp when processing started
  completed_at: string | null; // ISO timestamp when completed/failed
  locked_by: string | null;    // Worker ID that locked this job
  locked_at: string | null;    // ISO timestamp when locked
  // Migration 50: Exponential backoff support
  retry_after: string | null;  // ISO timestamp - don't retry before this time
  last_error: string | null;   // Last error message (preserved across retries)
}

// Migration 49: Import Sessions table - Track import state for resumption
export interface ImportSessionsTable {
  session_id: string;
  locid: string;
  status: 'pending' | 'scanning' | 'hashing' | 'copying' | 'validating' | 'finalizing' | 'completed' | 'cancelled' | 'failed';
  source_paths: string;        // JSON array of source paths
  copy_strategy: string | null; // 'copy' only (OPT-082: pure copy)
  total_files: number;
  processed_files: number;
  duplicate_files: number;
  error_files: number;
  total_bytes: number;
  processed_bytes: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  can_resume: number;          // 0/1 - Whether this session can be resumed
  last_step: number;           // Last completed step (1-5)
  // Migration 50: Result storage for proper resume
  scan_result: string | null;        // JSON: ScanResult from step 1
  hash_results: string | null;       // JSON: HashResult[] from step 2
  copy_results: string | null;       // JSON: CopyResult[] from step 3
  validation_results: string | null; // JSON: ValidationResult[] from step 4
}

// Migration 49: Dead Letter Queue - Failed jobs for analysis
export interface JobDeadLetterTable {
  id: Generated<number>;       // Auto-increment primary key
  job_id: string;
  queue: string;
  payload: string;
  error: string | null;
  attempts: number;
  failed_at: string;
  acknowledged: number;        // 0/1 - Whether admin has acknowledged this failure
}

// Migration 51: Monitoring & Audit System Tables

// Metrics table - Time-series performance data
export interface MetricsTable {
  id: Generated<number>;
  name: string;
  value: number;
  timestamp: number;
  type: 'counter' | 'gauge' | 'histogram';
  tags: string | null;         // JSON tags
}

// Traces table - Distributed tracing spans
export interface TracesTable {
  span_id: string;             // Primary key
  trace_id: string;
  parent_span_id: string | null;
  operation: string;
  start_time: number;
  end_time: number | null;
  duration: number | null;
  status: 'running' | 'success' | 'error';
  tags: string | null;         // JSON tags
  logs: string | null;         // JSON array of log entries
}

// Job Audit Log - Execution history for each job
export interface JobAuditLogTable {
  id: Generated<number>;
  job_id: string;
  queue: string;
  asset_hash: string | null;
  location_id: string | null;
  started_at: number;
  completed_at: number | null;
  duration: number | null;
  status: 'started' | 'success' | 'error' | 'timeout';
  attempt: number;
  error_message: string | null;
  result: string | null;       // JSON result
}

// Import Audit Log - Enhanced import session tracking
export interface ImportAuditLogTable {
  id: Generated<number>;
  session_id: string;
  timestamp: number;
  step: string;
  status: 'started' | 'progress' | 'completed' | 'error';
  message: string | null;
  context: string | null;      // JSON context
}

// Alert History - Fired alerts
export interface AlertHistoryTable {
  id: Generated<number>;
  alert_id: string;
  name: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
  context: string | null;      // JSON context
  acknowledged: number;        // 0/1
  acknowledged_at: number | null;
  acknowledged_by: string | null;
}

// Health Snapshots - Periodic health state
export interface HealthSnapshotsTable {
  id: Generated<number>;
  timestamp: number;
  status: 'healthy' | 'warning' | 'critical';
  checks: string;              // JSON health checks
  recommendations: string | null; // JSON recommendations
}

// Migration 57-60: OPT-109 Web Sources Archiving

// Web Sources table - URL references for location research
export interface WebSourcesTable {
  source_id: string;           // BLAKE3 hash of URL
  url: string;                 // Original URL
  title: string | null;        // User-entered or extracted title
  locid: string | null;        // Parent location
  subid: string | null;        // Optional sub-location
  source_type: string;         // 'article', 'gallery', 'video', 'social', 'map', 'document', 'archive', 'other'
  notes: string | null;        // User notes about this source

  // Archive Status
  status: 'pending' | 'archiving' | 'complete' | 'partial' | 'failed';
  component_status: string | null; // JSON: { screenshot: 'done', pdf: 'pending', ... }

  // Extracted Metadata
  extracted_title: string | null;
  extracted_author: string | null;
  extracted_date: string | null;
  extracted_publisher: string | null;
  extracted_text: string | null;     // Full text content for FTS
  word_count: number;
  image_count: number;
  video_count: number;

  // Archive Paths (relative to location archive folder)
  archive_path: string | null;      // Root archive folder for this source
  screenshot_path: string | null;   // Screenshot PNG
  pdf_path: string | null;          // PDF capture
  html_path: string | null;         // Single-file HTML
  warc_path: string | null;         // WARC archive

  // Integrity Hashes (BLAKE3)
  screenshot_hash: string | null;
  pdf_hash: string | null;
  html_hash: string | null;
  warc_hash: string | null;
  content_hash: string | null;      // Hash of extracted text content
  provenance_hash: string | null;   // Hash of all hashes for tamper detection

  // Error Handling
  archive_error: string | null;     // Last error message
  retry_count: number;              // Number of archive attempts

  // Timestamps
  created_at: string;               // ISO timestamp
  archived_at: string | null;       // ISO timestamp when archiving completed
  auth_imp: string | null;          // User who added this source

  // OPT-111: Enhanced page-level metadata (Migration 66)
  domain: string | null;              // Extracted domain from URL
  extracted_links: string | null;     // JSON array of {url, text, rel} objects
  page_metadata_json: string | null;  // Full OpenGraph, Schema.org, meta tags
  http_headers_json: string | null;   // HTTP response headers
  canonical_url: string | null;       // Canonical URL from link tag
  language: string | null;            // Page language from html lang attribute
  favicon_path: string | null;        // Path to downloaded favicon

  // OPT-115: Enhanced capture tracking (Migration 71)
  capture_method: string | null;            // 'extension' | 'puppeteer' | 'hybrid'
  extension_captured_at: string | null;     // ISO timestamp of extension capture
  puppeteer_captured_at: string | null;     // ISO timestamp of puppeteer capture
  extension_screenshot_path: string | null; // Screenshot from extension (immediate)
  extension_html_path: string | null;       // HTML from extension (immediate)

  // Structured metadata for queryability (Migration 71)
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  twitter_card_json: string | null;
  schema_org_json: string | null;
  http_status: number | null;

  // Migration 73: Date extraction tracking
  dates_extracted_at: string | null;
  dates_extraction_count: number;

  // Migration 75: Extraction Pipeline - Smart titles and summaries
  smart_title: string | null;              // LLM-generated clean title (max 60 chars)
  smart_summary: string | null;            // LLM-generated 2-sentence TL;DR
  extraction_status: string | null;        // 'pending' | 'processing' | 'completed' | 'failed'
  extraction_confidence: number | null;    // 0-1 overall extraction confidence
  extraction_provider: string | null;      // Provider ID that performed extraction
  extraction_model: string | null;         // Model name/version used
  extraction_completed_at: string | null;  // ISO timestamp when extraction completed
}

// Web Source Versions table - Track changes over time
export interface WebSourceVersionsTable {
  version_id: string;          // UUID
  source_id: string;           // FK to web_sources
  version_number: number;      // Sequential version number
  archived_at: string;         // ISO timestamp

  // Archive path for this version (required)
  archive_path: string | null;

  // Snapshot paths for this version (optional, added by migration 62)
  screenshot_path: string | null;
  pdf_path: string | null;
  html_path: string | null;
  warc_path: string | null;

  // Stats for this version
  word_count: number | null;
  image_count: number | null;
  video_count: number | null;

  // Hashes for this version
  screenshot_hash: string | null;
  pdf_hash: string | null;
  html_hash: string | null;
  warc_hash: string | null;
  content_hash: string | null;

  // Diff tracking (added by migration 62)
  content_changed: number;     // 0/1 - Did content change from previous version?
  diff_summary: string | null; // Human-readable summary of changes
}

// OPT-111: Web Source Images table - Per-image metadata from archived pages (Migration 66)
export interface WebSourceImagesTable {
  id: Generated<number>;
  source_id: string;
  image_index: number;

  // Location
  url: string;
  local_path: string | null;
  hash: string | null;

  // Dimensions
  width: number | null;
  height: number | null;
  size: number | null;

  // Metadata from page
  original_filename: string | null;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  attribution: string | null;
  srcset_variants: string | null;  // JSON array
  context_html: string | null;
  link_url: string | null;

  // EXIF from downloaded file
  exif_json: string | null;

  // Flags
  is_hi_res: number;
  is_hero: number;

  created_at: Generated<string>;
}

// OPT-111: Web Source Videos table - Per-video metadata from archived pages (Migration 66)
export interface WebSourceVideosTable {
  id: Generated<number>;
  source_id: string;
  video_index: number;

  // Location
  url: string;
  local_path: string | null;
  hash: string | null;

  // Basic info
  title: string | null;
  description: string | null;
  duration: number | null;
  size: number | null;
  platform: string | null;

  // Source info
  uploader: string | null;
  uploader_url: string | null;
  upload_date: string | null;
  view_count: number | null;
  like_count: number | null;

  // Extended metadata
  tags: string | null;       // JSON array
  categories: string | null; // JSON array
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  metadata_json: string | null;

  created_at: Generated<string>;
}

// Migration 69: Timeline events table
export interface LocationTimelineTable {
  event_id: string;
  locid: string;
  subid: string | null;

  // Event type
  event_type: string;        // 'established' | 'visit' | 'database_entry' | 'custom'
  event_subtype: string | null; // For established: 'built'|'opened'|'expanded'|'renovated'|'closed'|'abandoned'|'demolished'

  // Date information (flexible precision)
  date_start: string | null;
  date_end: string | null;
  date_precision: string;    // 'exact'|'month'|'year'|'decade'|'century'|'circa'|'range'|'before'|'after'|'early'|'mid'|'late'|'unknown'
  date_display: string | null;
  date_edtf: string | null;
  date_sort: number | null;

  // Override for wrong EXIF dates
  date_override: string | null;
  override_reason: string | null;

  // Source tracking
  source_type: string | null; // 'exif' | 'manual' | 'web' | 'document' | 'system'
  source_ref: string | null;  // imghash/vidhash for EXIF, URL for web
  source_device: string | null;

  // Visit consolidation
  media_count: number;
  media_hashes: string | null; // JSON array of imghash/vidhash

  // Verification
  auto_approved: number;      // 1 if cellphone (auto-trusted)
  user_approved: number;      // 1 if user verified
  approved_at: string | null;
  approved_by: string | null;

  // Audit trail
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;

  // Migration 75: Extraction Pipeline - Smart titles for timeline events
  smart_title: string | null;     // LLM-generated clean title
  tldr: string | null;            // LLM-generated 2-sentence summary
  confidence: number | null;      // 0-1 extraction confidence
  needs_review: number;           // 0/1 - Flag for human review queue
}

// Migration 73: Date Extractions table - NLP date extraction from web sources
export interface DateExtractionsTable {
  extraction_id: string;

  // Source reference
  source_type: string;      // 'web_source' | 'image_caption' | 'document' | 'manual'
  source_id: string;
  locid: string | null;
  subid: string | null;

  // Parsed date
  raw_text: string;
  parsed_date: string | null;
  date_start: string | null;
  date_end: string | null;
  date_precision: string;
  date_display: string | null;
  date_edtf: string | null;
  date_sort: number | null;

  // Context
  sentence: string;
  sentence_position: number | null;
  category: string;         // 'build_date' | 'site_visit' | 'obituary' | etc.
  category_confidence: number;
  category_keywords: string | null;  // JSON array

  // Rich confidence scoring
  keyword_distance: number | null;
  sentence_position_type: string | null;  // 'beginning' | 'middle' | 'end'
  source_age_days: number | null;
  overall_confidence: number;

  // Article date context (for relative dates)
  article_date: string | null;
  relative_date_anchor: string | null;
  was_relative_date: number;

  // Parsing metadata
  parser_name: string;
  parser_confidence: number;
  century_bias_applied: number;
  original_year_ambiguous: number;

  // Duplicate detection & merging
  is_primary: number;
  merged_from_ids: string | null;    // JSON array
  duplicate_of_id: string | null;

  // Timeline conflict detection
  conflict_event_id: string | null;
  conflict_type: string | null;      // 'date_mismatch' | 'category_mismatch' | 'duplicate'
  conflict_resolved: number;

  // Verification
  status: string;           // 'pending' | 'auto_approved' | 'user_approved' | 'rejected' | 'converted' | 'reverted'
  auto_approve_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;

  // Timeline linkage & undo
  timeline_event_id: string | null;
  converted_at: string | null;
  reverted_at: string | null;
  reverted_by: string | null;

  created_at: string;
  updated_at: string | null;
}

// Migration 73: Date Engine Learning table - ML weight adjustments
export interface DateEngineLearningTable {
  id: Generated<number>;
  category: string;
  keyword: string;
  approval_count: number;
  rejection_count: number;
  weight_modifier: number;
  last_updated: string | null;
}

// Migration 73: Date Patterns table - Custom regex patterns
export interface DatePatternsTable {
  pattern_id: string;
  name: string;
  regex: string;
  category: string | null;
  priority: number;
  enabled: number;
  test_cases: string | null;  // JSON array of {input, expected}
  created_at: string;
}

// Migration 74: Extraction Providers table - LLM/NLP provider configurations
export interface ExtractionProvidersTable {
  provider_id: string;
  name: string;
  type: 'spacy' | 'ollama' | 'anthropic' | 'google' | 'openai';
  enabled: number;
  priority: number;
  settings_json: string | null;
  last_used_at: string | null;
  success_count: number;
  error_count: number;
  avg_latency_ms: number | null;
  created_at: string;
  updated_at: string | null;
}

// Migration 74: Entity Extractions table - Extracted people, companies from sources
export interface EntityExtractionsTable {
  extraction_id: string;
  source_type: string;         // 'web_source' | 'document' | 'manual'
  source_id: string;
  locid: string | null;

  entity_type: string;         // 'person' | 'organization' | 'place'
  entity_name: string;
  entity_role: string | null;  // 'owner' | 'architect' | 'developer' | etc.
  date_range: string | null;   // '2006-2016'

  confidence: number;
  provider_id: string | null;
  context_sentence: string | null;

  status: 'pending' | 'approved' | 'rejected' | 'corrected';
  reviewed_at: string | null;
  reviewed_by: string | null;
  user_correction: string | null;

  created_at: string;
}

// Migration 74: Document Summaries table - LLM-generated summaries
export interface DocumentSummariesTable {
  summary_id: string;
  source_type: string;
  source_id: string;
  locid: string | null;

  title: string | null;
  summary_text: string | null;
  key_facts: string | null;    // JSON array

  provider_id: string | null;
  model_used: string | null;
  confidence: number | null;

  status: 'pending' | 'approved' | 'rejected' | 'corrected';
  reviewed_at: string | null;
  reviewed_by: string | null;

  created_at: string;
}

// Migration 75: Extraction Queue table - Background processing queue
export interface ExtractionQueueTable {
  queue_id: string;
  source_type: 'web_source' | 'document' | 'media';
  source_id: string;
  locid: string | null;

  tasks: string;               // JSON array: ['dates', 'entities', 'title', 'summary']

  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  priority: number;
  attempts: number;
  max_attempts: number;

  results_json: string | null;
  error_message: string | null;

  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// Migration 76: Location Tag Summary table - Aggregated location-level tag insights
export interface LocationTagSummaryTable {
  locid: string;                         // Primary key, FK to locs

  // Aggregated tags from all images
  dominant_tags: string | null;          // JSON: ["factory", "machinery", "decay"]
  tag_counts: string | null;             // JSON: {"factory": 45, "machinery": 32}

  // Auto-suggested values from tag analysis
  suggested_type: string | null;         // Auto-detected location type
  suggested_type_confidence: number | null;
  suggested_era: string | null;          // Inferred from architecture tags
  suggested_era_confidence: number | null;

  // Image statistics
  total_images: number;
  tagged_images: number;
  interior_count: number;
  exterior_count: number;
  aerial_count: number;

  // Condition indicators from tags
  has_graffiti: number;                  // 0/1
  has_equipment: number;                 // 0/1
  has_decay: number;                     // 0/1
  has_nature_reclaim: number;            // 0/1
  condition_score: number | null;        // 0-1, aggregated from decay/condition tags

  // Best hero candidate
  best_hero_imghash: string | null;
  best_hero_score: number | null;

  // Timestamps
  created_at: string;
  updated_at: string | null;
}

// Migration 76: Image Tagging Queue table - Track tagging job status
export interface ImageTaggingQueueTable {
  imghash: string;                       // Primary key
  locid: string | null;                  // FK to locs
  image_path: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  priority: number;
  attempts: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// Migration 84: Extracted Addresses table - LLM Tools Overhaul
// Per plan: Extract addresses from web sources to validate/suggest corrections
export interface ExtractedAddressesTable {
  address_id: string;
  locid: string;
  source_id: string;
  source_type: string;                   // 'web' | 'document' | 'manual'

  // Address components (normalized)
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null;                  // 2-letter state code
  zipcode: string | null;
  full_address: string;

  // Extraction metadata
  confidence: number;                    // 0-1 confidence score
  context_sentence: string | null;       // Sentence where address was found
  verb_context: string | null;           // Verb that triggered extraction
  prompt_version: string | null;         // LLM prompt version used

  // Status workflow
  status: 'pending' | 'approved' | 'rejected' | 'applied';

  // Comparison with location address
  matches_location: number;              // 0/1 - Does this match current location address?
  suggested_corrections: string | null;  // JSON of suggested field corrections

  // Timestamps
  created_at: string;
  applied_at: string | null;
  applied_by: string | null;
}
