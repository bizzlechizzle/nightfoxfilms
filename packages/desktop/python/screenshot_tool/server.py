"""
Screenshot Tool FastAPI Server

Provides REST API endpoints for the ML pipeline.
Integrates with Electron main process via HTTP.
"""

import os
import sys
import tempfile
import asyncio
from typing import Optional, List, Dict, Any
from pathlib import Path
import logging

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

# Import pipeline components
from .pipeline import (
    ScreenshotPipeline,
    SceneDetector,
    QualityFilter,
    FaceDetector,
    ContentTagger,
    SmartCropper,
    FaceClusterer,
    get_device,
    run_full_pipeline,
)

# FastAPI app
app = FastAPI(
    title="Screenshot Tool API",
    description="ML Pipeline for Wedding Video Screenshot Extraction",
    version="1.0.0"
)

# CORS middleware for Electron integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
class AppState:
    pipeline: Optional[ScreenshotPipeline] = None
    models_loaded: bool = False
    current_job: Optional[str] = None
    job_progress: int = 0
    job_message: str = ""

state = AppState()


# Request/Response Models
class AnalyzeRequest(BaseModel):
    """
    Request model for video analysis.

    Options dict supports:
        - lut_path (str): Path to LUT file for LOG footage (e.g., Sony S-Log3 to Rec.709)
        - sharpness_threshold (float): Minimum sharpness score (default: 100.0, use lower for LOG)
        - ram_model_path (str): Path to RAM++ model weights
        - cluster_eps (float): DBSCAN epsilon for face clustering (default: 0.5)
        - cluster_min_samples (int): Min samples per cluster (default: 2)
    """
    video_path: str = Field(..., description="Path to video file")
    output_dir: str = Field(..., description="Directory for output files")
    options: Dict[str, Any] = Field(default_factory=dict, description="Pipeline options (lut_path, sharpness_threshold, etc)")


class AnalyzeResponse(BaseModel):
    """Response model for video analysis."""
    success: bool
    job_id: Optional[str] = None
    candidates: List[Dict] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    total_scenes: int = 0
    total_candidates: int = 0


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str
    models_loaded: bool
    device: str
    current_job: Optional[str] = None
    job_progress: int = 0
    job_message: str = ""


class DetectScenesRequest(BaseModel):
    """Request model for scene detection."""
    video_path: str
    threshold: float = 0.5


class DetectScenesResponse(BaseModel):
    """Response model for scene detection."""
    success: bool
    scenes: List[Dict] = Field(default_factory=list)
    error: Optional[str] = None


class DetectFacesResponse(BaseModel):
    """Response model for face detection."""
    success: bool
    faces: List[Dict] = Field(default_factory=list)
    error: Optional[str] = None


class TagImageResponse(BaseModel):
    """Response model for image tagging."""
    success: bool
    tags: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class GenerateCropsRequest(BaseModel):
    """Request model for crop generation."""
    image_path: str
    faces: Optional[List[Dict]] = None


class GenerateCropsResponse(BaseModel):
    """Response model for crop generation."""
    success: bool
    crops: Dict[str, Dict] = Field(default_factory=dict)
    error: Optional[str] = None


class QualityScoreRequest(BaseModel):
    """Request model for quality scoring."""
    image_path: str


class QualityScoreResponse(BaseModel):
    """Response model for quality scoring."""
    success: bool
    sharpness: float = 0.0
    is_sharp: bool = False
    error: Optional[str] = None


class ClusterFacesRequest(BaseModel):
    """Request model for face clustering."""
    embeddings: List[List[float]]
    eps: float = 0.5
    min_samples: int = 2


class ClusterFacesResponse(BaseModel):
    """Response model for face clustering."""
    success: bool
    labels: List[int] = Field(default_factory=list)
    cluster_info: Dict = Field(default_factory=dict)
    error: Optional[str] = None


class ProgressResponse(BaseModel):
    """Response model for job progress."""
    job_id: Optional[str] = None
    progress: int = 0
    message: str = ""
    complete: bool = False


# Startup event
@app.on_event("startup")
async def startup_event():
    """Initialize models on server startup."""
    logger.info("Starting Screenshot Tool API server...")
    logger.info(f"Device: {get_device()}")

    # Initialize pipeline but don't load models yet (lazy loading)
    state.pipeline = ScreenshotPipeline(device=get_device())
    logger.info("Pipeline initialized (models will be loaded on first use)")


# Health check
@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        models_loaded=state.models_loaded,
        device=get_device(),
        current_job=state.current_job,
        job_progress=state.job_progress,
        job_message=state.job_message,
    )


# Load models explicitly
@app.post("/load-models")
async def load_models(ram_model_path: Optional[str] = None):
    """Explicitly load all ML models."""
    try:
        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        state.pipeline.load_models(ram_model_path)
        state.models_loaded = True

        return {"success": True, "message": "Models loaded successfully"}
    except Exception as e:
        logger.error(f"Failed to load models: {e}")
        return {"success": False, "error": str(e)}


# Progress endpoint
@app.get("/progress", response_model=ProgressResponse)
async def get_progress():
    """Get current job progress."""
    return ProgressResponse(
        job_id=state.current_job,
        progress=state.job_progress,
        message=state.job_message,
        complete=state.current_job is None and state.job_progress >= 100,
    )


# Full analysis endpoint
@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_video(request: AnalyzeRequest):
    """
    Run full analysis pipeline on a video.

    This runs:
    1. Scene detection
    2. Frame extraction
    3. Quality filtering
    4. Face detection
    5. Tagging
    6. Smart cropping
    7. Face clustering
    """
    try:
        # Validate paths
        if not os.path.exists(request.video_path):
            return AnalyzeResponse(
                success=False,
                errors=[f"Video file not found: {request.video_path}"]
            )

        # Create output directory
        os.makedirs(request.output_dir, exist_ok=True)

        # Set up progress tracking
        job_id = f"analyze_{os.path.basename(request.video_path)}_{os.getpid()}"
        state.current_job = job_id

        def on_progress(pct: int, msg: str):
            state.job_progress = pct
            state.job_message = msg

        # Run pipeline
        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        candidates = state.pipeline.run(
            video_path=request.video_path,
            output_dir=request.output_dir,
            options=request.options,
            on_progress=on_progress,
        )

        # Clear job state
        state.current_job = None
        state.job_progress = 100
        state.job_message = "Complete"
        state.models_loaded = True

        return AnalyzeResponse(
            success=True,
            job_id=job_id,
            candidates=candidates,
            total_scenes=len(state.pipeline.scene_detector.detect(request.video_path)) if state.pipeline else 0,
            total_candidates=len(candidates),
        )

    except Exception as e:
        logger.error(f"Analysis failed: {e}", exc_info=True)
        state.current_job = None
        return AnalyzeResponse(
            success=False,
            errors=[str(e)]
        )


# Scene detection endpoint
@app.post("/detect-scenes", response_model=DetectScenesResponse)
async def detect_scenes(request: DetectScenesRequest):
    """Detect scenes in a video."""
    try:
        if not os.path.exists(request.video_path):
            return DetectScenesResponse(
                success=False,
                error=f"Video file not found: {request.video_path}"
            )

        detector = SceneDetector(device=get_device())
        detector.load()

        scenes = detector.detect(request.video_path, threshold=request.threshold)

        return DetectScenesResponse(
            success=True,
            scenes=[{"start": s[0], "end": s[1]} for s in scenes]
        )

    except Exception as e:
        logger.error(f"Scene detection failed: {e}")
        return DetectScenesResponse(success=False, error=str(e))


# Face detection endpoint (file upload)
@app.post("/detect-faces", response_model=DetectFacesResponse)
async def detect_faces(file: UploadFile = File(...)):
    """Detect faces in an uploaded image."""
    tmp_path = None
    try:
        # Save uploaded file temporarily
        suffix = Path(file.filename).suffix if file.filename else '.jpg'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # Load detector if needed
        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        state.pipeline.face_detector.load()

        # Detect faces
        faces = state.pipeline.face_detector.detect(tmp_path)

        return DetectFacesResponse(
            success=True,
            faces=[f.to_dict() if hasattr(f, 'to_dict') else f for f in faces]
        )

    except Exception as e:
        logger.error(f"Face detection failed: {e}")
        return DetectFacesResponse(success=False, error=str(e))

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# Face detection endpoint (path-based)
@app.post("/detect-faces-path", response_model=DetectFacesResponse)
async def detect_faces_path(image_path: str):
    """Detect faces in an image by path."""
    try:
        if not os.path.exists(image_path):
            return DetectFacesResponse(
                success=False,
                error=f"Image not found: {image_path}"
            )

        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        state.pipeline.face_detector.load()
        faces = state.pipeline.face_detector.detect(image_path)

        return DetectFacesResponse(
            success=True,
            faces=[f.to_dict() if hasattr(f, 'to_dict') else f for f in faces]
        )

    except Exception as e:
        logger.error(f"Face detection failed: {e}")
        return DetectFacesResponse(success=False, error=str(e))


# Tagging endpoint (file upload)
@app.post("/tag", response_model=TagImageResponse)
async def tag_image(file: UploadFile = File(...)):
    """Generate tags for an uploaded image."""
    tmp_path = None
    try:
        # Save uploaded file temporarily
        suffix = Path(file.filename).suffix if file.filename else '.jpg'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        state.pipeline.tagger.load()
        tags = state.pipeline.tagger.tag(tmp_path)

        return TagImageResponse(success=True, tags=tags)

    except Exception as e:
        logger.error(f"Tagging failed: {e}")
        return TagImageResponse(success=False, error=str(e))

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# Tagging endpoint (path-based)
@app.post("/tag-path", response_model=TagImageResponse)
async def tag_image_path(image_path: str):
    """Generate tags for an image by path."""
    try:
        if not os.path.exists(image_path):
            return TagImageResponse(
                success=False,
                error=f"Image not found: {image_path}"
            )

        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        state.pipeline.tagger.load()
        tags = state.pipeline.tagger.tag(image_path)

        return TagImageResponse(success=True, tags=tags)

    except Exception as e:
        logger.error(f"Tagging failed: {e}")
        return TagImageResponse(success=False, error=str(e))


# Smart cropping endpoint
@app.post("/generate-crops", response_model=GenerateCropsResponse)
async def generate_crops(request: GenerateCropsRequest):
    """Generate smart crops for an image."""
    try:
        if not os.path.exists(request.image_path):
            return GenerateCropsResponse(
                success=False,
                error=f"Image not found: {request.image_path}"
            )

        if state.pipeline is None:
            state.pipeline = ScreenshotPipeline(device=get_device())

        state.pipeline.cropper.load()
        crops = state.pipeline.cropper.generate_crops(
            request.image_path,
            faces=request.faces
        )

        return GenerateCropsResponse(
            success=True,
            crops={k: v.to_dict() if hasattr(v, 'to_dict') else v for k, v in crops.items()}
        )

    except Exception as e:
        logger.error(f"Crop generation failed: {e}")
        return GenerateCropsResponse(success=False, error=str(e))


# Quality scoring endpoint
@app.post("/quality-score", response_model=QualityScoreResponse)
async def get_quality_score(request: QualityScoreRequest):
    """Get quality score for an image."""
    try:
        if not os.path.exists(request.image_path):
            return QualityScoreResponse(
                success=False,
                error=f"Image not found: {request.image_path}"
            )

        quality_filter = QualityFilter()
        sharpness = quality_filter.compute_sharpness_from_path(request.image_path)

        return QualityScoreResponse(
            success=True,
            sharpness=sharpness,
            is_sharp=sharpness >= 100.0,
        )

    except Exception as e:
        logger.error(f"Quality scoring failed: {e}")
        return QualityScoreResponse(success=False, error=str(e))


# Face clustering endpoint
@app.post("/cluster-faces", response_model=ClusterFacesResponse)
async def cluster_faces(request: ClusterFacesRequest):
    """Cluster face embeddings."""
    try:
        import numpy as np

        if not request.embeddings:
            return ClusterFacesResponse(
                success=False,
                error="No embeddings provided"
            )

        clusterer = FaceClusterer()
        embeddings = [np.array(e) for e in request.embeddings]

        labels = clusterer.cluster(
            embeddings,
            eps=request.eps,
            min_samples=request.min_samples
        )

        return ClusterFacesResponse(
            success=True,
            labels=labels.tolist(),
            cluster_info=clusterer.get_cluster_info(),
        )

    except Exception as e:
        logger.error(f"Clustering failed: {e}")
        return ClusterFacesResponse(success=False, error=str(e))


def main():
    """Run the server."""
    import argparse

    parser = argparse.ArgumentParser(description="Screenshot Tool API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")

    args = parser.parse_args()

    uvicorn.run(
        "screenshot_tool.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
