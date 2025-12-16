/**
 * Services Index
 *
 * Central export for all service modules.
 */

// Hash service
export {
  calculateHash,
  calculateHashFromBuffer,
  calculateHashFromString,
  verifyHash,
  isValidHash,
  calculateHashBatch,
  HASH_LENGTH_BYTES,
  HASH_LENGTH_HEX,
} from './hash-service';

// FFprobe service
export {
  isFFprobeAvailable,
  getVideoMetadata,
  parseVideoInfo,
  getVideoInfo,
  getVideoDuration,
  isValidVideo,
  getFFprobeJson,
  type VideoInfo,
} from './ffprobe-service';

// ExifTool service
export {
  closeExifTool,
  getMetadata,
  getMetadataJson,
  parseMediaInfo,
  getMediaInfo,
  getCameraInfo,
  getCreateDate,
  hasGpsData,
  getGpsCoordinates,
  getVideoExifMetadata,
  toExifToolResult,
  type MediaInfo,
} from './exiftool-service';

// FFmpeg service
export {
  isFFmpegAvailable,
  extractFrame,
  extractFrames,
  generateThumbnail,
  extractClip,
  applyLut,
  normalizeAudio,
  cropToAspect,
  deinterlace,
  getFrameBuffer,
  concatenateVideos,
  type ProgressCallback,
} from './ffmpeg-service';

// Camera matcher service
export {
  matchFileToCamera,
  matchFileWithDefault,
  findDefaultCamera,
  detectMediumFromMetadata,
  DADCAM_PATTERNS,
  SUPER8_PATTERNS,
  MODERN_PATTERNS,
  type CameraMatchResult,
} from './camera-matcher-service';

// Import service
export {
  importService,
  ImportService,
  type ImportOptions,
} from './import-service';

// Import controller
export {
  importController,
  ImportController,
  type ImportControllerOptions,
} from './import-controller';

// Scene detection service
export {
  detectScenes,
  detectScenesWithFrameRate,
  estimateSceneCount,
  type SceneDetectionOptions,
} from './scene-detection-service';

// Sharpness service
export {
  analyzeSharpness,
  findSharpestFrame,
  findSharpestFrameInRange,
  normalizeSharpnessScore,
  getSharpnessScore,
  type SharpnessOptions,
} from './sharpness-service';

// Export service
export {
  exportScreenshot,
  exportClip,
  generateVideoThumbnail,
  exportSceneScreenshots,
  type ScreenshotOptions,
  type ClipOptions,
} from './export-service';

// LiteLLM service
export {
  litellmService,
  isLiteLLMInstalled,
  isLiteLLMRunning,
  isOllamaAvailable,
  startLiteLLM,
  stopLiteLLM,
  ensureLiteLLMRunning,
  getStatus as getLiteLLMStatus,
  getEnhancedStatus as getLiteLLMEnhancedStatus,
  captionImage,
  detectWeddingMoment,
  type LiteLLMStatus,
  type LiteLLMSettings,
  type CaptionResult,
} from './litellm-service';

// Captioning service
export {
  captioningService,
  captionFrame,
  captionScene,
  captionAllScenes,
  captionKeyMoments,
  quickCaption,
  ensureCaptioningReady,
  type SceneCaptionOptions,
  type SceneCaptionResult,
  type BatchCaptionProgress,
} from './captioning-service';

// Signature matcher service
export {
  loadSignatureDatabase,
  reloadSignatureDatabase,
  matchSignature,
  findSignatureByMakeModel,
  searchSignatures,
  getSignatureDatabaseStats,
  type CameraSignature,
  type SignatureDatabase,
  type SignatureMatchResult,
} from './signature-matcher-service';

// Camera trainer service
export {
  startTrainingSession,
  getTrainingSession,
  cancelTrainingSession,
  addTrainingFiles,
  removeTrainingFile,
  analyzeTrainingFiles,
  exportSignatureJson,
  type TrainingSession,
  type TrainingResult,
  type FileAnalysis,
} from './camera-trainer-service';

// USB device service
export {
  getConnectedUSBDevices,
  getConnectedCameras,
  getConnectedJVCDevices,
  loadCameraRegistry,
  registerCamera,
  updateCameraLastSeen,
  findCameraByUSBSerial,
  findCameraByVolumeUUID,
  findCameraByPhysicalSerial,
  findCameraByName,
  getRegisteredCameras,
  updateCamera,
  deleteRegisteredCamera,
  syncConnectedCameras,
  registerConnectedDevice,
  findCameraForMountPoint,
  type USBDevice,
  type VolumeInfo,
  type RegisteredCamera,
  type CameraRegistry,
} from './usb-device-service';
