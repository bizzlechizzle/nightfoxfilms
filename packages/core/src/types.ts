/**
 * Nightfox Films - Core Type Definitions
 *
 * This file contains all shared TypeScript interfaces used across
 * packages/core and packages/desktop.
 *
 * BLAKE3 Hash Format: 16 lowercase hex characters (64-bit output)
 * Example: "a7f3b2c1e9d4f086"
 */

// =============================================================================
// ENUMS
// =============================================================================

export type Medium = 'dadcam' | 'super8' | 'modern';

export type FileType = 'video' | 'sidecar' | 'audio' | 'other';

export type PatternType = 'filename' | 'folder' | 'extension';

export type ExportType = 'screenshot' | 'clip';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3';

export type JobStatus = 'pending' | 'processing' | 'complete' | 'error' | 'dead';

export type ImportStatus = 'pending' | 'scanning' | 'hashing' | 'extracting' | 'copying' | 'validating' | 'finalizing' | 'complete' | 'completed' | 'cancelled' | 'failed' | 'paused' | 'error' | 'skipped';

export type SceneDetectionMethod = 'content' | 'adaptive' | 'threshold';

export type FootageType = 'date_night' | 'rehearsal' | 'wedding' | 'other';

export type Theme = 'light' | 'dark' | 'system';

export type CoupleStatus = 'booked' | 'ingested' | 'editing' | 'delivered' | 'archived';

export type CameraCategory = 'cinema' | 'professional' | 'hybrid' | 'action' | 'consumer' | 'drone' | 'smartphone';

// Legacy deliverable type (deprecated - use ContractDeliverable instead)
export type DeliverableType = 'highlight' | 'trailer' | 'full_length' | 'raw_footage' | 'social_clips' | 'ceremony' | 'reception';

export type DeliverableStatus = 'pending' | 'in_progress' | 'review' | 'delivered';

export type DeliverableCategory = 'edit' | 'timeline' | 'raw' | 'physical' | 'session';

export type EmailType = 'booking_confirmation' | 'preview_ready' | 'delivery' | 'follow_up' | 'thank_you';

// =============================================================================
// EQUIPMENT & INVENTORY ENUMS
// =============================================================================

export type EquipmentType = 'camera' | 'lens' | 'audio' | 'lighting' | 'support' | 'accessory' | 'media';

export type EquipmentStatus = 'available' | 'loaned' | 'maintenance' | 'retired' | 'lost';

export type StockType = 'film' | 'tape';

export type FilmFormat = 'super8' | 'vhs_c' | 'hi8' | 'minidv';

export type LoanStatus = 'requested' | 'approved' | 'preparing' | 'shipped' | 'delivered' | 'active' | 'return_shipped' | 'received' | 'inspected' | 'completed' | 'cancelled' | 'lost' | 'damaged';

export type LoanEventType = 'date_night' | 'engagement' | 'guest_cam';

export type ConditionRating = 'excellent' | 'good' | 'fair' | 'damaged' | 'lost';

// =============================================================================
// COMPREHENSIVE SCHEMA ENUMS
// =============================================================================

export type VenueType = 'church' | 'barn' | 'estate' | 'hotel' | 'restaurant' | 'outdoor' | 'beach' | 'winery' | 'museum' | 'country_club' | 'rooftop' | 'other';

export type VenueRating = 1 | 2 | 3 | 4 | 5;

export type LightingCondition = 'excellent' | 'good' | 'challenging' | 'difficult' | 'mixed';

export type VendorType = 'photographer' | 'planner' | 'coordinator' | 'dj' | 'band' | 'florist' | 'caterer' | 'baker' | 'officiant' | 'makeup' | 'hair' | 'dress' | 'suit' | 'rentals' | 'transportation' | 'other';

export type VendorRelationship = 'preferred' | 'neutral' | 'avoid';

export type PaymentMethod = 'check' | 'cash' | 'venmo' | 'paypal' | 'credit_card' | 'wire' | 'other';

export type PaymentStatus = 'pending' | 'received' | 'deposited' | 'refunded';

export type ExpenseCategory = 'equipment' | 'travel' | 'lodging' | 'film' | 'processing' | 'shipping' | 'software' | 'music' | 'assistant' | 'second_shooter' | 'other';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'negotiating' | 'won' | 'lost' | 'unqualified';

export type LeadSource = 'website' | 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'referral' | 'vendor_referral' | 'wedding_wire' | 'the_knot' | 'google' | 'word_of_mouth' | 'repeat_client' | 'other';

export type CommunicationType = 'email' | 'phone' | 'text' | 'dm' | 'in_person' | 'video_call' | 'voicemail';

export type CommunicationDirection = 'inbound' | 'outbound';

export type QuestionnaireType = 'initial_inquiry' | 'booking' | 'pre_wedding' | 'day_of' | 'feedback';

export type MarkerType = 'select' | 'reject' | 'favorite' | 'maybe' | 'flag';

export type MarkerCategory = 'ceremony' | 'reception' | 'getting_ready' | 'first_look' | 'portraits' | 'details' | 'dancing' | 'speeches' | 'cake' | 'exit' | 'other';

export type FrameCategory = 'people_face' | 'people_roll' | 'broll' | 'detail';

export type ReviewPlatform = 'google' | 'wedding_wire' | 'the_knot' | 'yelp' | 'facebook' | 'instagram' | 'internal' | 'other';

export type ContactRole = 'planner' | 'coordinator' | 'photographer' | 'dj' | 'florist' | 'caterer' | 'officiant' | 'venue_manager' | 'assistant' | 'family' | 'friend' | 'other';

export type TimelineEventType = 'hair_makeup' | 'getting_ready' | 'first_look' | 'ceremony' | 'cocktail_hour' | 'reception_entrance' | 'first_dance' | 'parent_dances' | 'speeches' | 'dinner' | 'cake_cutting' | 'bouquet_toss' | 'garter_toss' | 'dancing' | 'last_dance' | 'exit' | 'other';

// Legacy deliverable interface (deprecated - use ContractDeliverable instead)
export interface CoupleDeliverable {
  type: DeliverableType;
  status: DeliverableStatus;
  notes?: string;
  delivered_at?: string;
}

/**
 * New deliverable structure for contract-based tracking
 * Replaces CoupleDeliverable with more detailed fields
 */
export interface ContractDeliverable {
  code: string;                    // References deliverables-reference.ts codes
  category: DeliverableCategory;   // edit, timeline, raw, physical, session
  name: string;                    // Display name (e.g., "2-4 Minute Highlight Film")
  medium: Medium | 'mixed' | null; // Which medium this deliverable uses
  status: DeliverableStatus;       // pending, in_progress, review, delivered
  notes?: string;                  // Optional notes
  delivered_at?: string;           // ISO date when delivered
}

export interface EmailLogEntry {
  date: string;
  type: EmailType;
  sent: boolean;
  notes?: string;
}

export interface SocialMedia {
  tiktok?: string;
  facebook?: string;
  youtube?: string;
}

// =============================================================================
// DATABASE RECORDS
// =============================================================================

export interface Setting {
  key: string;
  value: string | null;
  updated_at: string;
}

export interface Camera {
  id: number;
  name: string;
  nickname: string | null;
  medium: Medium;
  category: CameraCategory;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  color_profile: string | null;
  filename_pattern: string | null;
  color: string | null;
  is_active: number; // 0 or 1
  is_default: number; // 0 or 1 (deprecated, kept for compatibility)
  is_system: number; // 0 or 1 - system/seed cameras are hidden from UI but used for auto-detection
  notes: string | null;
  lut_path: string | null;
  deinterlace: number; // 0 or 1
  audio_channels: 'stereo' | 'mono' | 'none';
  sharpness_baseline: number | null;
  transcode_preset: string | null;
  created_at: string;
  updated_at: string;
}

export interface CameraPattern {
  id: number;
  camera_id: number;
  pattern_type: PatternType;
  pattern: string;
  priority: number;
  created_at: string;
}

export interface Lens {
  id: number;
  name: string;
  make: string | null;
  model: string | null;
  focal_length: string | null;
  aperture: string | null;
  mount: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Couple {
  id: number;
  name: string;
  wedding_date: string | null;
  folder_name: string | null;
  notes: string | null;
  file_count: number;
  total_duration_seconds: number;
  // Workflow fields
  status: CoupleStatus;
  email: string | null;
  phone: string | null;
  phone_2: string | null;              // Second partner's phone
  venue_name: string | null;
  venue_address: string | null;        // Street address (e.g., "76 Pearl Street")
  venue_city: string | null;
  venue_state: string | null;
  date_ingested: string | null;
  date_editing_started: string | null;
  date_delivered: string | null;
  date_archived: string | null;
  source_path: string | null;
  working_path: string | null;
  delivery_path: string | null;
  package_name: string | null;
  contracted_deliverables: number | null;
  // Detail view fields (migration 11)
  due_date: string | null;
  instagram: string | null;
  social_media_json: string | null;
  deliverables_json: string | null;
  email_log_json: string | null;
  turnaround_days: number;
  // Contract fields (migration 15)
  videographer_count: number;          // 1 or 2
  mediums_json: string | null;         // JSON array of Medium[]
  package_price: number | null;        // Price in dollars
  // Location fields (migration 16)
  getting_ready_1_name: string | null;     // "Bride's Hotel", "Groom's House"
  getting_ready_1_address: string | null;  // Full address
  getting_ready_2_name: string | null;     // Second getting ready location
  getting_ready_2_address: string | null;  // Second address
  ceremony_venue_name: string | null;      // If ceremony at different location
  ceremony_venue_address: string | null;   // Ceremony address
  // Partner contact fields (migration 18)
  partner_1_name: string | null;           // "Julia Bartsch"
  partner_1_email: string | null;
  partner_1_instagram: string | null;
  partner_2_name: string | null;           // "Sven Patterson"
  partner_2_email: string | null;
  partner_2_instagram: string | null;
  mailing_address: string | null;          // Shared mailing address
  // Session fields (migration 19)
  date_night_date: string | null;          // Date of engagement/date night shoot
  // Rehearsal dinner field (migration 44)
  has_rehearsal_dinner: number;            // 0 or 1 - whether couple has rehearsal dinner
  // Relationship fields (migrations 40-41)
  venue_id: number | null;                 // Link to venues table
  lead_id: number | null;                  // Link to leads table (conversion source)
  created_at: string;
  updated_at: string;
}

export interface File {
  id: number;
  blake3: string;
  original_filename: string;
  original_path: string | null;
  managed_path: string | null;
  extension: string;
  file_size: number | null;
  couple_id: number | null;
  camera_id: number | null;
  detected_make: string | null;
  detected_model: string | null;
  detected_lens: string | null;
  medium: Medium | null;
  file_type: FileType | null;
  footage_type: FootageType;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_rate: number | null;
  codec: string | null;
  bitrate: number | null;
  is_processed: number;
  is_hidden: number;
  recorded_at: string | null;
  imported_at: string;
  updated_at: string;
  thumbnail_path: string | null;
  proxy_path: string | null;
}

export interface FileMetadata {
  file_id: number;
  exiftool_json: string | null;
  ffprobe_json: string | null;
  extracted_at: string;
}

export interface FileSidecar {
  video_file_id: number;
  sidecar_file_id: number;
  sidecar_type: string | null;
}

export interface Scene {
  id: number;
  file_id: number;
  scene_number: number;
  start_time: number;
  end_time: number;
  duration: number;
  start_frame: number | null;
  end_frame: number | null;
  detection_method: SceneDetectionMethod | null;
  confidence: number | null;
  best_frame_number: number | null;
  best_frame_sharpness: number | null;
  best_frame_path: string | null;
  scene_type: string | null;
  caption: string | null;
  wedding_moment: string | null;
  created_at: string;
}

export interface AIAnalysis {
  id: number;
  file_id: number | null;
  scene_id: number | null;
  analysis_type: string;
  result_json: string;
  model_name: string;
  provider_name: string;
  confidence: number | null;
  prompt_used: string | null;
  processing_time_ms: number | null;
  created_at: string;
}

export interface Export {
  id: number;
  file_id: number | null;
  scene_id: number | null;
  couple_id: number | null;
  export_type: ExportType;
  output_path: string;
  output_format: string | null;
  width: number | null;
  height: number | null;
  aspect_ratio: AspectRatio | null;
  start_time: number | null;
  end_time: number | null;
  duration: number | null;
  lut_applied: string | null;
  audio_normalized: number;
  crop_applied: string | null;
  caption: string | null;
  caption_ai_analysis_id: number | null;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportQueueItem {
  id: number;
  source_path: string;
  original_filename: string;
  file_size: number | null;
  couple_id: number | null;
  status: ImportStatus;
  error_message: string | null;
  progress_percent: number;
  result_file_id: number | null;
  result_blake3: string | null;
  was_duplicate: number;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: number;
  job_type: string;
  payload_json: string;
  file_id: number | null;
  couple_id: number | null;
  priority: number;
  depends_on_job_id: number | null;
  status: JobStatus;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  started_at: string | null;
  completed_at: string | null;
  processing_time_ms: number | null;
  created_at: string;
  updated_at: string;
}

// Job types for background processing
export type JobType =
  | 'blake3'
  | 'thumbnail'
  | 'proxy'
  | 'screenshot_extract'
  | 'thumbnail_update'
  | 'ai_caption';

// =============================================================================
// SCREENSHOTS (ML-extracted frame candidates)
// =============================================================================

export interface Screenshot {
  id: number;
  file_id: number;
  couple_id: number | null;
  frame_number: number;
  timestamp_seconds: number;
  scene_index: number;
  preview_path: string;
  raw_path: string | null;
  sharpness_score: number;
  face_count: number;
  max_smile_score: number;
  is_broll: number;
  is_audio_peak: number;
  audio_type: string | null;
  frame_category: FrameCategory;
  is_selected: number;
  is_thumbnail: number;
  faces_json: string | null;
  crops_json: string | null;
  tags_json: string | null;
  ai_caption: string | null;
  ai_hashtags: string | null;
  ai_moment_type: string | null;
  created_at: string;
}

export interface ScreenshotInput {
  file_id: number;
  couple_id?: number | null;
  frame_number: number;
  timestamp_seconds: number;
  scene_index?: number;
  preview_path: string;
  raw_path?: string | null;
  sharpness_score?: number;
  face_count?: number;
  max_smile_score?: number;
  is_broll?: number;
  is_audio_peak?: number;
  audio_type?: string | null;
  frame_category?: FrameCategory;
  faces_json?: string | null;
  crops_json?: string | null;
  tags_json?: string | null;
}

export interface ExportPreset {
  id: number;
  name: string;
  aspect_ratio: string;
  max_width: number | null;
  max_height: number | null;
  quality: number;
  include_watermark: number;
  watermark_path: string | null;
  is_default: number;
  created_at: string;
}

// =============================================================================
// EQUIPMENT & INVENTORY RECORDS
// =============================================================================

export interface Equipment {
  id: number;
  name: string;
  equipment_type: EquipmentType;
  category: string | null;
  medium: Medium | null;
  camera_id: number | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  status: EquipmentStatus;
  loaner_eligible: number;
  tutorial_url: string | null;
  image_path: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface FilmStock {
  id: number;
  name: string;
  stock_type: StockType;
  format: FilmFormat;
  manufacturer: string | null;
  asa_iso: number | null;
  is_daylight: number | null;
  quantity_on_hand: number;
  cost_per_unit: number | null;
  processing_cost: number | null;
  scan_cost: number | null;
  footage_yield_sec: number | null;
  expiration_date: string | null;
  storage_location: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProcessingLab {
  id: number;
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  turnaround_days: number | null;
  services: string | null;
  scan_resolutions: string | null;
  scan_formats: string | null;
  your_rating: number | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CameraLoan {
  id: number;
  equipment_id: number;
  couple_id: number;
  event_type: LoanEventType;
  status: LoanStatus;
  requested_at: string | null;
  approved_at: string | null;
  ship_by_date: string | null;
  event_date: string | null;
  due_back_date: string | null;
  shipped_at: string | null;
  ship_carrier: string | null;
  ship_tracking: string | null;
  delivered_at: string | null;
  return_shipped_at: string | null;
  return_carrier: string | null;
  return_tracking: string | null;
  return_received_at: string | null;
  inspected_at: string | null;
  condition_rating: ConditionRating | null;
  condition_notes: string | null;
  media_included: string | null;
  footage_received: number;
  footage_usable: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FilmUsage {
  id: number;
  film_stock_id: number;
  couple_id: number | null;
  camera_loan_id: number | null;
  equipment_id: number | null;
  cartridges_used: number;
  shot_date: string | null;
  scene_notes: string | null;
  lab_id: number | null;
  lab_sent_at: string | null;
  lab_tracking_out: string | null;
  scans_received_at: string | null;
  scans_download_url: string | null;
  physical_received_at: string | null;
  lab_tracking_return: string | null;
  scan_resolution: string | null;
  scan_format: string | null;
  scan_asset_ids: string | null;
  total_cost: number | null;
  issues: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// COMPREHENSIVE SCHEMA RECORDS
// =============================================================================

export interface Venue {
  id: number;
  name: string;
  venue_type: VenueType;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  capacity: number | null;
  // Shooting conditions
  indoor_lighting: LightingCondition | null;
  outdoor_lighting: LightingCondition | null;
  audio_challenges: string | null;
  power_availability: string | null;
  load_in_notes: string | null;
  parking_notes: string | null;
  restrictions: string | null;
  // Ratings and notes
  your_rating: VenueRating | null;
  shooting_notes: string | null;
  notes: string | null;
  // Tracking
  times_shot: number;
  last_shot_date: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: number;
  name: string;
  company: string | null;
  vendor_type: VendorType;
  email: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  // Relationship tracking
  relationship: VendorRelationship;
  your_rating: VenueRating | null;
  referral_fee_percent: number | null;
  referral_fee_flat: number | null;
  notes: string | null;
  // Stats
  times_worked_together: number;
  referrals_received: number;
  referrals_given: number;
  last_worked_date: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface VendorCouple {
  id: number;
  vendor_id: number;
  couple_id: number;
  role: string | null;
  notes: string | null;
  created_at: string;
}

export interface Package {
  id: number;
  name: string;
  code: string;
  description: string | null;
  price: number;
  videographer_count: number;
  hours_coverage: number | null;
  mediums_json: string | null;
  deliverables_json: string | null;
  includes_json: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  id: number;
  couple_id: number;
  package_id: number | null;
  custom_package_name: string | null;
  contract_date: string | null;
  wedding_date: string;
  total_price: number;
  deposit_amount: number | null;
  deposit_due_date: string | null;
  deposit_received_date: string | null;
  balance_amount: number | null;
  balance_due_date: string | null;
  balance_received_date: string | null;
  payment_schedule_json: string | null;
  deliverables_json: string | null;
  custom_terms: string | null;
  signed_at: string | null;
  signed_by: string | null;
  contract_pdf_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  couple_id: number;
  contract_id: number | null;
  amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  payment_type: string | null;
  reference_number: string | null;
  paid_at: string | null;
  due_date: string | null;
  deposited_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: number;
  couple_id: number | null;
  category: ExpenseCategory;
  description: string;
  amount: number;
  vendor_id: number | null;
  vendor_name: string | null;
  receipt_path: string | null;
  expense_date: string;
  is_reimbursable: number;
  reimbursed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: number;
  partner_1_name: string | null;
  partner_2_name: string | null;
  email: string | null;
  phone: string | null;
  wedding_date: string | null;
  venue_name: string | null;
  source: LeadSource;
  source_detail: string | null;
  referrer_id: number | null;
  referrer_type: string | null;
  status: LeadStatus;
  budget_range: string | null;
  package_interest: string | null;
  notes: string | null;
  // Conversion tracking
  first_contact_at: string | null;
  last_contact_at: string | null;
  qualified_at: string | null;
  proposal_sent_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  converted_couple_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Communication {
  id: number;
  couple_id: number | null;
  lead_id: number | null;
  vendor_id: number | null;
  contact_id: number | null;
  communication_type: CommunicationType;
  direction: CommunicationDirection;
  subject: string | null;
  summary: string | null;
  full_text: string | null;
  attachments_json: string | null;
  gmail_id: string | null;
  gmail_thread_id: string | null;
  call_duration_seconds: number | null;
  occurred_at: string;
  follow_up_date: string | null;
  follow_up_completed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Questionnaire {
  id: number;
  name: string;
  questionnaire_type: QuestionnaireType;
  description: string | null;
  questions_json: string;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionnaireResponse {
  id: number;
  questionnaire_id: number;
  couple_id: number;
  responses_json: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FootageMarker {
  id: number;
  file_id: number;
  scene_id: number | null;
  marker_type: MarkerType;
  category: MarkerCategory | null;
  timecode_in: number | null;
  timecode_out: number | null;
  rating: number | null;
  color: string | null;
  label: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: number;
  couple_id: number;
  platform: ReviewPlatform;
  rating: number;
  title: string | null;
  content: string | null;
  reviewer_name: string | null;
  review_date: string;
  external_url: string | null;
  is_featured: number;
  is_approved: number;
  response: string | null;
  responded_at: string | null;
  screenshot_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  name: string;
  company: string | null;
  role: ContactRole;
  email: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  relationship_notes: string | null;
  vendor_id: number | null;
  venue_id: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CoupleContact {
  id: number;
  couple_id: number;
  contact_id: number;
  role: string | null;
  notes: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: number;
  couple_id: number;
  event_type: TimelineEventType;
  title: string | null;
  scheduled_time: string | null;
  actual_time: string | null;
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ShotListItem {
  id: number;
  couple_id: number;
  category: MarkerCategory;
  description: string;
  is_required: number;
  is_captured: number;
  priority: number;
  notes: string | null;
  file_ids_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  tag_type: string | null;
  created_at: string;
}

export interface FileTag {
  file_id: number;
  tag_id: number;
  created_at: string;
}

export interface SceneTag {
  scene_id: number;
  tag_id: number;
  created_at: string;
}

export interface Playlist {
  id: number;
  couple_id: number | null;
  name: string;
  description: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  id: number;
  playlist_id: number;
  file_id: number | null;
  scene_id: number | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
}

// =============================================================================
// INPUT TYPES (for creating/updating records)
// =============================================================================

export interface CameraInput {
  name: string;
  nickname?: string | null;
  medium: Medium;
  category?: CameraCategory;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  color_profile?: string | null;
  filename_pattern?: string | null;
  color?: string | null;
  is_active?: boolean;
  is_default?: boolean; // deprecated
  notes?: string | null;
  lut_path?: string | null;
  deinterlace?: boolean;
  audio_channels?: 'stereo' | 'mono' | 'none';
  sharpness_baseline?: number | null;
  transcode_preset?: string | null;
}

export interface CameraPatternInput {
  camera_id: number;
  pattern_type: PatternType;
  pattern: string;
  priority?: number;
}

export interface LensInput {
  name: string;
  make?: string | null;
  model?: string | null;
  focal_length?: string | null;
  aperture?: string | null;
  mount?: string | null;
  notes?: string | null;
}

export interface CoupleInput {
  name: string;
  wedding_date?: string | null;
  folder_name?: string | null;
  notes?: string | null;
  // Workflow fields
  status?: CoupleStatus;
  email?: string | null;
  phone?: string | null;
  phone_2?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_city?: string | null;
  venue_state?: string | null;
  source_path?: string | null;
  working_path?: string | null;
  delivery_path?: string | null;
  package_name?: string | null;
  contracted_deliverables?: number | null;
  // Detail view fields
  due_date?: string | null;
  instagram?: string | null;
  social_media?: SocialMedia | null;
  deliverables?: ContractDeliverable[] | null;  // Updated to use ContractDeliverable
  email_log?: EmailLogEntry[] | null;
  turnaround_days?: number;
  // Contract fields
  videographer_count?: number;
  mediums?: Medium[];
  package_price?: number | null;
  // Location fields
  getting_ready_1_name?: string | null;
  getting_ready_1_address?: string | null;
  getting_ready_2_name?: string | null;
  getting_ready_2_address?: string | null;
  ceremony_venue_name?: string | null;
  ceremony_venue_address?: string | null;
  // Partner contact fields
  partner_1_name?: string | null;
  partner_1_email?: string | null;
  partner_1_instagram?: string | null;
  partner_2_name?: string | null;
  partner_2_email?: string | null;
  partner_2_instagram?: string | null;
  mailing_address?: string | null;
  // Session fields
  date_night_date?: string | null;
  // Rehearsal dinner field
  has_rehearsal_dinner?: boolean;
  // Relationship fields
  venue_id?: number | null;
  lead_id?: number | null;
}

export interface ImportInput {
  files: Array<{
    filePath: string;
    originalName: string;
  }>;
  couple_id?: number | null;
}

export interface ExportInput {
  file_id: number;
  scene_id?: number | null;
  export_type: ExportType;
  aspect_ratio?: AspectRatio;
  lut?: string | null;
  normalize_audio?: boolean;
  include_caption?: boolean;
}

export interface EquipmentInput {
  name: string;
  equipment_type: EquipmentType;
  category?: string | null;
  medium?: Medium | null;
  camera_id?: number | null;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  status?: EquipmentStatus;
  loaner_eligible?: boolean;
  tutorial_url?: string | null;
  image_path?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface FilmStockInput {
  name: string;
  stock_type: StockType;
  format: FilmFormat;
  manufacturer?: string | null;
  asa_iso?: number | null;
  is_daylight?: boolean | null;
  quantity_on_hand?: number;
  cost_per_unit?: number | null;
  processing_cost?: number | null;
  scan_cost?: number | null;
  footage_yield_sec?: number | null;
  expiration_date?: string | null;
  storage_location?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface ProcessingLabInput {
  name: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  turnaround_days?: number | null;
  services?: string | null;
  scan_resolutions?: string[] | null;
  scan_formats?: string[] | null;
  your_rating?: number | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface CameraLoanInput {
  equipment_id: number;
  couple_id: number;
  event_type: LoanEventType;
  status?: LoanStatus;
  ship_by_date?: string | null;
  event_date?: string | null;
  due_back_date?: string | null;
  ship_carrier?: string | null;
  ship_tracking?: string | null;
  return_carrier?: string | null;
  return_tracking?: string | null;
  condition_rating?: ConditionRating | null;
  condition_notes?: string | null;
  media_included?: string[] | null;
  footage_received?: boolean;
  footage_usable?: boolean;
  notes?: string | null;
}

export interface FilmUsageInput {
  film_stock_id: number;
  couple_id?: number | null;
  camera_loan_id?: number | null;
  equipment_id?: number | null;
  cartridges_used: number;
  shot_date?: string | null;
  scene_notes?: string | null;
  lab_id?: number | null;
  lab_tracking_out?: string | null;
  scans_download_url?: string | null;
  lab_tracking_return?: string | null;
  scan_resolution?: string | null;
  scan_format?: string | null;
  scan_asset_ids?: number[] | null;
  total_cost?: number | null;
  issues?: string | null;
  notes?: string | null;
}

// =============================================================================
// COMPREHENSIVE SCHEMA INPUT TYPES
// =============================================================================

export interface VenueInput {
  name: string;
  venue_type: VenueType;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  capacity?: number | null;
  indoor_lighting?: LightingCondition | null;
  outdoor_lighting?: LightingCondition | null;
  audio_challenges?: string | null;
  power_availability?: string | null;
  load_in_notes?: string | null;
  parking_notes?: string | null;
  restrictions?: string | null;
  your_rating?: VenueRating | null;
  shooting_notes?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface VendorInput {
  name: string;
  company?: string | null;
  vendor_type: VendorType;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  instagram?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  relationship?: VendorRelationship;
  your_rating?: VenueRating | null;
  referral_fee_percent?: number | null;
  referral_fee_flat?: number | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface PackageInput {
  name: string;
  code: string;
  description?: string | null;
  price: number;
  videographer_count?: number;
  hours_coverage?: number | null;
  mediums?: Medium[] | null;
  deliverables?: ContractDeliverable[] | null;
  includes?: string[] | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface ContractInput {
  couple_id: number;
  package_id?: number | null;
  custom_package_name?: string | null;
  contract_date?: string | null;
  wedding_date: string;
  total_price: number;
  deposit_amount?: number | null;
  deposit_due_date?: string | null;
  balance_amount?: number | null;
  balance_due_date?: string | null;
  payment_schedule?: Array<{ amount: number; due_date: string; description?: string }> | null;
  deliverables?: ContractDeliverable[] | null;
  custom_terms?: string | null;
  notes?: string | null;
}

export interface PaymentInput {
  couple_id: number;
  contract_id?: number | null;
  amount: number;
  payment_method: PaymentMethod;
  status?: PaymentStatus;
  payment_type?: string | null;
  reference_number?: string | null;
  paid_at?: string | null;
  due_date?: string | null;
  notes?: string | null;
}

export interface ExpenseInput {
  couple_id?: number | null;
  category: ExpenseCategory;
  description: string;
  amount: number;
  vendor_id?: number | null;
  vendor_name?: string | null;
  receipt_path?: string | null;
  expense_date: string;
  is_reimbursable?: boolean;
  notes?: string | null;
}

export interface LeadInput {
  partner_1_name?: string | null;
  partner_2_name?: string | null;
  email?: string | null;
  phone?: string | null;
  wedding_date?: string | null;
  venue_name?: string | null;
  source: LeadSource;
  source_detail?: string | null;
  referrer_id?: number | null;
  referrer_type?: string | null;
  status?: LeadStatus;
  budget_range?: string | null;
  package_interest?: string | null;
  notes?: string | null;
}

export interface CommunicationInput {
  couple_id?: number | null;
  lead_id?: number | null;
  vendor_id?: number | null;
  contact_id?: number | null;
  communication_type: CommunicationType;
  direction: CommunicationDirection;
  subject?: string | null;
  summary?: string | null;
  full_text?: string | null;
  attachments?: string[] | null;
  gmail_id?: string | null;
  gmail_thread_id?: string | null;
  call_duration_seconds?: number | null;
  occurred_at: string;
  follow_up_date?: string | null;
  notes?: string | null;
}

export interface QuestionnaireInput {
  name: string;
  questionnaire_type: QuestionnaireType;
  description?: string | null;
  questions: Array<{
    id: string;
    type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'time' | 'number';
    label: string;
    required?: boolean;
    options?: string[];
  }>;
  is_active?: boolean;
  sort_order?: number;
}

export interface QuestionnaireResponseInput {
  questionnaire_id: number;
  couple_id: number;
  responses: Record<string, string | string[] | number>;
  notes?: string | null;
}

export interface FootageMarkerInput {
  file_id: number;
  scene_id?: number | null;
  marker_type: MarkerType;
  category?: MarkerCategory | null;
  timecode_in?: number | null;
  timecode_out?: number | null;
  rating?: number | null;
  color?: string | null;
  label?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

export interface ReviewInput {
  couple_id: number;
  platform: ReviewPlatform;
  rating: number;
  title?: string | null;
  content?: string | null;
  reviewer_name?: string | null;
  review_date: string;
  external_url?: string | null;
  is_featured?: boolean;
  is_approved?: boolean;
  response?: string | null;
  screenshot_path?: string | null;
  notes?: string | null;
}

export interface ContactInput {
  name: string;
  company?: string | null;
  role: ContactRole;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  instagram?: string | null;
  address?: string | null;
  relationship_notes?: string | null;
  vendor_id?: number | null;
  venue_id?: number | null;
  is_active?: boolean;
}

export interface TimelineEventInput {
  couple_id: number;
  event_type: TimelineEventType;
  title?: string | null;
  scheduled_time?: string | null;
  actual_time?: string | null;
  duration_minutes?: number | null;
  location?: string | null;
  notes?: string | null;
  sort_order?: number;
}

export interface ShotListItemInput {
  couple_id: number;
  category: MarkerCategory;
  description: string;
  is_required?: boolean;
  priority?: number;
  notes?: string | null;
}

export interface TagInput {
  name: string;
  color?: string | null;
  tag_type?: string | null;
}

export interface PlaylistInput {
  couple_id?: number | null;
  name: string;
  description?: string | null;
  is_public?: boolean;
}

export interface PlaylistItemInput {
  playlist_id: number;
  file_id?: number | null;
  scene_id?: number | null;
  sort_order?: number;
  notes?: string | null;
}

// =============================================================================
// EXTERNAL TOOL RESULTS
// =============================================================================

export interface FFProbeFormat {
  filename: string;
  duration: string;
  size: string;
  bit_rate: string;
  format_name: string;
  format_long_name: string;
  tags?: Record<string, string>;
}

export interface FFProbeStream {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data';
  codec_name: string;
  codec_long_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  tags?: Record<string, string>;
}

export interface FFProbeResult {
  format: FFProbeFormat;
  streams: FFProbeStream[];
}

export interface ExifToolResult {
  SourceFile: string;
  FileName: string;
  FileSize: string;
  FileType: string;
  MIMEType: string;
  Make?: string;
  Model?: string;
  CreateDate?: string;
  ModifyDate?: string;
  Duration?: string | number;
  ImageWidth?: number;
  ImageHeight?: number;
  VideoFrameRate?: number;
  AudioChannels?: number;
  AudioSampleRate?: number;
  GPSLatitude?: string;
  GPSLongitude?: string;
  [key: string]: unknown;
}

export interface HashResult {
  hash: string;
  filePath: string;
  fileSize: number;
}

// =============================================================================
// SERVICE RESULTS
// =============================================================================

export interface ImportResult {
  success: boolean;
  hash: string;
  type: FileType | 'skipped';
  duplicate: boolean;
  skipped?: boolean;
  sidecarOnly?: boolean;
  archivePath?: string;
  error?: string;
  warnings?: string[];
}

export interface ImportBatchResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
  errors: number;
  files: ImportResult[];
}

export interface SceneDetectionResult {
  scenes: Array<{
    scene_number: number;
    start_time: number;
    end_time: number;
    start_frame: number;
    end_frame: number;
    duration: number;
  }>;
  duration_ms: number;
  method: SceneDetectionMethod;
}

export interface SharpnessResult {
  frame_number: number;
  time_seconds: number;
  sharpness: number;
}

export interface FaceDetectionResult {
  faces: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }>;
  frame_number: number;
}

export interface SmartCropResult {
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source_aspect: AspectRatio;
  target_aspect: AspectRatio;
  method: 'face' | 'saliency' | 'center';
}

// =============================================================================
// AI INTEGRATION
// =============================================================================

export interface LiteLLMConfig {
  baseUrl: string;
  modelVLM: string;
  modelLLM: string;
}

export interface AISource {
  model: string;
  provider: string;
  timestamp: Date;
  confidence?: number;
}

export interface CaptionResult {
  caption: string;
  hashtags?: string[];
  source: AISource;
}

export interface AIAnalysisResult {
  type: string;
  result: unknown;
  source: AISource;
}

// =============================================================================
// IPC MESSAGES
// =============================================================================

export interface ImportProgress {
  current: number;
  total: number;
  filename: string;
  status: ImportStatus;
  // Extended fields for network-safe import pipeline
  sessionId?: string;
  step?: number;
  totalSteps?: number;
  percent?: number;
  currentFile?: string;
  filesProcessed?: number;
  filesTotal?: number;
  bytesProcessed?: number;
  bytesTotal?: number;
  duplicatesFound?: number;
  errorsFound?: number;
}

export interface JobProgress {
  job_id: number;
  job_type: string;
  progress_percent: number;
  status: JobStatus;
  message?: string;
}

// =============================================================================
// VIEW TYPES (joined queries)
// =============================================================================

export interface FileWithCamera extends File {
  camera_name: string | null;
  camera_medium: Medium | null;
  camera_lut_path: string | null;
  couple_name: string | null;
  couple_wedding_date: string | null;
}

export interface CameraWithPatterns extends Camera {
  patterns: CameraPattern[];
}

export interface CoupleWithFiles extends Couple {
  files: File[];
}

export interface SceneWithFile extends Scene {
  file_blake3: string;
  file_original_filename: string;
}

// =============================================================================
// VALIDATION SCHEMAS (Zod patterns)
// =============================================================================

// Use these patterns with Zod for IPC validation:
//
// import { z } from 'zod';
//
// export const Blake3Schema = z.string().length(16).regex(/^[a-f0-9]+$/);
//
// export const MediumSchema = z.enum(['dadcam', 'super8', 'modern']);
//
// export const CameraInputSchema = z.object({
//   name: z.string().min(1),
//   medium: MediumSchema,
//   notes: z.string().nullable().optional(),
//   lut_path: z.string().nullable().optional(),
//   deinterlace: z.boolean().optional(),
//   audio_channels: z.enum(['stereo', 'mono', 'none']).optional(),
//   sharpness_baseline: z.number().nullable().optional(),
//   transcode_preset: z.string().nullable().optional(),
// });
//
// export const CoupleInputSchema = z.object({
//   name: z.string().min(1),
//   wedding_date: z.string().nullable().optional(),
//   notes: z.string().nullable().optional(),
// });
//
// export const ImportInputSchema = z.object({
//   files: z.array(z.object({
//     filePath: z.string(),
//     originalName: z.string(),
//   })),
//   couple_id: z.number().nullable().optional(),
// });
