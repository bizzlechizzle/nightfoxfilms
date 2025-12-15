#!/usr/bin/env python3
"""
RAM++ Image Tagging API Server

Serves the Recognize Anything Model (RAM++) for image auto-tagging.
Designed to run on a GPU workstation (3090) and serve the Abandoned Archive app.

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

Usage:
    # Install dependencies
    pip install -r requirements.txt

    # Run server
    python ram_api_server.py

    # Or with uvicorn directly
    uvicorn ram_api_server:app --host 0.0.0.0 --port 8765

API Endpoints:
    POST /tag - Tag a single image (file upload or base64)
    POST /tag/batch - Tag multiple images
    GET /health - Health check
    GET /models - List available models

@module scripts/ram-server
"""

import os
import io
import base64
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ram-server")

# ============================================================================
# Configuration
# ============================================================================

# Model settings
MODEL_NAME = os.getenv("RAM_MODEL", "ram_plus_swin_large_14m")
MODEL_CACHE_DIR = os.getenv("RAM_CACHE_DIR", Path.home() / ".cache" / "ram")
DEVICE = os.getenv("RAM_DEVICE", "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
IMAGE_SIZE = 384  # RAM++ input size

# Server settings
HOST = os.getenv("RAM_HOST", "0.0.0.0")
PORT = int(os.getenv("RAM_PORT", "8765"))

# ============================================================================
# Model Loading
# ============================================================================

# Global model instance
ram_model = None
ram_transform = None

def load_model():
    """Load RAM++ model (lazy initialization)"""
    global ram_model, ram_transform

    if ram_model is not None:
        return  # Already loaded

    logger.info(f"Loading RAM++ model on {DEVICE}...")
    start = time.time()

    try:
        # Try to import RAM++ from recognize-anything package
        from ram.models import ram_plus
        from ram import inference_ram_plus as inference
        from ram import get_transform

        # Download/load model
        model = ram_plus(
            pretrained=str(MODEL_CACHE_DIR / f"{MODEL_NAME}.pth"),
            image_size=IMAGE_SIZE,
            vit="swin_l"
        )

        # Move to device
        model = model.to(DEVICE)
        model.eval()

        ram_model = model
        ram_transform = get_transform(image_size=IMAGE_SIZE)

        elapsed = time.time() - start
        logger.info(f"RAM++ model loaded in {elapsed:.2f}s on {DEVICE}")

    except ImportError:
        # Fallback: Try loading via transformers
        logger.warning("recognize-anything not found, trying HuggingFace transformers...")
        try:
            from transformers import AutoProcessor, AutoModelForZeroShotImageClassification

            processor = AutoProcessor.from_pretrained("xinyu1205/recognize-anything-plus-model")
            model = AutoModelForZeroShotImageClassification.from_pretrained("xinyu1205/recognize-anything-plus-model")
            model = model.to(DEVICE)
            model.eval()

            ram_model = model
            ram_transform = processor

            elapsed = time.time() - start
            logger.info(f"RAM++ model (HF) loaded in {elapsed:.2f}s on {DEVICE}")

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise RuntimeError(f"Could not load RAM++ model: {e}")

def tag_image(image: Image.Image) -> Dict[str, Any]:
    """
    Tag a single image with RAM++

    Returns:
        dict with keys: tags, confidence, duration_ms
    """
    if ram_model is None:
        load_model()

    start = time.time()

    # Preprocess
    if isinstance(ram_transform, callable):
        # Original RAM++ transform
        image_tensor = ram_transform(image).unsqueeze(0).to(DEVICE)
    else:
        # HuggingFace processor
        inputs = ram_transform(images=image, return_tensors="pt")
        image_tensor = {k: v.to(DEVICE) for k, v in inputs.items()}

    # Inference
    with torch.no_grad():
        if hasattr(ram_model, 'generate_tag'):
            # Original RAM++ inference
            tags, _ = ram_model.generate_tag(image_tensor)
            # tags is a string like "tag1 | tag2 | tag3"
            tag_list = [t.strip() for t in tags[0].split('|')]
            confidences = {tag: 0.9 for tag in tag_list}  # RAM++ doesn't expose per-tag confidence
        else:
            # HuggingFace model
            outputs = ram_model(**image_tensor)
            # Extract tags from outputs
            tag_list = []
            confidences = {}
            # This depends on the specific model output format
            probs = torch.sigmoid(outputs.logits[0])
            top_indices = torch.topk(probs, k=min(50, len(probs))).indices
            for idx in top_indices:
                if probs[idx] > 0.5:  # Threshold
                    tag = ram_model.config.id2label.get(idx.item(), f"tag_{idx.item()}")
                    tag_list.append(tag)
                    confidences[tag] = float(probs[idx])

    duration_ms = int((time.time() - start) * 1000)

    return {
        "tags": tag_list,
        "confidence": confidences,
        "duration_ms": duration_ms,
    }

# ============================================================================
# FastAPI App
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for model loading"""
    # Startup: Load model
    try:
        load_model()
    except Exception as e:
        logger.error(f"Failed to load model on startup: {e}")
    yield
    # Shutdown: Cleanup
    logger.info("Shutting down RAM++ server")

app = FastAPI(
    title="RAM++ Image Tagging API",
    description="Recognize Anything Model for image auto-tagging",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for Electron app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Request/Response Models
# ============================================================================

class TagRequest(BaseModel):
    """Request for base64-encoded image tagging"""
    image_base64: str
    filename: Optional[str] = None

class TagResponse(BaseModel):
    """Response with tags"""
    success: bool
    tags: List[str] = []
    confidence: Dict[str, float] = {}
    duration_ms: int = 0
    error: Optional[str] = None

class BatchTagRequest(BaseModel):
    """Request for batch tagging"""
    images: List[TagRequest]

class BatchTagResponse(BaseModel):
    """Response with batch results"""
    success: bool
    results: List[TagResponse] = []
    total_duration_ms: int = 0
    error: Optional[str] = None

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    model_loaded: bool
    device: str
    model_name: str

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy" if ram_model is not None else "model_not_loaded",
        model_loaded=ram_model is not None,
        device=DEVICE,
        model_name=MODEL_NAME,
    )

@app.get("/models")
async def list_models():
    """List available models"""
    return {
        "available": [
            {"name": "ram_plus_swin_large_14m", "description": "RAM++ Large (14M tags)", "default": True},
            {"name": "ram_swin_large_14m", "description": "RAM Large (14M tags)", "default": False},
        ],
        "current": MODEL_NAME,
        "device": DEVICE,
    }

@app.post("/tag", response_model=TagResponse)
async def tag_single_image(
    file: Optional[UploadFile] = File(None),
    image_base64: Optional[str] = Form(None),
):
    """
    Tag a single image

    Accepts either:
    - File upload (multipart/form-data)
    - Base64-encoded image (application/x-www-form-urlencoded)
    """
    try:
        # Load image from file or base64
        if file is not None:
            contents = await file.read()
            image = Image.open(io.BytesIO(contents)).convert("RGB")
        elif image_base64 is not None:
            # Handle data URI prefix
            if image_base64.startswith("data:"):
                image_base64 = image_base64.split(",", 1)[1]
            contents = base64.b64decode(image_base64)
            image = Image.open(io.BytesIO(contents)).convert("RGB")
        else:
            raise HTTPException(status_code=400, detail="No image provided")

        # Tag the image
        result = tag_image(image)

        return TagResponse(
            success=True,
            tags=result["tags"],
            confidence=result["confidence"],
            duration_ms=result["duration_ms"],
        )

    except Exception as e:
        logger.error(f"Tagging error: {e}")
        return TagResponse(
            success=False,
            error=str(e),
        )

@app.post("/tag/batch", response_model=BatchTagResponse)
async def tag_batch_images(request: BatchTagRequest):
    """Tag multiple images in a batch"""
    start = time.time()
    results = []

    for item in request.images:
        try:
            # Decode base64
            image_data = item.image_base64
            if image_data.startswith("data:"):
                image_data = image_data.split(",", 1)[1]
            contents = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(contents)).convert("RGB")

            # Tag
            result = tag_image(image)
            results.append(TagResponse(
                success=True,
                tags=result["tags"],
                confidence=result["confidence"],
                duration_ms=result["duration_ms"],
            ))

        except Exception as e:
            results.append(TagResponse(
                success=False,
                error=str(e),
            ))

    total_duration = int((time.time() - start) * 1000)

    return BatchTagResponse(
        success=all(r.success for r in results),
        results=results,
        total_duration_ms=total_duration,
    )

@app.post("/tag/file")
async def tag_file_path(path: str = Form(...)):
    """
    Tag an image from a local file path

    Only works when server and client are on the same machine.
    """
    try:
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail=f"File not found: {path}")

        image = Image.open(path).convert("RGB")
        result = tag_image(image)

        return TagResponse(
            success=True,
            tags=result["tags"],
            confidence=result["confidence"],
            duration_ms=result["duration_ms"],
        )

    except Exception as e:
        logger.error(f"File tagging error: {e}")
        return TagResponse(
            success=False,
            error=str(e),
        )

# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting RAM++ server on {HOST}:{PORT}")
    logger.info(f"Device: {DEVICE}")
    logger.info(f"Model: {MODEL_NAME}")

    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
    )
