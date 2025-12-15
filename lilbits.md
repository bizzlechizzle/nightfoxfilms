# Script Registry — Nightfox Films v0.1.0

> Every script under 300 LOC, documented here. If it's not here, it shouldn't exist.

---

## Scripts

### packages/desktop/scripts/scene_detect.py

- **Path**: `packages/desktop/scripts/scene_detect.py`
- **Lines**: ~60
- **Runtime**: python3 (requires PySceneDetect)
- **Purpose**: Detect scene boundaries in video files using PySceneDetect
- **Usage**:
  ```bash
  # Using venv
  source packages/desktop/scripts/venv/bin/activate
  python packages/desktop/scripts/scene_detect.py --input video.mp4

  # Options
  python scene_detect.py --input video.mp4 --method content   # Fast cuts
  python scene_detect.py --input video.mp4 --method adaptive  # Camera movement
  python scene_detect.py --input video.mp4 --threshold 30.0   # Sensitivity
  python scene_detect.py --input video.mp4 --min-scene-len 60 # Min frames
  ```
- **Inputs**: Video file path, optional method/threshold/min-scene-len
- **Outputs**: JSON to stdout with scene boundaries
- **Side Effects**: None (read-only)
- **Dependencies**: python3, scenedetect
- **Last Verified**: TBD

**Output Format:**
```json
{
  "scenes": [
    {
      "scene_number": 1,
      "start_time": 0.0,
      "end_time": 5.2,
      "start_frame": 0,
      "end_frame": 156,
      "duration": 5.2
    }
  ],
  "method": "content"
}
```

Called by `scene-detection-service.ts` as subprocess.

---

### packages/desktop/scripts/sharpness_score.py

- **Path**: `packages/desktop/scripts/sharpness_score.py`
- **Lines**: ~80
- **Runtime**: python3 (requires OpenCV)
- **Purpose**: Calculate sharpness scores for video frames using Laplacian variance
- **Usage**:
  ```bash
  source packages/desktop/scripts/venv/bin/activate
  python sharpness_score.py --input video.mp4 --start 0 --end 5
  python sharpness_score.py --input video.mp4 --frames 0,30,60,90
  ```
- **Inputs**: Video file path, time range or specific frames
- **Outputs**: JSON to stdout with frame sharpness scores
- **Side Effects**: None (read-only)
- **Dependencies**: python3, opencv-python
- **Last Verified**: TBD

**Output Format:**
```json
{
  "frames": [
    {
      "frame_number": 0,
      "time_seconds": 0.0,
      "sharpness": 450.5
    }
  ],
  "best_frame": 45,
  "best_sharpness": 520.3
}
```

**Sharpness Thresholds:**
- < 100: Very blurry (motion blur, out of focus)
- 100-300: Acceptable
- 300-500: Good
- > 500: Very sharp

---

### packages/desktop/scripts/face_detect.py

- **Path**: `packages/desktop/scripts/face_detect.py`
- **Lines**: ~100
- **Runtime**: python3 (requires MediaPipe or OpenCV)
- **Purpose**: Detect faces in video frames for smart cropping
- **Usage**:
  ```bash
  source packages/desktop/scripts/venv/bin/activate
  python face_detect.py --input frame.jpg
  python face_detect.py --input video.mp4 --frame 100
  ```
- **Inputs**: Image file or video + frame number
- **Outputs**: JSON to stdout with face bounding boxes
- **Side Effects**: None (read-only)
- **Dependencies**: python3, mediapipe or opencv-python
- **Last Verified**: TBD

**Output Format:**
```json
{
  "faces": [
    {
      "x": 100,
      "y": 50,
      "width": 200,
      "height": 250,
      "confidence": 0.95
    }
  ],
  "frame_number": 100
}
```

---

### scripts/check-deps.sh

- **Path**: `scripts/check-deps.sh`
- **Lines**: ~80
- **Runtime**: bash
- **Purpose**: Quick dependency health check - verifies all required and optional tools
- **Usage**:
  ```bash
  ./scripts/check-deps.sh
  pnpm deps              # via package.json script
  ```
- **Inputs**: None
- **Outputs**: stdout (colored status for each dependency)
- **Side Effects**: None (read-only)
- **Dependencies**: bash
- **Last Verified**: TBD

Checks for:
- Node.js 20+
- pnpm 10+
- Git
- Python 3.8+
- FFmpeg
- ExifTool
- b3sum (optional)

---

### scripts/reset-db.py

- **Path**: `scripts/reset-db.py`
- **Lines**: ~150
- **Runtime**: python3
- **Purpose**: Reset database for fresh testing
- **Usage**:
  ```bash
  python3 scripts/reset-db.py                  # Interactive
  python3 scripts/reset-db.py -f               # Force without confirmation
  python3 scripts/reset-db.py --keep-cameras   # Preserve camera profiles
  ```
- **Inputs**: CLI flags
- **Outputs**: stdout (files removed)
- **Side Effects**:
  - Removes SQLite database file
  - Removes WAL/SHM journal files
  - Optionally preserves camera profiles
- **Dependencies**: python3
- **Last Verified**: TBD

---

## Python Virtual Environment Setup

All Python scripts share a single venv:

```bash
cd packages/desktop/scripts
python3 -m venv venv
source venv/bin/activate

# Install all dependencies
pip install scenedetect opencv-python mediapipe
```

**Requirements file** (`packages/desktop/scripts/requirements.txt`):
```
scenedetect>=0.6.4
opencv-python>=4.9.0
mediapipe>=0.10.0
numpy>=1.24.0
```

---

## Package.json Script Mappings

| pnpm Command | Underlying Script/Command |
|--------------|---------------------------|
| `pnpm dev` | `vite` (starts Electron dev server) |
| `pnpm build` | `pnpm --filter core build && pnpm --filter desktop build` |
| `pnpm test` | `pnpm -r test` |
| `pnpm lint` | `pnpm -r lint` |
| `pnpm deps` | `scripts/check-deps.sh` |
| `pnpm reinstall` | `pnpm clean && pnpm install` |

---

## Adding New Scripts

1. Keep under 300 LOC (one focused function)
2. Add shebang and runtime comment at top
3. Document in this file with all fields:
   - Path
   - Lines
   - Runtime
   - Purpose
   - Usage
   - Inputs
   - Outputs
   - Side Effects
   - Dependencies
   - Last Verified
4. Add to package.json if frequently used
5. Test on all supported platforms

---

## Scripts Exceeding 300 LOC

| Script | Lines | Status | Action |
|--------|-------|--------|--------|
| (none yet) | | | |

---

End of Script Registry
