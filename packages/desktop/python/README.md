# Screenshot Tool - ML Pipeline

Wedding video screenshot extraction tool for Nightfox Films CMS.

## Features

- Scene detection (TransNetV2 with FFmpeg fallback)
- Quality filtering (Laplacian sharpness with fallback guarantee)
- Face detection (InsightFace with age, gender, landmarks)
- Expression analysis (smile detection from landmarks)
- **4-Category Classification** (people_face, people_roll, broll, detail)
- Content tagging (RAM++ framework)
- Smart cropping (U2-Net/rembg for 4 aspect ratios)
- Face clustering (DBSCAN/Agglomerative)
- **Per-scene best frame selection** with category diversity
- FastAPI server for Electron integration

## Frame Categories

| Category | Description | Detection Method |
|----------|-------------|------------------|
| `people_face` | Clear visible faces | Face detection with size threshold |
| `people_roll` | People without visible faces | Tags: person, hand, back, silhouette |
| `broll` | Scenic shots, no people | No faces AND no person-related tags |
| `detail` | Object close-ups | Tags: ring, flower, cake, dress, etc. |

## Selection Algorithm

The pipeline uses intelligent frame selection:

1. **Sample frames** every 1.5 seconds within each scene
2. **Compute sharpness** for all frames
3. **Filter by quality** (threshold: 50, with fallback)
4. **Classify categories** using faces + tags
5. **Select best per scene** (max 3, with category diversity)
6. **Fallback guarantee** - every clip gets at least 1 frame

### Fallback Behavior

If no frames pass the sharpness threshold, the pipeline automatically selects the 1-3 sharpest frames available. This ensures every video clip has representation, even soft/blurry footage.

## Requirements

- Python 3.11 (recommended) or 3.12
- macOS with Metal (MPS), Windows/Linux with CUDA, or CPU

## Setup

### 1. Create Virtual Environment

```bash
cd packages/desktop/python
python3.11 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install --upgrade pip
pip install torch torchvision
pip install -r requirements.txt
```

### 3. Verify Installation

```bash
python test_screenshot_tool.py
```

Expected output:
```
============================================================
Screenshot Tool Integration Test
============================================================

1. Testing imports...
  [PASS] Pipeline modules
  [PASS] Server module

2. Testing device detection...
  [PASS] Device detection
        Detected: mps

3. Testing quality filter...
  [PASS] Sharpness comparison
        Sharp=12271.35, Blurry=8.80

4. Testing server startup...
  [PASS] Health endpoint
        Status: healthy, Device: mps

5. Testing quality endpoint...
  [PASS] Quality scoring

6. Testing smart cropping endpoint...
  [PASS] Smart cropping
        Generated 4 crop variants

============================================================
All tests passed!
The screenshot tool is ready for use.
```

## Usage

### Start the Server

```bash
source venv/bin/activate
python -m screenshot_tool.server --host 127.0.0.1 --port 8765
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check and status |
| `/analyze` | POST | Full video analysis pipeline |
| `/detect-scenes` | POST | Scene detection only |
| `/detect-faces-path` | POST | Face detection for image |
| `/tag-path` | POST | Auto-tagging for image |
| `/generate-crops` | POST | Smart crop generation |
| `/quality-score` | POST | Sharpness scoring |
| `/cluster-faces` | POST | Face embedding clustering |
| `/progress` | GET | Job progress tracking |

### Example: Full Analysis

```bash
curl -X POST http://127.0.0.1:8765/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "video_path": "/path/to/video.mp4",
    "output_dir": "/path/to/output",
    "options": {
      "sharpness_threshold": 100.0
    }
  }'
```

### Example: Smart Crops

```bash
curl -X POST http://127.0.0.1:8765/generate-crops \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/path/to/image.jpg"}'
```

Response:
```json
{
  "success": true,
  "crops": {
    "9:16": {"x1": 0, "y1": 0, "x2": 1080, "y2": 1920, "width": 1080, "height": 1920},
    "1:1": {"x1": 0, "y1": 420, "x2": 1080, "y2": 1500, "width": 1080, "height": 1080},
    "16:9": {"x1": 0, "y1": 0, "x2": 1920, "y2": 1080, "width": 1920, "height": 1080},
    "4:5": {"x1": 0, "y1": 135, "x2": 1080, "y2": 1485, "width": 1080, "height": 1350}
  }
}
```

## Electron Integration

The Screenshot Tool integrates with the Electron app via IPC handlers:

```typescript
// Start the Python server
await window.electronAPI.screenshotTool.start();

// Check health
const health = await window.electronAPI.screenshotTool.health();

// Run analysis
const result = await window.electronAPI.screenshotTool.analyze({
  videoPath: '/path/to/video.mp4',
  outputDir: '/path/to/output',
  options: { sharpness_threshold: 100.0 }
});

// Stop the server
await window.electronAPI.screenshotTool.stop();
```

## Output Format

The analysis produces a `results.json` file with the following structure:

```json
{
  "video_path": "/path/to/video.mp4",
  "processed_at": "2025-12-17T07:13:00.000Z",
  "total_scenes": 10,
  "total_candidates": 30,
  "candidates": [
    {
      "frame_number": 150,
      "timestamp": 5.0,
      "image_path": "/output/frames/frame_00000150.jpg",
      "sharpness_score": 255.3,
      "frame_category": "people_face",
      "faces": [
        {
          "bbox": [100, 50, 200, 180],
          "confidence": 0.99,
          "landmarks": [[120, 80], [160, 80], [140, 120], [115, 150], [165, 150]],
          "age": 28,
          "gender": "F",
          "smile_score": 0.75
        }
      ],
      "tags": ["person", "smile", "wedding"],
      "crops": {
        "9:16": {"x1": 0, "y1": 0, "x2": 480, "y2": 853, "width": 480, "height": 853},
        "1:1": {"x1": 80, "y1": 0, "x2": 560, "y2": 480, "width": 480, "height": 480},
        "16:9": {"x1": 0, "y1": 65, "x2": 640, "y2": 425, "width": 640, "height": 360},
        "4:5": {"x1": 32, "y1": 0, "x2": 608, "y2": 720, "width": 576, "height": 720}
      },
      "is_broll": false,
      "scene_index": 0,
      "cluster_labels": {"face_0": 0},
      "selection_reasons": ["best_people_face", "score:0.85"]
    }
  ]
}
```

### Frame Category Values

- `people_face` - Clear visible faces (good for hero shots)
- `people_roll` - People without faces (backs, hands, silhouettes)
- `broll` - Scenic/environment shots (venue, landscape)
- `detail` - Close-up objects (rings, flowers, dress details)

## Optional: Download RAM++ Model

For full tagging functionality, download the RAM++ model:

```bash
# Download from HuggingFace
wget -O screenshot_tool/models/ram_plus_swin_large_14m.pth \
  https://huggingface.co/xinyu1205/recognize-anything-plus-model/resolve/main/ram_plus_swin_large_14m.pth
```

## Troubleshooting

### Python version issues

Use Python 3.11 or 3.12. Python 3.14 is too new for PyTorch.

```bash
# Check your Python version
python --version

# Use specific version
python3.11 -m venv venv
```

### GPU not detected

Check your PyTorch installation:

```python
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"MPS available: {torch.backends.mps.is_available()}")
```

### Server won't start

1. Ensure you're in the virtual environment
2. Check that all dependencies are installed
3. Run the test script to verify

```bash
source venv/bin/activate
python test_screenshot_tool.py
```

### Import errors

Ensure PYTHONPATH includes the python directory:

```bash
export PYTHONPATH=/Volumes/Jay/nightfox/packages/desktop/python:$PYTHONPATH
```

## Architecture

```
packages/desktop/python/
├── requirements.txt          # Python dependencies
├── test_screenshot_tool.py   # Integration tests
├── README.md                 # This file
├── AUDIT.md                  # Compliance audit
└── screenshot_tool/
    ├── __init__.py
    ├── pipeline.py           # ML pipeline components
    ├── server.py             # FastAPI server
    └── models/               # Model weights directory
        └── .gitkeep
```
