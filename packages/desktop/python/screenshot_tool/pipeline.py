"""
Screenshot Tool Pipeline - Main orchestration module.

Coordinates all ML components for screenshot extraction from video:
1. Scene Detection (TransNetV2)
2. Frame Extraction (FFmpeg)
3. Quality Filtering (Laplacian + NIMA)
4. Face Detection (InsightFace)
5. Expression Analysis
6. Content Tagging (RAM++)
7. Captioning (Florence-2) - optional
8. Smart Cropping (U2-Net via rembg)
9. Aesthetic Ranking (NIMA)
10. Face Clustering
11. Audio Analysis (speech, music, applause detection)
12. Output Generation
"""

import os
import json
import torch
import cv2
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass, asdict, field
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class FaceData:
    """Represents detected face data."""
    bbox: List[float]
    confidence: float
    landmarks: Optional[List[List[float]]] = None
    embedding: Optional[List[float]] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    pose: Optional[List[float]] = None
    smile_score: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CropCoordinates:
    """Represents crop coordinates for an aspect ratio."""
    x1: int
    y1: int
    x2: int
    y2: int
    width: int
    height: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FrameCandidate:
    """Represents a candidate frame for export."""
    frame_number: int
    timestamp: float
    image_path: str  # LUT-graded preview (used for ML analysis)
    sharpness_score: float
    raw_path: Optional[str] = None  # Original LOG/RAW frame (for final export)
    nima_score: float = 0.0
    faces: List[FaceData] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    caption: Optional[str] = None
    crops: Dict[str, CropCoordinates] = field(default_factory=dict)
    aesthetic_score: float = 0.0
    is_broll: bool = False
    scene_index: int = 0
    cluster_labels: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        result = asdict(self)
        result['faces'] = [f if isinstance(f, dict) else f.to_dict() for f in self.faces]
        result['crops'] = {k: (v if isinstance(v, dict) else v.to_dict()) for k, v in self.crops.items()}
        return result


def get_device() -> str:
    """Get the best available device."""
    if torch.cuda.is_available():
        return 'cuda'
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


class SceneDetector:
    """TransNetV2-based scene detection."""

    def __init__(self, device: str = None):
        self.device = device or get_device()
        self.model = None

    def load(self):
        """Load the TransNetV2 model."""
        if self.model is not None:
            return

        try:
            from transnetv2_pytorch import TransNetV2
            self.model = TransNetV2(device=self.device)
            logger.info("TransNetV2 loaded successfully")
        except ImportError:
            logger.warning("TransNetV2 not available, using fallback FFmpeg-based detection")
            self.model = None

    def detect(self, video_path: str, threshold: float = 0.5) -> List[tuple]:
        """
        Detect scene boundaries in video.

        Args:
            video_path: Path to video file
            threshold: Detection threshold (0.0-1.0)

        Returns:
            List of (start_frame, end_frame) tuples
        """
        if self.model is None:
            return self._fallback_detect(video_path)

        try:
            _, predictions, _ = self.model.predict_video(video_path)
            scenes = self.model.predictions_to_scenes(predictions, threshold=threshold)
            return scenes
        except Exception as e:
            logger.error(f"Scene detection failed: {e}")
            return self._fallback_detect(video_path)

    def _fallback_detect(self, video_path: str) -> List[tuple]:
        """Fallback scene detection using frame count."""
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()

        if total_frames <= 0:
            return []

        # Create artificial scenes every 5 seconds
        scene_length = int(fps * 5)
        scenes = []
        start = 0

        while start < total_frames:
            end = min(start + scene_length, total_frames - 1)
            scenes.append((start, end))
            start = end + 1

        return scenes


class QualityFilter:
    """Quality filtering using Laplacian variance and optionally NIMA."""

    def __init__(self):
        self.nima_session = None

    def compute_sharpness(self, image: np.ndarray) -> float:
        """
        Compute sharpness using Laplacian variance.

        Args:
            image: BGR image array

        Returns:
            Sharpness score (higher = sharper)
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        return float(laplacian.var())

    def compute_sharpness_from_path(self, image_path: str) -> float:
        """Compute sharpness from image file."""
        image = cv2.imread(image_path)
        if image is None:
            return 0.0
        return self.compute_sharpness(image)

    def is_sharp(self, image_path: str, threshold: float = 100.0) -> bool:
        """Check if image passes sharpness threshold."""
        return self.compute_sharpness_from_path(image_path) >= threshold


class FaceDetector:
    """InsightFace-based face detection."""

    def __init__(self, device: str = None):
        self.device = device or get_device()
        self.app = None

    def load(self):
        """Load the InsightFace model."""
        if self.app is not None:
            return

        try:
            from insightface.app import FaceAnalysis

            providers = ['CPUExecutionProvider']
            if self.device == 'cuda':
                providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']

            self.app = FaceAnalysis(name='buffalo_l', providers=providers)
            self.app.prepare(ctx_id=0 if self.device == 'cuda' else -1, det_size=(640, 640))
            logger.info("InsightFace loaded successfully")
        except ImportError as e:
            logger.error(f"InsightFace not available: {e}")
            self.app = None

    def detect(self, image_path: str) -> List[FaceData]:
        """
        Detect faces in an image.

        Args:
            image_path: Path to image file

        Returns:
            List of FaceData objects
        """
        if self.app is None:
            return []

        image = cv2.imread(image_path)
        if image is None:
            return []

        faces = self.app.get(image)
        results = []

        for face in faces:
            face_data = FaceData(
                bbox=face.bbox.tolist(),
                confidence=float(face.det_score),
                landmarks=face.kps.tolist() if face.kps is not None else None,
                embedding=face.embedding.tolist() if face.embedding is not None else None,
                age=int(face.age) if face.age is not None else None,
                gender='M' if face.gender == 1 else 'F' if face.gender == 0 else None,
                pose=face.pose.tolist() if face.pose is not None else None,
            )

            # Estimate smile - prefer 106-point landmarks if available
            landmark_106 = getattr(face, 'landmark_2d_106', None)
            if landmark_106 is not None:
                face_data.smile_score = self._estimate_smile_106(landmark_106)
            elif face_data.landmarks and len(face_data.landmarks) >= 5:
                face_data.smile_score = self._estimate_smile_5pt(face_data.landmarks)

            results.append(face_data)

        return results

    def _estimate_smile_106(self, landmarks: np.ndarray) -> float:
        """
        Estimate smile score from 106-point landmarks.

        Uses mouth shape analysis:
        - Lip curvature (corners up = smile)
        - Mouth openness
        - Lip stretch ratio

        106-point landmark indices for mouth:
        - 52-71: Outer lip contour
        - 72-82: Inner lip contour (upper)
        - 84-90: Inner lip contour (lower)
        """
        try:
            if landmarks is None or len(landmarks) < 106:
                return 0.0

            # Key mouth points
            left_corner = np.array(landmarks[52])   # Left mouth corner
            right_corner = np.array(landmarks[61])  # Right mouth corner
            upper_lip_center = np.array(landmarks[57])  # Upper lip center
            lower_lip_center = np.array(landmarks[66])  # Lower lip center

            # Eye points for face height reference
            left_eye = np.array(landmarks[38])   # Left eye center
            right_eye = np.array(landmarks[88])  # Right eye center

            # Calculate metrics
            mouth_width = np.linalg.norm(right_corner - left_corner)
            eye_distance = np.linalg.norm(right_eye - left_eye)

            # 1. Mouth width to eye distance ratio (wider = more smile)
            width_ratio = mouth_width / eye_distance if eye_distance > 0 else 0
            width_score = np.clip((width_ratio - 0.9) * 3, 0.0, 1.0)

            # 2. Corner elevation (corners up relative to center = smile)
            mouth_center_y = (upper_lip_center[1] + lower_lip_center[1]) / 2
            left_corner_lift = mouth_center_y - left_corner[1]
            right_corner_lift = mouth_center_y - right_corner[1]
            avg_lift = (left_corner_lift + right_corner_lift) / 2
            face_height = eye_distance * 1.5  # Approximate
            lift_score = np.clip(avg_lift / (face_height * 0.03) + 0.5, 0.0, 1.0)

            # 3. Mouth openness (teeth showing = often smiling)
            mouth_height = np.linalg.norm(upper_lip_center - lower_lip_center)
            openness_ratio = mouth_height / mouth_width if mouth_width > 0 else 0
            openness_score = np.clip(openness_ratio * 2, 0.0, 0.5)  # Cap contribution

            # Combined score: weighted average
            smile_score = width_score * 0.4 + lift_score * 0.4 + openness_score * 0.2
            return float(np.clip(smile_score, 0.0, 1.0))

        except Exception as e:
            logger.warning(f"Error in smile estimation: {e}")
            return 0.0

    def _estimate_smile_5pt(self, landmarks: List[List[float]]) -> float:
        """
        Fallback: Estimate smile score from 5-point landmarks.

        Landmarks order: left_eye, right_eye, nose, left_mouth, right_mouth
        """
        if len(landmarks) < 5:
            return 0.0

        left_eye = np.array(landmarks[0])
        right_eye = np.array(landmarks[1])
        left_mouth = np.array(landmarks[3])
        right_mouth = np.array(landmarks[4])

        # Face width approximation
        face_width = np.linalg.norm(right_eye - left_eye)
        mouth_width = np.linalg.norm(right_mouth - left_mouth)

        # Mouth width ratio (wider = more smile)
        width_ratio = mouth_width / face_width if face_width > 0 else 0

        # Normalize to 0-1 range
        smile_score = np.clip((width_ratio - 0.4) * 2, 0.0, 1.0)
        return float(smile_score)


class ContentTagger:
    """RAM++ based content tagging."""

    def __init__(self, device: str = None):
        self.device = device or get_device()
        self.model = None

    def load(self, model_path: str = None):
        """Load the RAM++ model."""
        if self.model is not None:
            return

        try:
            from ram import get_model

            if model_path is None:
                model_path = os.path.join(
                    os.path.dirname(__file__),
                    'models',
                    'ram_plus_swin_large_14m.pth'
                )

            if not os.path.exists(model_path):
                logger.warning(f"RAM++ model not found at {model_path}")
                return

            self.model = get_model(
                model_path=model_path,
                image_size=384,
                vit='swin_l'
            )
            self.model.eval()

            if self.device == 'cuda':
                self.model.cuda()

            logger.info("RAM++ loaded successfully")
        except ImportError as e:
            logger.error(f"RAM++ not available: {e}")
            self.model = None

    def tag(self, image_path: str) -> List[str]:
        """
        Generate tags for an image.

        Args:
            image_path: Path to image file

        Returns:
            List of tags
        """
        if self.model is None:
            return []

        try:
            from PIL import Image
            from ram.inference import inference_ram

            image = Image.open(image_path).convert('RGB')

            with torch.no_grad():
                tags_str = inference_ram(image, self.model)

            tags = [t.strip() for t in tags_str.split(',') if t.strip()]
            return tags
        except Exception as e:
            logger.error(f"Tagging failed: {e}")
            return []


class SmartCropper:
    """U2-Net based smart cropping via rembg."""

    def __init__(self, model: str = "u2net"):
        self.model_name = model
        self.session = None

    def load(self):
        """Load the U2-Net model."""
        if self.session is not None:
            return

        try:
            from rembg import new_session
            self.session = new_session(self.model_name)
            logger.info("U2-Net (rembg) loaded successfully")
        except ImportError as e:
            logger.error(f"rembg not available: {e}")
            self.session = None

    def get_saliency_mask(self, image_path: str) -> Optional[np.ndarray]:
        """
        Get saliency mask for an image.

        Args:
            image_path: Path to image file

        Returns:
            Grayscale mask (white = salient)
        """
        if self.session is None:
            return None

        try:
            from PIL import Image
            from rembg import remove

            image = Image.open(image_path).convert('RGB')
            mask = remove(image, session=self.session, only_mask=True)
            return np.array(mask)
        except Exception as e:
            logger.error(f"Saliency detection failed: {e}")
            return None

    def get_subject_bbox(self, mask: np.ndarray, threshold: int = 128) -> tuple:
        """Get bounding box of salient subject."""
        binary = (mask > threshold).astype(np.uint8) * 255
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            h, w = mask.shape[:2]
            return (0, 0, w, h)

        all_points = np.vstack(contours)
        x, y, w, h = cv2.boundingRect(all_points)
        return (x, y, x + w, y + h)

    def generate_crops(
        self,
        image_path: str,
        faces: List[FaceData] = None
    ) -> Dict[str, CropCoordinates]:
        """
        Generate smart crops for multiple aspect ratios.

        Args:
            image_path: Path to image file
            faces: Optional list of detected faces for priority cropping

        Returns:
            Dictionary of crop coordinates by aspect ratio
        """
        from PIL import Image

        image = Image.open(image_path)
        img_width, img_height = image.size

        # Determine subject center
        if faces and len(faces) > 0:
            # Use face center as subject center
            all_x = []
            all_y = []
            for face in faces:
                bbox = face.bbox if isinstance(face, FaceData) else face.get('bbox', [])
                if len(bbox) >= 4:
                    all_x.append((bbox[0] + bbox[2]) / 2)
                    all_y.append((bbox[1] + bbox[3]) / 2)

            if all_x and all_y:
                subj_cx = int(sum(all_x) / len(all_x))
                subj_cy = int(sum(all_y) / len(all_y))
            else:
                subj_cx = img_width // 2
                subj_cy = img_height // 2
        else:
            # Use saliency detection
            mask = self.get_saliency_mask(image_path)
            if mask is not None:
                x1, y1, x2, y2 = self.get_subject_bbox(mask)
                subj_cx = (x1 + x2) // 2
                subj_cy = (y1 + y2) // 2
            else:
                subj_cx = img_width // 2
                subj_cy = img_height // 2

        # Define aspect ratios
        aspect_ratios = {
            '9:16': (9, 16),   # Stories/Reels
            '1:1': (1, 1),     # Instagram Feed
            '16:9': (16, 9),   # YouTube/Facebook
            '4:5': (4, 5),     # Instagram Portrait
        }

        crops = {}

        for name, (ratio_w, ratio_h) in aspect_ratios.items():
            target_ratio = ratio_w / ratio_h
            img_ratio = img_width / img_height

            if target_ratio > img_ratio:
                crop_width = img_width
                crop_height = int(img_width / target_ratio)
            else:
                crop_height = img_height
                crop_width = int(img_height * target_ratio)

            # Center crop on subject
            crop_x1 = max(0, min(subj_cx - crop_width // 2, img_width - crop_width))
            crop_y1 = max(0, min(subj_cy - crop_height // 2, img_height - crop_height))

            crops[name] = CropCoordinates(
                x1=crop_x1,
                y1=crop_y1,
                x2=crop_x1 + crop_width,
                y2=crop_y1 + crop_height,
                width=crop_width,
                height=crop_height,
            )

        return crops


class FaceClusterer:
    """Face clustering using embeddings."""

    def __init__(self, method: str = 'dbscan'):
        self.method = method
        self.labels = None
        self.embeddings = None

    def cluster(
        self,
        embeddings: List[np.ndarray],
        eps: float = 0.5,
        min_samples: int = 2
    ) -> np.ndarray:
        """
        Cluster face embeddings.

        Args:
            embeddings: List of 512-dim face embeddings
            eps: DBSCAN epsilon (distance threshold)
            min_samples: Minimum samples per cluster

        Returns:
            Array of cluster labels (-1 = unclustered)
        """
        from sklearn.cluster import DBSCAN, AgglomerativeClustering
        from sklearn.metrics.pairwise import cosine_distances

        if not embeddings:
            return np.array([])

        self.embeddings = np.array(embeddings)
        distances = cosine_distances(self.embeddings)

        if self.method == 'dbscan':
            clusterer = DBSCAN(
                eps=eps,
                min_samples=min_samples,
                metric='precomputed'
            )
            self.labels = clusterer.fit_predict(distances)
        elif self.method == 'agglomerative':
            clusterer = AgglomerativeClustering(
                n_clusters=None,
                distance_threshold=eps,
                metric='precomputed',
                linkage='average'
            )
            self.labels = clusterer.fit_predict(distances)
        else:
            self.labels = np.zeros(len(embeddings), dtype=int)

        return self.labels

    def get_cluster_info(self) -> Dict[str, Dict]:
        """Get information about each cluster."""
        if self.labels is None:
            return {}

        unique_labels = set(self.labels)
        info = {}

        for label in unique_labels:
            name = 'unclustered' if label == -1 else f'person_{label}'
            mask = self.labels == label
            info[name] = {
                'count': int(np.sum(mask)),
                'indices': np.where(mask)[0].tolist()
            }

        return info


@dataclass
class AudioEvent:
    """Represents an audio event detected in the video."""
    start_time: float
    end_time: float
    event_type: str  # 'speech', 'music', 'applause', 'silence'
    confidence: float
    intensity: float  # 0-1, relative loudness/energy

    def to_dict(self) -> dict:
        return asdict(self)


class AudioAnalyzer:
    """
    Audio analysis for detecting speech, music, applause, and energy peaks.

    Uses librosa for audio feature extraction and simple classification
    based on spectral characteristics.
    """

    def __init__(self):
        self.audio = None
        self.sr = None
        self.duration = None
        self.events = []
        self.energy_curve = None

    def extract_audio(self, video_path: str, output_path: str = None) -> Optional[str]:
        """
        Extract audio track from video using FFmpeg.

        Args:
            video_path: Path to video file
            output_path: Optional output path for audio file

        Returns:
            Path to extracted audio file, or None if extraction failed
        """
        import subprocess
        import tempfile

        if output_path is None:
            temp_dir = tempfile.mkdtemp()
            output_path = os.path.join(temp_dir, 'audio.wav')

        cmd = [
            'ffmpeg', '-y',
            '-i', video_path,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # PCM format
            '-ar', '22050',  # 22kHz sample rate (good for speech/music)
            '-ac', '1',  # Mono
            output_path
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0 and os.path.exists(output_path):
                return output_path
            else:
                logger.warning(f"Audio extraction failed: {result.stderr}")
                return None
        except subprocess.TimeoutExpired:
            logger.warning("Audio extraction timed out")
            return None
        except Exception as e:
            logger.warning(f"Audio extraction error: {e}")
            return None

    def load_audio(self, audio_path: str) -> bool:
        """
        Load audio file for analysis.

        Args:
            audio_path: Path to audio file (WAV preferred)

        Returns:
            True if loaded successfully
        """
        try:
            import librosa
            self.audio, self.sr = librosa.load(audio_path, sr=22050, mono=True)
            self.duration = len(self.audio) / self.sr
            logger.info(f"Loaded audio: {self.duration:.2f}s at {self.sr}Hz")
            return True
        except ImportError:
            logger.warning("librosa not available for audio analysis")
            return False
        except Exception as e:
            logger.warning(f"Failed to load audio: {e}")
            return False

    def analyze(self, video_path: str, hop_length: int = 512) -> List[AudioEvent]:
        """
        Analyze audio track for speech, music, and applause.

        Args:
            video_path: Path to video file
            hop_length: FFT hop length for analysis

        Returns:
            List of AudioEvent objects
        """
        # Extract audio from video
        audio_path = self.extract_audio(video_path)
        if audio_path is None:
            logger.warning("Could not extract audio, skipping audio analysis")
            return []

        if not self.load_audio(audio_path):
            return []

        try:
            import librosa
            import scipy.signal as signal

            events = []

            # Frame parameters
            frame_length = 2048
            hop_length = hop_length

            # Compute spectral features
            # RMS energy (loudness)
            rms = librosa.feature.rms(y=self.audio, frame_length=frame_length, hop_length=hop_length)[0]
            rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=self.sr, hop_length=hop_length)

            # Spectral centroid (brightness - music tends to be brighter)
            spectral_centroid = librosa.feature.spectral_centroid(
                y=self.audio, sr=self.sr, hop_length=hop_length
            )[0]

            # Zero crossing rate (speech/applause have higher ZCR)
            zcr = librosa.feature.zero_crossing_rate(self.audio, hop_length=hop_length)[0]

            # Spectral rolloff (frequency below which X% of energy is concentrated)
            rolloff = librosa.feature.spectral_rolloff(y=self.audio, sr=self.sr, hop_length=hop_length)[0]

            # Spectral bandwidth (spread of frequencies - applause is spread out)
            bandwidth = librosa.feature.spectral_bandwidth(y=self.audio, sr=self.sr, hop_length=hop_length)[0]

            # MFCCs (for speech detection - speech has characteristic MFCC patterns)
            mfccs = librosa.feature.mfcc(y=self.audio, sr=self.sr, n_mfcc=13, hop_length=hop_length)

            # Normalize features
            rms_norm = rms / (np.max(rms) + 1e-8)
            centroid_norm = spectral_centroid / (np.max(spectral_centroid) + 1e-8)
            zcr_norm = zcr / (np.max(zcr) + 1e-8)
            bandwidth_norm = bandwidth / (np.max(bandwidth) + 1e-8)

            # Store energy curve for peak detection
            self.energy_curve = list(zip(rms_times.tolist(), rms_norm.tolist()))

            # Classify audio frames into events using heuristics
            # Window size for smoothing (in frames)
            window = 10

            # Smooth features
            rms_smooth = np.convolve(rms_norm, np.ones(window)/window, mode='same')
            centroid_smooth = np.convolve(centroid_norm, np.ones(window)/window, mode='same')
            zcr_smooth = np.convolve(zcr_norm, np.ones(window)/window, mode='same')
            bandwidth_smooth = np.convolve(bandwidth_norm, np.ones(window)/window, mode='same')

            # Thresholds (tuned for wedding audio)
            silence_threshold = 0.05
            speech_zcr_min = 0.2
            speech_zcr_max = 0.6
            music_centroid_threshold = 0.4
            applause_bandwidth_threshold = 0.5

            # Segment analysis (1-second windows)
            segment_frames = int(self.sr / hop_length)  # frames per second
            num_segments = len(rms_smooth) // segment_frames

            current_event = None

            for seg_idx in range(num_segments):
                start_frame = seg_idx * segment_frames
                end_frame = min((seg_idx + 1) * segment_frames, len(rms_smooth))

                seg_rms = np.mean(rms_smooth[start_frame:end_frame])
                seg_centroid = np.mean(centroid_smooth[start_frame:end_frame])
                seg_zcr = np.mean(zcr_smooth[start_frame:end_frame])
                seg_bandwidth = np.mean(bandwidth_smooth[start_frame:end_frame])

                seg_start_time = rms_times[start_frame] if start_frame < len(rms_times) else 0
                seg_end_time = rms_times[min(end_frame, len(rms_times)-1)] if end_frame > 0 else 0

                # Classify segment
                if seg_rms < silence_threshold:
                    event_type = 'silence'
                    confidence = 1.0 - seg_rms / silence_threshold
                elif seg_bandwidth > applause_bandwidth_threshold and seg_zcr > 0.4:
                    # Applause: broadband noise with high ZCR
                    event_type = 'applause'
                    confidence = min(seg_bandwidth, seg_zcr)
                elif speech_zcr_min < seg_zcr < speech_zcr_max and seg_centroid < music_centroid_threshold:
                    # Speech: moderate ZCR, lower centroid
                    event_type = 'speech'
                    confidence = 1.0 - abs(seg_zcr - 0.4)
                elif seg_centroid > music_centroid_threshold and seg_rms > 0.2:
                    # Music: high centroid (bright), sustained energy
                    event_type = 'music'
                    confidence = seg_centroid
                else:
                    event_type = 'other'
                    confidence = 0.5

                # Merge consecutive same-type events
                if current_event and current_event.event_type == event_type:
                    current_event.end_time = seg_end_time
                    current_event.confidence = (current_event.confidence + confidence) / 2
                    current_event.intensity = max(current_event.intensity, seg_rms)
                else:
                    if current_event and current_event.event_type != 'silence':
                        events.append(current_event)

                    current_event = AudioEvent(
                        start_time=seg_start_time,
                        end_time=seg_end_time,
                        event_type=event_type,
                        confidence=float(confidence),
                        intensity=float(seg_rms)
                    )

            # Add last event
            if current_event and current_event.event_type != 'silence':
                events.append(current_event)

            self.events = events
            logger.info(f"Detected {len(events)} audio events")

            # Clean up temp audio file
            try:
                os.remove(audio_path)
                os.rmdir(os.path.dirname(audio_path))
            except:
                pass

            return events

        except ImportError:
            logger.warning("librosa not available")
            return []
        except Exception as e:
            logger.error(f"Audio analysis failed: {e}")
            return []

    def get_energy_at_timestamp(self, timestamp: float) -> float:
        """Get audio energy at a specific timestamp."""
        if not self.energy_curve:
            return 0.0

        # Binary search for closest time
        times = [t for t, _ in self.energy_curve]
        idx = np.searchsorted(times, timestamp)

        if idx == 0:
            return self.energy_curve[0][1]
        if idx >= len(self.energy_curve):
            return self.energy_curve[-1][1]

        return self.energy_curve[idx][1]

    def get_event_at_timestamp(self, timestamp: float) -> Optional[AudioEvent]:
        """Get audio event at a specific timestamp."""
        for event in self.events:
            if event.start_time <= timestamp <= event.end_time:
                return event
        return None

    def get_peak_timestamps(self, threshold: float = 0.7, min_distance_sec: float = 2.0) -> List[float]:
        """
        Find timestamps with audio energy peaks.

        Args:
            threshold: Minimum energy threshold (0-1)
            min_distance_sec: Minimum distance between peaks in seconds

        Returns:
            List of peak timestamps
        """
        if not self.energy_curve:
            return []

        times = np.array([t for t, _ in self.energy_curve])
        energies = np.array([e for _, e in self.energy_curve])

        # Find local maxima
        from scipy.signal import find_peaks

        # Convert min_distance to samples
        time_step = times[1] - times[0] if len(times) > 1 else 0.1
        min_distance_samples = int(min_distance_sec / time_step)

        peaks, properties = find_peaks(
            energies,
            height=threshold,
            distance=min_distance_samples
        )

        peak_times = times[peaks].tolist()
        logger.info(f"Found {len(peak_times)} audio peaks above threshold {threshold}")

        return peak_times

    def is_audio_peak(self, timestamp: float, window_sec: float = 0.5, threshold: float = 0.6) -> bool:
        """Check if timestamp is near an audio peak."""
        peak_times = self.get_peak_timestamps(threshold=threshold)

        for peak_time in peak_times:
            if abs(peak_time - timestamp) < window_sec:
                return True

        return False


def classify_frame_category(faces: List[Dict], tags: List[str], image_width: int = 1920, image_height: int = 1080) -> str:
    """
    Classify frame into one of 4 categories.

    Categories:
    - people_face: Clear visible faces (good size, not too small)
    - people_roll: People without visible faces (back of head, hands, silhouette)
    - broll: Scenic shots, no people (landscape, venue, sky)
    - detail: Close-up objects (rings, flowers, cake, dress details)

    Args:
        faces: List of detected face dicts with bbox
        tags: RAM++ tags for the image
        image_width: Frame width for size calculations
        image_height: Frame height for size calculations

    Returns:
        Category string: 'people_face', 'people_roll', 'broll', 'detail'
    """
    tags_lower = [t.lower() for t in tags]
    tags_str = ' '.join(tags_lower)

    # Detail indicators (close-up objects)
    detail_keywords = [
        'ring', 'rings', 'wedding ring', 'jewelry', 'diamond',
        'flower', 'flowers', 'bouquet', 'floral',
        'cake', 'wedding cake', 'dessert',
        'dress', 'wedding dress', 'gown', 'veil',
        'shoes', 'heels', 'shoe',
        'invitation', 'stationery', 'card',
        'table setting', 'place setting', 'centerpiece',
        'candle', 'candles', 'decoration',
        'tie', 'bow tie', 'cufflinks', 'watch',
        'food', 'champagne', 'wine glass',
    ]

    # People indicators (without face)
    people_keywords = [
        'person', 'people', 'man', 'woman', 'couple',
        'hand', 'hands', 'holding hands',
        'back', 'shoulder', 'shoulders',
        'silhouette', 'shadow',
        'walking', 'dancing', 'standing',
        'bride', 'groom', 'bridesmaid', 'groomsman',
        'guest', 'guests', 'crowd', 'audience',
    ]

    # B-roll indicators (scenic, no people)
    broll_keywords = [
        'landscape', 'outdoor', 'outdoors', 'nature',
        'venue', 'building', 'architecture', 'church',
        'sky', 'sunset', 'sunrise', 'clouds',
        'tree', 'trees', 'garden', 'park',
        'interior', 'room', 'hall', 'ballroom',
        'water', 'lake', 'ocean', 'fountain',
        'sign', 'entrance', 'door', 'window',
    ]

    # Check for faces first
    if faces and len(faces) > 0:
        # Calculate average face size as % of frame
        frame_area = image_width * image_height
        total_face_area = 0
        valid_faces = 0

        for face in faces:
            bbox = face.get('bbox', [0, 0, 0, 0])
            if len(bbox) >= 4:
                face_width = bbox[2] - bbox[0]
                face_height = bbox[3] - bbox[1]
                face_area = face_width * face_height
                if face_area > 0:
                    total_face_area += face_area
                    valid_faces += 1

        if valid_faces > 0:
            avg_face_pct = (total_face_area / valid_faces) / frame_area * 100

            # Face is "visible" if it's at least 0.5% of frame
            # (roughly 100x100 pixels on 1080p)
            if avg_face_pct >= 0.5:
                return 'people_face'

    # No clear faces - check tags for category
    # Priority: detail > people_roll > broll

    # Check for detail shots
    for keyword in detail_keywords:
        if keyword in tags_str:
            return 'detail'

    # Check for people without faces
    for keyword in people_keywords:
        if keyword in tags_str:
            return 'people_roll'

    # Check for scenic/broll
    for keyword in broll_keywords:
        if keyword in tags_str:
            return 'broll'

    # Default: if no faces and no clear tags, assume broll
    return 'broll'


class VarietySelector:
    """
    Selects the BEST frames per scene, not just any frame that passes.

    Strategy:
    - Group frames by scene
    - Score each frame by quality metrics
    - Select top 1-3 frames per scene with category diversity
    - Hard cap to avoid overwhelming output
    """

    def __init__(self):
        self.seen_faces = set()  # Face cluster IDs already selected
        self.seen_compositions = {}  # scene_index -> set of composition types
        self.min_timestamp_gap = 1.0  # Minimum seconds between frames from same scene

    def classify_composition(self, candidate: Dict) -> str:
        """
        Classify frame composition as 'close', 'medium', or 'wide'.

        Uses face bbox size relative to frame as proxy for shot type.
        """
        faces = candidate.get('faces', [])

        if not faces:
            # B-roll - classify by tag hints
            tags = candidate.get('tags', [])
            tag_str = ' '.join(tags).lower()

            if any(w in tag_str for w in ['landscape', 'outdoor', 'venue', 'building', 'sky']):
                return 'wide'
            elif any(w in tag_str for w in ['detail', 'close', 'flower', 'ring', 'food']):
                return 'close'
            return 'medium'

        # Calculate average face size as fraction of frame
        total_face_area = 0
        for face in faces:
            bbox = face.get('bbox', [0, 0, 0, 0])
            if len(bbox) >= 4:
                width = bbox[2] - bbox[0]
                height = bbox[3] - bbox[1]
                total_face_area += width * height

        # Heuristic based on face area (assuming ~1080p frames)
        # Large face = close-up, medium = medium shot, small = wide
        avg_face_area = total_face_area / len(faces)

        if avg_face_area > 100000:  # ~316x316 pixels
            return 'close'
        elif avg_face_area > 30000:  # ~173x173 pixels
            return 'medium'
        else:
            return 'wide'

    def get_face_clusters(self, candidate: Dict) -> set:
        """Get set of face cluster IDs in this candidate."""
        clusters = set()
        cluster_labels = candidate.get('cluster_labels', {})

        for face_key, cluster_id in cluster_labels.items():
            if cluster_id >= 0:  # -1 is unclustered
                clusters.add(cluster_id)

        return clusters

    def should_keep(self, candidate: Dict, all_selected: List[Dict]) -> tuple:
        """
        Determine if a candidate should be kept for variety.

        Returns:
            (should_keep: bool, reasons: List[str])
        """
        reasons = []
        scene_idx = candidate.get('scene_index', 0)
        timestamp = candidate.get('timestamp', 0)

        # Check minimum timestamp gap for same scene
        same_scene_timestamps = [
            s.get('timestamp', 0) for s in all_selected
            if s.get('scene_index') == scene_idx
        ]
        if same_scene_timestamps:
            min_gap = min(abs(timestamp - t) for t in same_scene_timestamps)
            if min_gap < self.min_timestamp_gap:
                return False, ['too_close_to_existing']

        # Criterion 1: New faces
        face_clusters = self.get_face_clusters(candidate)
        new_faces = face_clusters - self.seen_faces
        if new_faces:
            reasons.append(f'new_faces:{list(new_faces)}')

        # Criterion 2: Different composition for this scene
        composition = self.classify_composition(candidate)
        scene_compositions = self.seen_compositions.get(scene_idx, set())
        if composition not in scene_compositions:
            reasons.append(f'new_composition:{composition}')

        # Criterion 3: High smile score
        max_smile = candidate.get('max_smile_score', 0)
        faces = candidate.get('faces', [])
        if faces:
            max_smile = max((f.get('smile_score', 0) or 0) for f in faces)
        if max_smile > 0.6:
            reasons.append(f'high_smile:{max_smile:.2f}')

        # Criterion 4: Audio peak
        if candidate.get('is_audio_peak', False):
            audio_type = candidate.get('audio_type', 'unknown')
            reasons.append(f'audio_peak:{audio_type}')

        # Criterion 5: Interesting audio moment (applause, cheering during speech)
        audio_type = candidate.get('audio_type')
        if audio_type in ['applause', 'music']:
            audio_intensity = candidate.get('audio_intensity', 0)
            if audio_intensity > 0.5:
                reasons.append(f'audio_moment:{audio_type}')

        # Criterion 6: High sharpness (very sharp frames are worth keeping)
        sharpness = candidate.get('sharpness_score', 0)
        if sharpness > 500:  # Very sharp
            reasons.append(f'very_sharp:{sharpness:.0f}')

        # Criterion 7: B-roll variety
        is_broll = candidate.get('is_broll', False)
        if is_broll:
            tags = set(candidate.get('tags', []))
            # Check if we have similar b-roll already
            similar_broll = False
            for selected in all_selected:
                if selected.get('is_broll', False):
                    selected_tags = set(selected.get('tags', []))
                    overlap = len(tags & selected_tags) / max(len(tags | selected_tags), 1)
                    if overlap > 0.5:  # >50% tag overlap
                        similar_broll = True
                        break
            if not similar_broll and tags:
                reasons.append(f'unique_broll:{list(tags)[:3]}')

        # Keep if any reason found
        return len(reasons) > 0, reasons

    def update_state(self, candidate: Dict):
        """Update selector state after keeping a candidate."""
        # Track seen faces
        self.seen_faces.update(self.get_face_clusters(candidate))

        # Track seen compositions per scene
        scene_idx = candidate.get('scene_index', 0)
        if scene_idx not in self.seen_compositions:
            self.seen_compositions[scene_idx] = set()
        self.seen_compositions[scene_idx].add(self.classify_composition(candidate))

    def compute_quality_score(self, candidate: Dict) -> float:
        """
        Compute overall quality score for a frame.

        Score components:
        - Sharpness (normalized to 0-1)
        - Smile score (0-1)
        - Audio peak bonus
        - Face count bonus (more faces = more interesting)
        """
        # Sharpness: normalize assuming 50-500 range
        sharpness = candidate.get('sharpness_score', 0)
        sharpness_norm = min(1.0, max(0, (sharpness - 50) / 450))

        # Smile score
        faces = candidate.get('faces', [])
        smile = 0.0
        if faces:
            smile_scores = [(f.get('smile_score') or 0) for f in faces]
            smile = max(smile_scores) if smile_scores else 0

        # Audio peak bonus
        audio_boost = 0.2 if candidate.get('is_audio_peak') else 0

        # Face count bonus (slight boost for group shots)
        face_boost = min(0.15, len(faces) * 0.05) if faces else 0

        return sharpness_norm * 0.4 + smile * 0.3 + audio_boost + face_boost

    def select(
        self,
        candidates: List[Dict],
        min_per_scene: int = 1,
        max_per_scene: int = 3
    ) -> List[Dict]:
        """
        Select the BEST frames per scene with category diversity.

        Strategy:
        1. Group candidates by scene
        2. Within each scene, score all frames
        3. Select top frames ensuring category diversity
        4. Hard cap at max_per_scene

        Args:
            candidates: List of candidate frames
            min_per_scene: Minimum frames per scene
            max_per_scene: HARD maximum per scene (default 3)

        Returns:
            List of selected candidates with 'selection_reasons' added
        """
        # Group by scene
        scenes = {}
        for candidate in candidates:
            scene_idx = candidate.get('scene_index', 0)
            if scene_idx not in scenes:
                scenes[scene_idx] = []
            scenes[scene_idx].append(candidate)

        selected = []

        for scene_idx, scene_candidates in scenes.items():
            # Score all candidates in this scene
            for c in scene_candidates:
                c['_quality_score'] = self.compute_quality_score(c)

            # Sort by quality score
            scene_candidates.sort(key=lambda x: x['_quality_score'], reverse=True)

            # Group by category within scene
            by_category = {}
            for c in scene_candidates:
                cat = c.get('frame_category', 'broll')
                if cat not in by_category:
                    by_category[cat] = []
                by_category[cat].append(c)

            scene_selected = []
            selected_timestamps = []

            # Strategy: Pick best from each category present, up to max_per_scene
            # Priority: people_face > people_roll > detail > broll
            category_priority = ['people_face', 'people_roll', 'detail', 'broll']

            for category in category_priority:
                if len(scene_selected) >= max_per_scene:
                    break

                if category not in by_category:
                    continue

                for candidate in by_category[category]:
                    if len(scene_selected) >= max_per_scene:
                        break

                    # Check timestamp gap
                    timestamp = candidate.get('timestamp', 0)
                    too_close = any(
                        abs(timestamp - t) < self.min_timestamp_gap
                        for t in selected_timestamps
                    )
                    if too_close:
                        continue

                    # Select this frame
                    candidate['selection_reasons'] = [
                        f'best_{category}',
                        f'score:{candidate["_quality_score"]:.2f}'
                    ]
                    scene_selected.append(candidate)
                    selected_timestamps.append(timestamp)

                    # Only take 1 from each category (variety)
                    break

            # If we don't have minimum, add more regardless of category
            if len(scene_selected) < min_per_scene:
                for candidate in scene_candidates:
                    if len(scene_selected) >= min_per_scene:
                        break
                    if candidate in scene_selected:
                        continue

                    timestamp = candidate.get('timestamp', 0)
                    too_close = any(
                        abs(timestamp - t) < self.min_timestamp_gap
                        for t in selected_timestamps
                    )
                    if too_close:
                        continue

                    candidate['selection_reasons'] = ['scene_coverage']
                    scene_selected.append(candidate)
                    selected_timestamps.append(timestamp)

            selected.extend(scene_selected)

        # Clean up temp scores
        for c in selected:
            c.pop('_quality_score', None)

        # Log stats
        category_counts = {}
        for c in selected:
            cat = c.get('frame_category', 'unknown')
            category_counts[cat] = category_counts.get(cat, 0) + 1

        logger.info(f"Variety selection: {len(selected)}/{len(candidates)} frames selected")
        logger.info(f"By category: {category_counts}")
        logger.info(f"Scenes covered: {len(scenes)}")

        return selected


class ScreenshotPipeline:
    """
    Complete pipeline for screenshot extraction and analysis.
    """

    def __init__(self, device: str = None):
        self.device = device or get_device()
        self.models_loaded = False

        # Initialize components
        self.scene_detector = SceneDetector(self.device)
        self.quality_filter = QualityFilter()
        self.face_detector = FaceDetector(self.device)
        self.tagger = ContentTagger(self.device)
        self.cropper = SmartCropper()
        self.clusterer = FaceClusterer()
        self.audio_analyzer = AudioAnalyzer()
        self.variety_selector = VarietySelector()

    def load_models(self, ram_model_path: str = None):
        """Load all ML models."""
        if self.models_loaded:
            return

        logger.info("Loading models...")

        self.scene_detector.load()
        self.face_detector.load()
        self.tagger.load(ram_model_path)
        self.cropper.load()

        self.models_loaded = True
        logger.info("All models loaded")

    def extract_frames(
        self,
        video_path: str,
        scenes: List[tuple],
        output_dir: str,
        fps: float = None,
        lut_path: str = None,
        sample_interval: float = 0.5
    ) -> List[Dict]:
        """
        Extract candidate frames from each scene.

        When a LUT is provided, extracts TWO versions:
        - preview/ folder: LUT-graded frames for ML analysis
        - raw/ folder: Original LOG/RAW frames for final export

        Args:
            video_path: Path to video file
            scenes: List of (start_frame, end_frame) tuples
            output_dir: Directory to save frames
            fps: Video FPS (auto-detected if None)
            lut_path: Optional path to LUT file for LOG footage
            sample_interval: Seconds between frame samples (default 0.5s)
        """
        import subprocess

        os.makedirs(output_dir, exist_ok=True)

        cap = cv2.VideoCapture(video_path)
        if fps is None:
            fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        frames_info = []

        # Collect all frame numbers to extract
        frame_numbers = []
        frame_to_scene = {}

        # Calculate frame interval from sample_interval
        frame_interval = max(1, int(fps * sample_interval))

        for scene_idx, (start, end) in enumerate(scenes):
            scene_length = end - start
            scene_duration = scene_length / fps

            # Skip very short scenes (< 0.3 seconds)
            if scene_duration < 0.3:
                continue

            # Extract frames at regular intervals throughout the scene
            # Plus key positions (start, middle, end)
            candidates = set()

            # Always get start (offset by a few frames to avoid transition)
            offset = min(3, scene_length // 4)
            candidates.add(start + offset)

            # Always get middle
            candidates.add((start + end) // 2)

            # Always get near-end
            candidates.add(end - offset)

            # Sample at regular intervals for longer scenes
            if scene_duration > 1.0:
                current = start + offset
                while current < end - offset:
                    candidates.add(current)
                    current += frame_interval

            # Add all valid candidates
            for frame_num in sorted(candidates):
                if frame_num < 0 or frame_num >= total_frames:
                    continue
                if frame_num not in frame_to_scene:
                    frame_numbers.append(frame_num)
                    frame_to_scene[frame_num] = scene_idx

        # Extract frames
        if lut_path and os.path.exists(lut_path):
            # Extract BOTH: LUT preview for analysis + RAW for final export
            logger.info(f"Extracting frames with LUT (preview) and RAW (export)")

            preview_dir = os.path.join(output_dir, 'preview')
            raw_dir = os.path.join(output_dir, 'raw')
            os.makedirs(preview_dir, exist_ok=True)
            os.makedirs(raw_dir, exist_ok=True)

            # Extract LUT-graded previews for ML analysis
            frames_info = self._extract_frames_ffmpeg_dual(
                video_path, frame_numbers, frame_to_scene,
                preview_dir, raw_dir, fps, lut_path
            )
        else:
            if lut_path:
                logger.warning(f"LUT file not found: {lut_path}, extracting without LUT")
            frames_info = self._extract_frames_opencv(
                video_path, frame_numbers, frame_to_scene,
                output_dir, fps
            )

        return frames_info

    def _extract_frames_opencv(
        self,
        video_path: str,
        frame_numbers: List[int],
        frame_to_scene: Dict[int, int],
        output_dir: str,
        fps: float
    ) -> List[Dict]:
        """Extract frames using OpenCV (no LUT)."""
        cap = cv2.VideoCapture(video_path)
        frames_info = []

        for frame_num in frame_numbers:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            ret, frame = cap.read()

            if not ret or frame is None:
                continue

            frame_filename = f"frame_{frame_num:08d}.jpg"
            frame_path = os.path.join(output_dir, frame_filename)
            cv2.imwrite(frame_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])

            frames_info.append({
                'frame_number': frame_num,
                'timestamp': frame_num / fps,
                'path': frame_path,
                'scene_index': frame_to_scene[frame_num]
            })

        cap.release()
        return frames_info

    def _extract_frames_ffmpeg_dual(
        self,
        video_path: str,
        frame_numbers: List[int],
        frame_to_scene: Dict[int, int],
        preview_dir: str,
        raw_dir: str,
        fps: float,
        lut_path: str
    ) -> List[Dict]:
        """
        Extract frames using FFmpeg - both LUT preview and RAW versions.

        Args:
            video_path: Source video
            frame_numbers: Frames to extract
            frame_to_scene: Mapping of frame number to scene index
            preview_dir: Output dir for LUT-graded previews (used for ML)
            raw_dir: Output dir for RAW/LOG frames (used for final export)
            fps: Video FPS
            lut_path: Path to LUT file

        Returns:
            List of frame info dicts with both 'path' (preview) and 'raw_path'
        """
        import subprocess

        frames_info = []

        for frame_num in frame_numbers:
            timestamp = frame_num / fps
            frame_filename = f"frame_{frame_num:08d}.jpg"
            preview_path = os.path.join(preview_dir, frame_filename)
            raw_path = os.path.join(raw_dir, frame_filename)

            # Extract RAW frame (no LUT) - full quality for final export
            raw_cmd = [
                'ffmpeg', '-y',
                '-ss', str(timestamp),
                '-i', video_path,
                '-vframes', '1',
                '-q:v', '1',  # Highest quality JPEG
                raw_path
            ]

            # Extract LUT preview frame (for ML analysis)
            preview_cmd = [
                'ffmpeg', '-y',
                '-ss', str(timestamp),
                '-i', video_path,
                '-vframes', '1',
                '-vf', f"lut3d='{lut_path}'",
                '-q:v', '2',  # High quality JPEG
                preview_path
            ]

            try:
                # Extract both in sequence
                raw_result = subprocess.run(
                    raw_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                preview_result = subprocess.run(
                    preview_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                raw_ok = raw_result.returncode == 0 and os.path.exists(raw_path)
                preview_ok = preview_result.returncode == 0 and os.path.exists(preview_path)

                if preview_ok:
                    frame_info = {
                        'frame_number': frame_num,
                        'timestamp': timestamp,
                        'path': preview_path,  # LUT preview for ML analysis
                        'scene_index': frame_to_scene[frame_num]
                    }

                    if raw_ok:
                        frame_info['raw_path'] = raw_path  # RAW for final export

                    frames_info.append(frame_info)
                else:
                    logger.warning(f"FFmpeg failed for frame {frame_num}")

            except subprocess.TimeoutExpired:
                logger.warning(f"FFmpeg timeout for frame {frame_num}")
            except Exception as e:
                logger.warning(f"FFmpeg error for frame {frame_num}: {e}")

        return frames_info

    def compute_sharpness_scores(self, frames_info: List[Dict]) -> List[Dict]:
        """Compute sharpness scores for all frames (mutates frames_info)."""
        for frame in frames_info:
            if 'sharpness_score' not in frame:
                frame['sharpness_score'] = self.quality_filter.compute_sharpness_from_path(frame['path'])
        return frames_info

    def filter_by_quality(
        self,
        frames_info: List[Dict],
        sharpness_threshold: float = 100.0
    ) -> List[Dict]:
        """Filter frames by sharpness (assumes sharpness_score already computed)."""
        filtered = []

        for frame in frames_info:
            # Compute if not already done
            if 'sharpness_score' not in frame:
                frame['sharpness_score'] = self.quality_filter.compute_sharpness_from_path(frame['path'])

            if frame['sharpness_score'] >= sharpness_threshold:
                filtered.append(frame)

        logger.info(f"Quality filter: {len(filtered)}/{len(frames_info)} passed")
        return filtered

    def run(
        self,
        video_path: str,
        output_dir: str,
        options: Dict = None,
        on_progress: Callable[[int, str], None] = None
    ) -> List[Dict]:
        """
        Run the full pipeline.

        Args:
            video_path: Path to video file
            output_dir: Directory for output
            options: Pipeline options
            on_progress: Progress callback (percent, message)

        Returns:
            List of candidate frame results
        """
        options = options or {}

        def progress(pct: int, msg: str):
            if on_progress:
                on_progress(pct, msg)
            logger.info(f"[{pct}%] {msg}")

        # Ensure models are loaded
        progress(5, "Loading models...")
        self.load_models(options.get('ram_model_path'))

        # Create output directories
        frames_dir = os.path.join(output_dir, 'frames')
        os.makedirs(frames_dir, exist_ok=True)

        # Phase 1: Scene Detection
        progress(10, "Detecting scenes...")
        scenes = self.scene_detector.detect(video_path)
        logger.info(f"Found {len(scenes)} scenes")

        # Phase 2: Frame Extraction
        # Sample every 1.5 seconds (not 0.5) to reduce initial candidates
        progress(20, "Extracting frames...")
        lut_path = options.get('lut_path')
        sample_interval = options.get('sample_interval', 1.5)
        frames_info = self.extract_frames(
            video_path, scenes, frames_dir,
            lut_path=lut_path,
            sample_interval=sample_interval
        )
        logger.info(f"Extracted {len(frames_info)} candidate frames")

        # Phase 3: Quality Filtering
        # Sharpness 50 = reasonable for S-Log/LOG footage (appears softer before grading)
        # Sharpness scores typically range 50-150 for wedding footage
        progress(30, "Filtering by quality...")

        # Compute sharpness for ALL frames first (needed for fallback)
        self.compute_sharpness_scores(frames_info)
        all_frames_with_sharpness = frames_info.copy()

        sharpness_threshold = options.get('sharpness_threshold', 50.0)
        frames_info = self.filter_by_quality(
            frames_info,
            sharpness_threshold=sharpness_threshold
        )

        # Fallback: If no frames pass, guarantee at least 1 (best available)
        if not frames_info and all_frames_with_sharpness:
            logger.info("No frames passed threshold, selecting best available frame(s)")
            # Sort by sharpness and take top frames
            sorted_frames = sorted(
                all_frames_with_sharpness,
                key=lambda f: f.get('sharpness_score', 0),
                reverse=True
            )
            # Take best 1-3 frames depending on video length
            num_fallback = min(3, max(1, len(sorted_frames) // 5))
            frames_info = sorted_frames[:num_fallback]
            logger.info(f"Fallback: kept {len(frames_info)} best frames (sharpness: {frames_info[0].get('sharpness_score', 0):.1f})")

        if not frames_info:
            logger.warning("No frames available")
            return []

        # Phase 3.5: Audio Analysis
        audio_events = []
        if options.get('analyze_audio', True):
            progress(35, "Analyzing audio...")
            audio_events = self.audio_analyzer.analyze(video_path)
            logger.info(f"Found {len(audio_events)} audio events")

        # Phases 4-8: Analyze each frame
        candidates = []
        total_frames = len(frames_info)
        all_embeddings = []
        embedding_map = []  # (candidate_idx, face_idx)

        for i, frame in enumerate(frames_info):
            pct = 40 + int((i / total_frames) * 50)
            progress(pct, f"Analyzing frame {i+1}/{total_frames}")

            # Face detection
            faces = self.face_detector.detect(frame['path'])

            # Tagging (do early for category classification)
            tags = self.tagger.tag(frame['path'])

            # Classify into 4 categories
            frame_category = classify_frame_category(
                [f.to_dict() if isinstance(f, FaceData) else f for f in faces],
                tags
            )
            is_broll = frame_category in ['broll', 'detail']

            # Collect embeddings for clustering
            for face_idx, face in enumerate(faces):
                if face.embedding:
                    all_embeddings.append(np.array(face.embedding))
                    embedding_map.append((len(candidates), face_idx))

            # Smart cropping
            crops = self.cropper.generate_crops(frame['path'], faces)

            # Audio analysis for this frame
            timestamp = frame['timestamp']
            audio_event = self.audio_analyzer.get_event_at_timestamp(timestamp)
            is_audio_peak = self.audio_analyzer.is_audio_peak(timestamp, threshold=0.6)
            audio_type = audio_event.event_type if audio_event else None
            audio_intensity = self.audio_analyzer.get_energy_at_timestamp(timestamp)

            # Build candidate
            candidate = FrameCandidate(
                frame_number=frame['frame_number'],
                timestamp=timestamp,
                image_path=frame['path'],  # LUT preview for display/ML
                sharpness_score=frame.get('sharpness_score', 0.0),
                raw_path=frame.get('raw_path'),  # Original LOG/RAW for final export
                faces=[f.to_dict() if isinstance(f, FaceData) else f for f in faces],
                tags=tags,
                crops={k: v.to_dict() if isinstance(v, CropCoordinates) else v for k, v in crops.items()},
                is_broll=is_broll,
                scene_index=frame.get('scene_index', 0),
            )

            # Add audio data and category to candidate dict
            candidate_dict = candidate.to_dict()
            candidate_dict['is_audio_peak'] = is_audio_peak
            candidate_dict['audio_type'] = audio_type
            candidate_dict['audio_intensity'] = audio_intensity
            candidate_dict['frame_category'] = frame_category

            candidates.append(candidate_dict)

        # Phase 10: Face Clustering
        progress(92, "Clustering faces...")
        if all_embeddings:
            cluster_labels = self.clusterer.cluster(
                all_embeddings,
                eps=options.get('cluster_eps', 0.5),
                min_samples=options.get('cluster_min_samples', 2)
            )

            # Map cluster labels back to candidates
            for i, (cand_idx, face_idx) in enumerate(embedding_map):
                label = int(cluster_labels[i])
                face_key = f"face_{face_idx}"
                if 'cluster_labels' not in candidates[cand_idx]:
                    candidates[cand_idx]['cluster_labels'] = {}
                candidates[cand_idx]['cluster_labels'][face_key] = label

            cluster_info = self.clusterer.get_cluster_info()
            logger.info(f"Found {len(cluster_info)} face clusters")

        # Phase 11: Variety Selection
        # Select BEST frames per scene with category diversity (hard cap)
        progress(95, "Selecting best frames...")
        if options.get('select_variety', True):  # Enabled by default
            selected_candidates = self.variety_selector.select(
                candidates,
                min_per_scene=options.get('min_per_scene', 1),   # At least 1 per scene
                max_per_scene=options.get('max_per_scene', 3)    # HARD cap at 3 per scene
            )
        else:
            # Keep ALL candidates - user will cull in lightbox
            selected_candidates = candidates
            for c in selected_candidates:
                c['selection_reasons'] = ['quality_passed']

        # Save results
        progress(98, "Saving results...")
        results_path = os.path.join(output_dir, 'results.json')
        with open(results_path, 'w') as f:
            json.dump({
                'video_path': video_path,
                'processed_at': datetime.now().isoformat(),
                'total_scenes': len(scenes),
                'total_analyzed': len(candidates),
                'total_selected': len(selected_candidates),
                'audio_events': [e.to_dict() for e in audio_events],
                'candidates': selected_candidates,
            }, f, indent=2)

        progress(100, "Complete")
        logger.info(f"Results saved to: {results_path}")
        logger.info(f"Selected {len(selected_candidates)} frames from {len(candidates)} analyzed")

        return selected_candidates


def run_full_pipeline(
    video_path: str,
    output_dir: str,
    options: dict = None,
    on_progress: Callable[[int, str], None] = None
) -> list:
    """
    Run the full screenshot extraction pipeline.

    Args:
        video_path: Path to video file
        output_dir: Output directory
        options: Pipeline options
        on_progress: Progress callback

    Returns:
        List of candidate results
    """
    pipeline = ScreenshotPipeline(device=get_device())
    return pipeline.run(video_path, output_dir, options, on_progress)


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description='Extract screenshots from video')
    parser.add_argument('video_path', help='Path to video file')
    parser.add_argument('output_dir', help='Output directory for screenshots')
    parser.add_argument('--options', type=str, default='{}', help='JSON options string')

    args = parser.parse_args()

    # Parse options JSON
    try:
        options = json.loads(args.options)
    except json.JSONDecodeError:
        options = {}

    # Log LUT path if provided
    if options.get('lut_path'):
        logger.info(f"Using LUT: {options['lut_path']}")

    results = run_full_pipeline(args.video_path, args.output_dir, options)
    print(f"Done. Found {len(results)} candidates.")
