"""
spaCy Preprocessing Server

FastAPI server providing NLP preprocessing for the AU Archive extraction system.
Pre-filters text BEFORE sending to LLMs for efficient, verb-based date extraction.

Endpoints:
- POST /preprocess - Preprocess text for LLM extraction
- GET /health - Health check
- GET /verb-categories - Get verb category definitions

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8100

@version 1.0
"""

import os
import sys
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from preprocessor import get_preprocessor, PreprocessingResult
from verb_patterns import get_categories_summary


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class PreprocessRequest(BaseModel):
    """Request model for preprocessing endpoint."""
    text: str = Field(..., description="Text to preprocess")
    article_date: Optional[str] = Field(None, description="Optional article/source date (ISO format)")
    max_sentences: int = Field(100, description="Maximum sentences to process", ge=1, le=500)


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str
    spacy_model: str
    version: str


class VerbCategoriesResponse(BaseModel):
    """Response model for verb categories."""
    categories: list


# =============================================================================
# LIFESPAN HANDLER
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup."""
    print("[spaCy Server] Loading spaCy model...")
    try:
        preprocessor = get_preprocessor()
        print(f"[spaCy Server] Loaded model: {preprocessor.nlp.meta['name']}")
    except Exception as e:
        print(f"[spaCy Server] Error loading model: {e}")
        print("[spaCy Server] Try: python -m spacy download en_core_web_sm")
        sys.exit(1)

    yield

    print("[spaCy Server] Shutting down...")


# =============================================================================
# FASTAPI APP
# =============================================================================

app = FastAPI(
    title="spaCy Preprocessing Server",
    description="NLP preprocessing for AU Archive extraction",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check server health and model status."""
    preprocessor = get_preprocessor()
    return HealthResponse(
        status="healthy",
        spacy_model=preprocessor.nlp.meta.get("name", "unknown"),
        version="1.0.0",
    )


@app.get("/verb-categories", response_model=VerbCategoriesResponse)
async def get_verb_categories():
    """Get verb category definitions for timeline extraction."""
    return VerbCategoriesResponse(
        categories=get_categories_summary()
    )


@app.post("/preprocess")
async def preprocess_text(request: PreprocessRequest):
    """
    Preprocess text for LLM extraction.

    Returns sentences with:
    - Named entities (PERSON, ORG, DATE, GPE, etc.)
    - Timeline-relevant verbs with categories
    - Date references with normalization
    - Relevancy scores for timeline filtering
    - Profile candidates for people/companies
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    try:
        preprocessor = get_preprocessor()
        result = preprocessor.preprocess(
            text=request.text,
            article_date=request.article_date,
            max_sentences=request.max_sentences,
        )
        return preprocessor.to_dict(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# STARTUP SCRIPT
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("SPACY_PORT", 8100))
    host = os.environ.get("SPACY_HOST", "127.0.0.1")

    print(f"[spaCy Server] Starting on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
