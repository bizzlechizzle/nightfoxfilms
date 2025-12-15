# Script Registry — Abandoned Archive v0.1.0

> Every script under 300 LOC, documented here. If it's not here, it shouldn't exist.

---

## Scripts

### scripts/setup.sh

- **Path**: `scripts/setup.sh`
- **Lines**: 514 ⚠️ (exceeds 300 LOC guideline)
- **Runtime**: bash
- **Purpose**: Full setup script for AU Archive - installs all dependencies, builds packages, downloads Research Browser
- **Usage**:
  ```bash
  ./scripts/setup.sh              # Full setup
  ./scripts/setup.sh --skip-optional  # Skip libpostal, exiftool, ffmpeg
  ./scripts/setup.sh --skip-browser   # Skip Ungoogled Chromium (~150MB)
  ./scripts/setup.sh --verbose        # Show detailed output
  ./scripts/setup.sh --help           # Show all options

  # Also available via pnpm:
  pnpm init              # Full setup
  pnpm init:quick        # Skip optional dependencies
  ```
- **Inputs**: CLI flags (--skip-optional, --skip-browser, --verbose, --help)
- **Outputs**: stdout (colored progress), installed dependencies
- **Side Effects**: Installs npm packages, native modules, optional tools, downloads browser
- **Dependencies**: bash, curl, Node.js, pnpm, git
- **Last Verified**: 2025-11-30

---

### scripts/check-deps.sh

- **Path**: `scripts/check-deps.sh`
- **Lines**: 131
- **Runtime**: bash
- **Purpose**: Quick dependency health check - verifies all required and optional tools are installed
- **Usage**:
  ```bash
  ./scripts/check-deps.sh
  pnpm deps              # via package.json script
  ```
- **Inputs**: None
- **Outputs**: stdout (colored status for each dependency)
- **Side Effects**: None (read-only)
- **Dependencies**: bash
- **Last Verified**: 2025-11-30

---

### scripts/test-region-gaps.ts

- **Path**: `scripts/test-region-gaps.ts`
- **Lines**: 258
- **Runtime**: ts-node
- **Purpose**: Test region gap coverage across all 50 states + DC + territories
- **Usage**:
  ```bash
  npx ts-node scripts/test-region-gaps.ts
  ```
- **Inputs**: None
- **Outputs**: stdout (test results, failures with gap details)
- **Side Effects**: None (read-only test)
- **Dependencies**: ts-node, typescript, @au-archive/core
- **Last Verified**: 2025-11-30

Generates test locations for all 54 states/territories across 5 scenarios:
- Full Data (GPS + Address)
- GPS Only
- Address Only (State + County)
- State Only
- Minimal (Name Only)

Validates that all 8 region fields are populated without gaps.

---

### scripts/run-dedup.py

- **Path**: `scripts/run-dedup.py`
- **Lines**: 235
- **Runtime**: python3
- **Purpose**: GPS-based deduplication for ref_map_points table (Python version)
- **Usage**:
  ```bash
  python3 scripts/run-dedup.py
  ```
- **Inputs**: None (reads from database)
- **Outputs**: stdout (progress, statistics)
- **Side Effects**:
  - Creates database backup before modifications
  - Runs Migration 39 if needed (aka_names column)
  - Merges duplicate pins at same GPS coordinates
  - Updates aka_names with alternate names
  - Deletes duplicate records
- **Dependencies**: python3, sqlite3 (built-in)
- **Last Verified**: 2025-11-30

Uses Python's built-in sqlite3 module to avoid native module issues with Electron's Node version.

---

### scripts/run-dedup.sql

- **Path**: `scripts/run-dedup.sql`
- **Lines**: 45
- **Runtime**: sqlite3
- **Purpose**: Analysis-only SQL for ref_map_points duplicates (no modifications)
- **Usage**:
  ```bash
  sqlite3 packages/desktop/data/au-archive.db < scripts/run-dedup.sql
  ```
- **Inputs**: Database file path
- **Outputs**: stdout (duplicate groups, statistics)
- **Side Effects**: None (read-only queries)
- **Dependencies**: sqlite3 CLI
- **Last Verified**: 2025-11-30

Useful for previewing what the dedup scripts will merge before running them.

---

### resetdb.py

- **Path**: `resetdb.py` (root directory)
- **Lines**: 384 ⚠️ (exceeds 300 LOC guideline)
- **Runtime**: python3
- **Purpose**: Reset database, config, logs, caches, and archive files for fresh import testing
- **Usage**:
  ```bash
  python3 resetdb.py                            # Interactive (prompts for confirmation)
  python3 resetdb.py -f                         # Force reset without confirmation
  python3 resetdb.py --db-only                  # Only remove database, keep config
  python3 resetdb.py -a /path/to/archive        # Also clean archive support dirs
  python3 resetdb.py -a /archive --wipe-media   # FRESH IMPORT - clears ALL media files
  python3 resetdb.py -a /archive --nuclear      # Also clear browser profile
  ```
- **Inputs**: CLI flags (-f, --db-only, -a, --wipe-media, --nuclear)
- **Outputs**: stdout (files removed, grouped by category)
- **Side Effects**:
  - Removes SQLite database file (both production and dev locations)
  - Removes WAL/SHM journal files
  - Removes bootstrap config file
  - Removes backup directory
  - Removes application logs directory
  - Removes maintenance history file
  - With `-a`: Removes archive support directories (.thumbnails, .previews, .posters, .cache/video-proxies, _database)
  - With `--wipe-media`: Removes locations/ folder (ALL imported media, BagIt archives, XMP sidecars) - requires typing 'DELETE' to confirm
  - With `--nuclear`: Also removes research browser profile (logins, cookies, history)
- **Dependencies**: python3
- **Last Verified**: 2025-12-01

Detects platform (macOS/Linux/Windows) and locates config directory accordingly. Provides grouped output showing exactly what will be removed before confirmation.

---

### scripts/backfill-extractions.py

- **Path**: `scripts/backfill-extractions.py`
- **Lines**: 249
- **Runtime**: python3
- **Purpose**: OPT-120 backfill script - queues pending web sources for LLM extraction and auto-tags locations
- **Usage**:
  ```bash
  python3 scripts/backfill-extractions.py             # Apply changes
  python3 scripts/backfill-extractions.py --dry-run   # Preview only
  ```
- **Inputs**: CLI flags (--dry-run)
- **Outputs**: stdout (queued sources, tagged locations, queue status)
- **Side Effects**:
  - Inserts records into extraction_queue table for web sources with text
  - Updates location_type and era on locs table based on keyword detection
- **Dependencies**: python3, sqlite3 (built-in)
- **Last Verified**: 2025-12-13

Finds web sources with extracted_text but missing smart_title/extraction and queues them for processing.
Also auto-tags locations with missing location_type or era based on:
- Location name keywords (e.g., "golf", "hospital", "factory")
- Built year for era detection

---

### scripts/extract-text.py

- **Path**: `scripts/extract-text.py`
- **Lines**: ~280
- **Runtime**: python3
- **Purpose**: OPT-115 comprehensive text extraction from HTML using Trafilatura, BeautifulSoup, and Readability
- **Usage**:
  ```bash
  python3 scripts/extract-text.py page.html             # Extract from file
  cat page.html | python3 scripts/extract-text.py --stdin  # Extract from stdin
  python3 scripts/extract-text.py page.html --output text  # Plain text output
  python3 scripts/extract-text.py page.html --output all   # All methods comparison
  ```
- **Inputs**: HTML file path or stdin
- **Outputs**: JSON with extracted text, word count, metadata, headings, links
- **Side Effects**: None (read-only)
- **Dependencies**: python3, trafilatura, beautifulsoup4, lxml, readability-lxml
- **Last Verified**: 2025-12-12

Multi-strategy extraction:
1. Trafilatura (main article content, author, date, categories)
2. BeautifulSoup (structured: headings, links, images)
3. Readability (article detection fallback)

---

### scripts/spacy-server/main.py

- **Path**: `scripts/spacy-server/main.py`
- **Lines**: ~160
- **Runtime**: python3 (FastAPI/uvicorn)
- **Purpose**: spaCy NLP preprocessing server for LLM extraction pipeline - pre-filters text BEFORE sending to LLMs
- **Usage**:
  ```bash
  # Auto-spawned by app - no manual setup required!
  # The PreprocessingService automatically starts this server on demand.

  # Manual startup (for debugging):
  cd scripts/spacy-server
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
  python -m spacy download en_core_web_sm
  python main.py
  ```
- **Inputs**: Text via POST /preprocess endpoint
- **Outputs**: JSON with preprocessed sentences, entities, verbs, timeline candidates, profile candidates
- **Side Effects**: Loads spaCy model into memory (~50MB)
- **Dependencies**: python3, spacy>=3.7, fastapi, uvicorn, pydantic
- **Last Verified**: 2025-12-14

**Key Features:**
- Named Entity Recognition (PERSON, ORG, DATE, GPE, etc.)
- Verb-based timeline relevancy detection (built, demolished, opened, etc.)
- Profile candidate extraction with normalized names
- Relevancy scoring for efficient LLM context building

**Endpoints:**
- `GET /health` - Service health check
- `POST /preprocess` - Preprocess text for LLM extraction
- `GET /verb-categories` - Get verb category definitions

**Auto-spawn:** The app automatically starts this server when preprocessing is needed. No manual setup required. Falls back to basic sentence splitting if spaCy unavailable.

---

### scripts/spacy-server/preprocessor.py

- **Path**: `scripts/spacy-server/preprocessor.py`
- **Lines**: ~380
- **Runtime**: python3
- **Purpose**: Core spaCy preprocessing logic - extracts entities, verbs, and builds timeline/profile candidates
- **Usage**: Imported by main.py, not run directly
- **Last Verified**: 2025-12-14

---

### scripts/spacy-server/verb_patterns.py

- **Path**: `scripts/spacy-server/verb_patterns.py`
- **Lines**: ~175
- **Runtime**: python3
- **Purpose**: Defines verb categories for timeline-relevant date extraction
- **Usage**: Imported by preprocessor.py, not run directly
- **Last Verified**: 2025-12-14

**Verb Categories:**
| Category | Description | Example Verbs |
|----------|-------------|---------------|
| build_date | Construction/creation | built, constructed, erected |
| opening | Opening/inauguration | opened, launched, inaugurated |
| closure | Closing/shutdown | closed, shut, ceased |
| demolition | Destruction/tear-down | demolished, razed, burned |
| renovation | Repair/restoration | renovated, restored, rebuilt |
| event | Notable incidents | occurred, exploded, flooded |
| visit | Visits/explorations | visited, explored, photographed |
| publication | Publication dates | published, reported, announced |
| ownership | Transfer/acquisition | acquired, purchased, sold |

---

### scripts/ram-server/ram_api_server.py

- **Path**: `scripts/ram-server/ram_api_server.py`
- **Lines**: ~350
- **Runtime**: python3 (FastAPI/uvicorn)
- **Purpose**: Migration 76 - RAM++ (Recognize Anything Model) image tagging API server
- **Usage**:
  ```bash
  cd scripts/ram-server
  ./start.sh                    # Auto-installs deps and starts server
  ./start.sh --port 9000        # Custom port
  RAM_DEVICE=cpu ./start.sh     # Force CPU mode

  # Or manually:
  pip install -r requirements.txt
  python ram_api_server.py
  ```
- **Inputs**: Image files (file upload, base64, or local path)
- **Outputs**: JSON with tags, confidence scores, duration
- **Side Effects**: GPU memory usage when loaded
- **Dependencies**: python3, torch, torchvision, fastapi, uvicorn, recognize-anything
- **Last Verified**: 2025-12-13

Endpoints:
- `GET /health` - Service health check (model loaded status)
- `POST /tag` - Tag single image (file upload or base64)
- `POST /tag/batch` - Tag multiple images
- `POST /tag/file` - Tag image from local file path

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

---

### scripts/backfill-image-processing.py

- **Path**: `scripts/backfill-image-processing.py`
- **Lines**: ~280
- **Runtime**: python3
- **Purpose**: Backfill image processing jobs for images missing ExifTool, thumbnails, or RAM++ tags
- **Usage**:
  ```bash
  python3 scripts/backfill-image-processing.py              # Apply changes
  python3 scripts/backfill-image-processing.py --dry-run    # Preview only
  python3 scripts/backfill-image-processing.py --web-only   # Only web-sourced images
  python3 scripts/backfill-image-processing.py --limit 100  # Process max 100 images
  ```
- **Inputs**: CLI flags (--dry-run, --web-only, --limit, --db)
- **Outputs**: stdout (queued jobs, queue status)
- **Side Effects**:
  - Inserts records into jobs table for missing processing
  - Queues: ExifTool, Thumbnail, Image Tagging per-file jobs
  - Queues: GPS Enrichment, Location Stats, BagIt, Tag Aggregation per-location jobs
- **Dependencies**: python3, sqlite3 (built-in)
- **Last Verified**: 2025-12-14

Per docs/plans/unified-image-processing-pipeline.md:
Ensures ALL images receive standard processing regardless of import source.

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

---

### scripts/ram_tagger.py

- **Path**: `scripts/ram_tagger.py`
- **Lines**: 315 (slightly exceeds 300 LOC guideline)
- **Runtime**: python3.12 (requires venv at `scripts/ram-server/venv/`)
- **Purpose**: Local RAM++ (Recognize Anything Model) inference for image tagging on Mac with MPS acceleration
- **Usage**:
  ```bash
  # Using venv (auto-detected by ram-tagging-service.ts)
  source scripts/ram-server/venv/bin/activate
  python scripts/ram_tagger.py --image /path/to/image.jpg

  # Options
  python scripts/ram_tagger.py --image /path/to/image.jpg --device mps    # Mac GPU (default)
  python scripts/ram_tagger.py --image /path/to/image.jpg --device cpu    # CPU fallback
  python scripts/ram_tagger.py --image /path/to/image.jpg --max-tags 30   # Limit tags
  python scripts/ram_tagger.py --image /path/to/image.jpg --output text   # Human-readable
  ```
- **Inputs**: Image file path, optional device/max-tags flags
- **Outputs**: JSON to stdout: `{"tags": [...], "confidence": {...}, "duration_ms": 123, "model": "ram++", "device": "mps"}`
- **Side Effects**: GPU memory usage during inference (~4-6GB for full RAM++ model)
- **Dependencies**: Python 3.12, torch, torchvision, Pillow, scipy, timm, fairscale, transformers<4.40, recognize-anything
- **Last Verified**: 2025-12-14

**Setup (one-time):**
```bash
cd scripts/ram-server
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install git+https://github.com/xinyu1205/recognize-anything.git
curl -L -o ram_plus_swin_large_14m.pth "https://huggingface.co/xinyu1205/recognize-anything-plus-model/resolve/main/ram_plus_swin_large_14m.pth"
```

**Model**: RAM++ Swin-Large (2.8GB weights, 14M tag vocabulary)
- Full model at `scripts/ram-server/ram_plus_swin_large_14m.pth`
- Returns 5-30 semantic tags per image (building, grass, tree, fire station, etc.)
- ~5.5 seconds per image on Mac Studio M1 Max with MPS

Called by `ram-tagging-service.ts` as subprocess for local inference.

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

---

### scripts/download-siglip-onnx.py

- **Path**: `scripts/download-siglip-onnx.py`
- **Lines**: 264
- **Runtime**: python3 (requires venv at `scripts/ram-server/venv/`)
- **Purpose**: Download SigLIP model from Hugging Face, export to ONNX format, and precompute text embeddings for scene classification
- **Usage**:
  ```bash
  # Using existing venv
  source scripts/ram-server/venv/bin/activate
  python scripts/download-siglip-onnx.py

  # Options
  python scripts/download-siglip-onnx.py --model google/siglip-base-patch16-224  # Default
  python scripts/download-siglip-onnx.py --output-dir ./custom/path               # Custom output
  ```
- **Inputs**: CLI flags (--model, --output-dir)
- **Outputs**:
  - `resources/models/siglip-base-patch16-224.onnx` - Vision encoder ONNX model
  - `resources/models/siglip-base-patch16-224.onnx.data` - Model weights (~354MB)
  - `resources/models/siglip-base-patch16-224-text-embeddings.json` - Precomputed text embeddings
  - `resources/models/siglip-base-patch16-224-info.json` - Model metadata
- **Side Effects**: Downloads ~400MB from Hugging Face on first run
- **Dependencies**: python3, torch, transformers, sentencepiece, onnx, onnxscript
- **Last Verified**: 2025-12-15

**Purpose:** Exports SigLIP vision encoder for use in Stage 0 scene classification.
The scene-classifier.ts service uses the ONNX model for fast (~0.3s) view type detection
(interior/exterior/aerial/detail) before image tagging in Stage 1.

**Model:** google/siglip-base-patch16-224 (~400MB total)
- Better than CLIP for zero-shot classification (~10-15% improvement)
- 224x224 input resolution
- Uses precomputed text embeddings for urbex scene classification

Called by `scene-classifier.ts` for Node.js native inference without Python subprocess.

---

### scripts/florence_tagger.py

- **Path**: `scripts/florence_tagger.py`
- **Lines**: 431 ⚠️ (exceeds 300 LOC guideline)
- **Runtime**: python3 (requires venv at `scripts/ram-server/venv/`)
- **Purpose**: Stage 1 image tagging using Florence-2-large with context-aware prompts
- **Usage**:
  ```bash
  # Using existing venv
  source scripts/ram-server/venv/bin/activate
  python scripts/florence_tagger.py --image /path/to/image.jpg

  # With context from Stage 0 + database
  python scripts/florence_tagger.py --image /path/to/image.jpg \
    --view-type interior \
    --location-type hospital \
    --state "New York"

  # Options
  python scripts/florence_tagger.py --image /path/to/image.jpg --device mps    # Mac GPU (default)
  python scripts/florence_tagger.py --image /path/to/image.jpg --device cpu    # CPU fallback
  python scripts/florence_tagger.py --image /path/to/image.jpg --max-tags 30   # Limit tags
  python scripts/florence_tagger.py --image /path/to/image.jpg --output text   # Human-readable
  ```
- **Inputs**: Image file path, optional context flags (--view-type, --location-type, --state, --device, --max-tags)
- **Outputs**: JSON to stdout: `{"tags": [...], "confidence": {...}, "caption": "...", "quality_score": 0.75, "duration_ms": 1234, "model": "florence-2-large", "device": "mps"}`
- **Side Effects**: Downloads ~700MB model on first run, GPU memory usage during inference (~2-3GB)
- **Dependencies**: Python 3.12, torch, transformers, Pillow
- **Last Verified**: 2025-12-15

**Purpose:** Replaces RAM++ with Florence-2-large for Stage 1 context-aware tagging.
Builds dynamic prompts from view type (Stage 0), location type, and state.

**Model:** microsoft/Florence-2-large (~700MB)
- 4x smaller than RAM++ (700MB vs 2.8GB)
- Prompt-based - can describe "abandoned hospital interior"
- Returns detailed captions plus extracted tags
- ~2.5 seconds per image on Mac with MPS

**Key Differences from RAM++:**
- Accepts context parameters (view_type, location_type, state)
- Returns both caption and extracted tags
- More urbex-specific vocabulary from contextual prompts

Called by `image-tagging-service.ts` (renamed from ram-tagging-service.ts) as subprocess.

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

---

### scripts/vlm_enhancer.py

- **Path**: `scripts/vlm_enhancer.py`
- **Lines**: 346 ⚠️ (exceeds 300 LOC guideline)
- **Runtime**: python3 (requires venv at `scripts/vlm-server/venv/`)
- **Purpose**: Stage 2 VLM deep image analysis using Qwen3-VL or similar large vision-language models
- **Usage**:
  ```bash
  # Using VLM venv
  source scripts/vlm-server/venv/bin/activate
  python scripts/vlm_enhancer.py --image /path/to/image.jpg

  # With context from Stage 0/1 + database
  python scripts/vlm_enhancer.py --image /path/to/image.jpg \
    --view-type interior \
    --tags "decay,graffiti,hospital" \
    --location-type hospital \
    --location-name "Abandoned Memorial Hospital" \
    --state "New York"

  # Options
  python scripts/vlm_enhancer.py --image /path/to/image.jpg --model qwen3-vl   # Default model
  python scripts/vlm_enhancer.py --image /path/to/image.jpg --device mps       # Mac GPU
  python scripts/vlm_enhancer.py --image /path/to/image.jpg --max-tokens 512   # Response length
  python scripts/vlm_enhancer.py --image /path/to/image.jpg --output text      # Human-readable
  ```
- **Inputs**: Image file path, optional context flags (--view-type, --tags, --location-type, --location-name, --state, --model, --device, --max-tokens)
- **Outputs**: JSON to stdout with rich analysis:
  ```json
  {
    "description": "Rich 2-3 sentence description...",
    "caption": "Short alt text caption",
    "architectural_style": "Art Deco",
    "estimated_period": {"start": 1920, "end": 1940, "confidence": 0.7, "reasoning": "..."},
    "condition_assessment": {"overall": "poor", "score": 0.3, "details": "...", "observations": ["..."]},
    "notable_features": ["feature1", "feature2"],
    "search_keywords": ["keyword1", "keyword2"],
    "duration_ms": 5000,
    "model": "qwen3-vl",
    "device": "mps"
  }
  ```
- **Side Effects**: Downloads ~7GB model on first run, high GPU memory usage (~16GB recommended)
- **Dependencies**: Python 3.12, torch, transformers, Pillow, accelerate
- **Last Verified**: 2025-12-15

**Purpose:** Stage 2 optional deep analysis for hero image candidates.
Provides rich descriptions, architectural style detection, period estimation, and condition assessment.

**Model:** Qwen/Qwen2-VL-7B-Instruct (~7GB)
- Large vision-language model with strong reasoning
- Returns structured JSON with detailed analysis
- ~10-20 seconds per image on Mac with MPS

**Key Features:**
- Architectural style detection (Art Deco, Mid-Century Modern, etc.)
- Construction period estimation with reasoning
- Detailed condition assessment with observations
- Notable features extraction for search indexing

Called by `vlm-enhancement-service.ts` as subprocess for high-value images.

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

---

## Scripts Exceeding 300 LOC

| Script | Lines | Status | Action |
|--------|-------|--------|--------|
| `scripts/setup.sh` | 514 | ⚠️ Exceeds | Exempt - complex multi-phase installer with extensive error handling |
| `resetdb.py` | 384 | ⚠️ Exceeds | Exempt - comprehensive reset utility with multiple modes and platform detection |
| `scripts/ram_tagger.py` | 315 | ⚠️ Exceeds | Exempt - handles 3 model fallback chains with comprehensive error handling |
| `scripts/florence_tagger.py` | 431 | ⚠️ Exceeds | Exempt - comprehensive prompt building and tag extraction logic |
| `scripts/vlm_enhancer.py` | 346 | ⚠️ Exceeds | Exempt - VLM analysis with structured JSON parsing and prompt building |

---

## Package.json Script Mappings

| pnpm Command | Underlying Script |
|--------------|-------------------|
| `pnpm init` | `scripts/setup.sh` |
| `pnpm init:quick` | `scripts/setup.sh --skip-optional` |
| `pnpm deps` | `scripts/check-deps.sh` |

---

## Adding New Scripts

1. Keep under 300 LOC (one focused function)
2. Add shebang and runtime comment at top
3. Document in this file with all fields
4. Add to package.json if frequently used
5. Test on all supported platforms

---

End of Script Registry
