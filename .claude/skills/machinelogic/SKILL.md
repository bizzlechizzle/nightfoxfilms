---
name: machinelogic
description: Complete planning and implementation workflow for ML and AI integration in Nightfox Films. Use when adding scene detection, smart cropping, face detection, sharpness scoring, AI captioning, or any ML/AI features for wedding video workflows. Handles research (PySceneDetect vs alternatives, OpenCV vs cloud), hardware analysis, LiteLLM configuration, implementation planning, coding, testing, and scoring. Triggers on "add AI", "add ML", "scene detection", "smart crop", "face detection", "sharpness", "integrate LLM", "vision model", "auto-caption", or any machine learning integration request.
---

# MachineLogic: ML/AI Integration Workflow for Wedding Video

Complete planning-to-deployment workflow for ML and AI integration in Nightfox Films.

## Workflow Overview

```
PHASE 1: Discovery      -> Understand the ML task, gather requirements
PHASE 2: Research       -> Compare solutions (PySceneDetect vs OpenCV vs Cloud)
PHASE 3: Hardware       -> Scan systems, recommend model sizes
PHASE 4: Plan           -> Create detailed implementation guide
PHASE 5: Audit Plan     -> Verify against CLAUDE.md, task requirements, best practices
PHASE 6: Implement      -> Code to the guide
PHASE 7: Audit Code     -> Verify code matches guide
PHASE 8: Test           -> Real-world testing with user data
PHASE 9: Score          -> Rate implementation, suggest improvements
```

**Gate checkpoints are optional** only pause for user approval when required or when clarification is needed.

---

## PHASE 1: Discovery

Identify the ML task type and gather requirements through conversation.

### Task Taxonomy for Wedding Video

| Task | Description | Example Use in Nightfox |
|------|-------------|-------------------------|
| **Scene Detection** | Find cut points and transitions | Split ceremony vs reception vs dancing |
| **Sharpness Scoring** | Rate frame quality | Pick best screenshot from scene |
| **Face Detection** | Find faces in frames | Smart crop for social media |
| **Smart Cropping** | Intelligent reframing | 9:16 vertical from 16:9 source |
| **Image Captioning** | Generate descriptions | Social media post captions |
| **Object Detection** | Find specific items | Detect cake, rings, bouquet |
| **Audio Analysis** | Speech/music detection | Find vows, first dance |

### Discovery Questions

Ask only what's needed:

1. **What problem are you solving?** (don't assume let user describe)
2. **What's the expected input?** (single videos, batches, specific scenes?)
3. **What output format?** (timestamps, cropped clips, JPEG stills, captions?)
4. **Quality vs speed tradeoff?** (wedding work = quality first)
5. **Offline requirement?** (must work without internet?)
6. **Social media targets?** (Instagram Reels, TikTok, YouTube Shorts?)

**Continue to Phase 2 when task type and requirements are clear.**

---

## PHASE 2: Research

Research the best solution using the comparison framework.

### Research Requirements

All recommendations must meet these criteria:

1. **Accurate Results** Quality over quantity
2. **Battle Tested** Well documented, proven in production
3. **Actively Supported** Bonus points for active maintenance
4. **Usable Results** Output must integrate with Nightfox data model

### Comparison Framework for Wedding Video

For each ML task, compare THREE approaches:

| Approach | What to Evaluate |
|----------|------------------|
| **Python Native** | PySceneDetect, OpenCV, dlib, local inference |
| **FFmpeg Filters** | Built-in detection via ffmpeg filters |
| **Cloud/API** | AWS Rekognition, Google Cloud Vision (offline fallback required) |

### Wedding Video ML Solutions

#### Scene Detection

| Solution | Pros | Cons |
|----------|------|------|
| **PySceneDetect** | Multiple detectors, EDL output, ffmpeg integration | Python subprocess |
| **FFmpeg scdet** | Native, fast, no Python | Less accurate, limited output |
| **Manual keyframes** | Full control | Labor intensive |

**Recommendation**: PySceneDetect with ContentDetector (fast cuts) + AdaptiveDetector (camera movement)

#### Sharpness Scoring

| Solution | Pros | Cons |
|----------|------|------|
| **OpenCV Laplacian** | Fast, simple, proven | Needs threshold tuning |
| **FFmpeg blackdetect** | Native | Not sharpness, just black |
| **Tenengrad/Brenner** | Alternative metrics | More complex |

**Recommendation**: OpenCV Laplacian variance simple, fast, effective

#### Face Detection

| Solution | Pros | Cons |
|----------|------|------|
| **OpenCV Haar** | Fast, offline, well-documented | Less accurate than neural |
| **dlib HOG** | Better accuracy | Slower |
| **MediaPipe** | Best accuracy, landmarks | Heavier dependency |

**Recommendation**: MediaPipe Face Detection for accuracy, OpenCV Haar for speed fallback

#### Smart Cropping

| Solution | Pros | Cons |
|----------|------|------|
| **Face-centered** | Good for people | Misses context |
| **Saliency maps** | Content-aware | Heavier processing |
| **Rule of thirds** | Simple, consistent | Not adaptive |

**Recommendation**: Hybrid approach face detection + rule of thirds fallback

### Research Template

```markdown
## [Task Name] Research

### Python Native Implementation
- Library: [PySceneDetect/OpenCV/etc]
- Models available: [list]
- Accuracy: [benchmark if available]
- Integration method: [subprocess/native bindings]
- Docs: [URL]

### FFmpeg Implementation
- Filter: [scdet/blackdetect/etc]
- Accuracy: [benchmark if available]
- Integration method: [fluent-ffmpeg wrapper]
- Docs: [URL]

### Alternative/Cloud Implementation
- Service: [AWS/Google/etc]
- Accuracy: [benchmark if available]
- Offline fallback: [required]
- Docs: [URL]

### Recommendation
[Winner] because [specific reasons tied to Nightfox requirements]

### LLM Enhancement Path
How results flow to LiteLLM for enhancement:
- Raw output: [what the ML model produces]
- Enhancement prompt: [how LLM improves/verifies results]
- Final output: [what gets stored in database]
```

**Continue to Phase 3 when recommendation is selected.**

---

## PHASE 3: Hardware Analysis

Scan available hardware and recommend optimal configuration.

### Hardware Detection Script

```bash
# System info
echo "=== SYSTEM ==="
uname -a

# macOS specific
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "=== APPLE SILICON ==="
    sysctl -n machdep.cpu.brand_string
    system_profiler SPHardwareDataType | grep -E "Chip|Memory|Cores"

    echo "=== GPU ==="
    system_profiler SPDisplaysDataType | grep -E "Chipset|VRAM|Metal"
fi

# Python GPU support
echo "=== PYTHON GPU SUPPORT ==="
python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}'); print(f'MPS: {torch.backends.mps.is_available()}')" 2>/dev/null || echo "PyTorch not installed"

# FFmpeg capabilities
echo "=== FFMPEG ==="
ffmpeg -version | head -1
ffmpeg -hwaccels 2>/dev/null | head -10
```

### Model Size Recommendations for Wedding Video

| Hardware | Scene Detection | Face Detection | VLM for Captioning |
|----------|-----------------|----------------|-------------------|
| M1/M2 8GB | PySceneDetect default | MediaPipe | 7B Q4 (Qwen2-VL) |
| M1/M2/M3 16GB | PySceneDetect default | MediaPipe | 7B Q6/Q8 |
| M3 Pro/Max 32GB+ | PySceneDetect default | MediaPipe | 14B+ Q8 |

### LLM Serving Recommendation

For local LLM serving, evaluate:
- **Ollama** Simplest setup, good for development
- **llama.cpp** Most flexible, best performance tuning
- **vLLM** Best for high-throughput serving

**All LLM calls route through LiteLLM** never hardwire a specific provider.

**Continue to Phase 4 when hardware is analyzed and model sizes selected.**

---

## PHASE 4: Implementation Plan

Create a detailed implementation guide written for a less experienced coder.

### Plan Document Structure

Create `/docs/ml-implementation-guides/[feature-name].md`:

```markdown
# [Feature Name] Implementation Guide

## Overview
- **Task**: [what this does]
- **ML Model**: [selected model/library]
- **LLM Enhancement**: [how LiteLLM improves results]
- **Target Hardware**: [where this runs]

## Prerequisites
- [ ] Dependencies installed
- [ ] Python environment configured
- [ ] LiteLLM configured (if using AI)
- [ ] Test wedding footage available

## Architecture

### Data Flow
[Diagram or description of how data flows]

### File Changes
| File | Change Type | Description |
|------|-------------|-------------|
| `electron/services/...` | New | ML inference service |
| `electron/external/...` | New | Python subprocess wrapper |
| etc. | | |

## Step-by-Step Implementation

### Step 1: [First Step]
**Why**: [explain reasoning]
**What**: [specific changes]

```typescript
// Example code with comments explaining each part
```

### Step 2: [Second Step]
[continue pattern]

## Expected Results

### Success Criteria
- [ ] [Specific measurable outcome]
- [ ] [Performance target e.g., <5s per minute of video]
- [ ] [Accuracy target e.g., detects 90% of scene changes]

### Test Cases
| Input | Expected Output |
|-------|-----------------|
| [ceremony clip] | [expected scene count] |
| [reception clip] | [expected face positions] |

## Troubleshooting
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| [problem] | [cause] | [solution] |
```

**Continue to Phase 5 when plan document is complete.**

---

## PHASE 5: Audit Plan

Verify the plan before coding begins.

### Audit Checklist

#### vs Original Task Requirements
- [ ] Solves the stated problem
- [ ] Meets accuracy requirements
- [ ] Handles edge cases (low light, motion blur, multiple faces)
- [ ] Output format matches Nightfox data model

#### vs CLAUDE.md
- [ ] Follows project architecture patterns
- [ ] Uses established IPC patterns
- [ ] Matches existing service structure
- [ ] Follows error handling conventions
- [ ] Adheres to TypeScript conventions

#### vs Dependency Best Practices
- [ ] Dependencies are well-maintained
- [ ] No known security vulnerabilities
- [ ] License compatible (MIT/Apache preferred)
- [ ] Minimal dependency footprint
- [ ] Works offline

#### vs LiteLLM Integration
- [ ] All LLM calls route through LiteLLM
- [ ] Model aliases used (not hardcoded model names)
- [ ] Fallback behavior defined
- [ ] Error handling for LLM failures

### Audit Output

```markdown
## Plan Audit Results

### Passed
- [x] [item]

### Failed (Must Fix)
- [ ] [item] [what needs to change]

### Warnings (Consider)
- [item] [suggestion]

### Fixes Applied
- [change made]
```

**Continue to Phase 6 when audit passes.**

---

## PHASE 6: Implementation

Code to the guide follow it step by step.

### Implementation Rules

1. **Follow the guide literally** Don't improvise
2. **One step at a time** Complete each step before moving on
3. **Commit messages reference guide** "Implement Step 3: Add scene detection service"
4. **Test as you go** Don't wait until the end

### LiteLLM Integration Pattern

All LLM calls use this pattern:

```typescript
// packages/desktop/electron/services/ai/litellm-client.ts

interface LiteLLMConfig {
  baseUrl: string;      // Default: http://localhost:4000
  modelAlias: string;   // e.g., "local-vlm", "local-llm"
}

interface CaptionResult {
  caption: string;
  hashtags: string[];
  source: {
    model: string;
    provider: string;
    timestamp: Date;
  };
}

async function generateCaption(
  frames: string[],  // Base64 encoded
  context: { couple: string; event: string }
): Promise<CaptionResult> {
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local-vlm',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(context) },
          ...frames.map(f => ({ type: 'image_url', image_url: { url: f } }))
        ]
      }],
    }),
  });
  // ... handle response
}
```

### Python Subprocess Pattern

```typescript
// packages/desktop/electron/services/scene-detection-service.ts

import { spawn } from 'child_process';
import { join } from 'path';

interface SceneResult {
  scenes: Array<{
    start_time: number;
    end_time: number;
    start_frame: number;
    end_frame: number;
  }>;
  duration_ms: number;
}

export async function detectScenes(videoPath: string): Promise<SceneResult> {
  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();  // From settings or bundled
    const scriptPath = join(__dirname, '../../scripts/scene_detect.py');

    const proc = spawn(pythonPath, [scriptPath, '--input', videoPath, '--output', 'json']);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout));
      } else {
        reject(new Error(`Scene detection failed: ${stderr}`));
      }
    });
  });
}
```

**Continue to Phase 7 when implementation is complete.**

---

## PHASE 7: Audit Code

Verify code matches the implementation guide.

### Code Audit Checklist

- [ ] Every step in guide has corresponding code
- [ ] Code matches guide's patterns (not improvised alternatives)
- [ ] All TODO comments resolved
- [ ] No hardcoded values that should be configurable
- [ ] Error handling matches guide
- [ ] Types match guide's definitions

### Discrepancy Handling

If code differs from guide:

1. **Guide was wrong** Update guide, document why
2. **Code deviated** Fix code to match guide
3. **Better approach found** Update both guide and code, document reasoning

**Continue to Phase 8 when code audit passes.**

---

## PHASE 8: Real-World Testing

Test with actual wedding footage.

### Pre-Test Checklist

Ask user:
- [ ] Test footage location (folder path)
- [ ] Expected results for sample clips (ground truth)
- [ ] Any edge cases to specifically test (low light, fast cuts, etc.)
- [ ] Performance requirements (seconds per minute of video)

### Test Protocol for Wedding Video

```markdown
## Test Run: [Date]

### Environment
- Machine: [hardware]
- Model: [model name if using ML]
- LiteLLM config: [relevant settings]
- Test footage: [ceremony / reception / etc.]

### Scene Detection Test Cases

| Video | Duration | Expected Scenes | Detected Scenes | Pass/Fail | Notes |
|-------|----------|-----------------|-----------------|-----------|-------|
| ceremony.mp4 | 45:00 | ~20 | | | |
| reception.mp4 | 2:00:00 | ~100 | | | |
| highlight.mp4 | 5:00 | ~30 | | | |

### Sharpness Scoring Test Cases

| Scene | Frame Count | Best Frame Expected | Best Frame Detected | Quality Score |
|-------|-------------|--------------------|--------------------|---------------|
| vows_01 | 300 | ~frame 150 | | |
| first_dance | 1800 | ~frame 900 | | |

### Face Detection Test Cases

| Frame | Expected Faces | Detected Faces | Correct? | Notes |
|-------|----------------|----------------|----------|-------|
| ceremony_wide.jpg | 2 (B&G) | | | |
| group_shot.jpg | 12 | | | |
| dance_blur.jpg | 2 | | | Motion blur test |

### Performance
- Video processed: [duration]
- Processing time: [duration]
- Ratio: [X:1 realtime]
- Memory peak: [MB]

### Issues Found
1. [issue description]
```

**Continue to Phase 9 when testing is complete.**

---

## PHASE 9: Scoring & Recommendations

Rate the implementation and suggest improvements.

### Scoring Rubric

| Dimension | Weight | Score (1-10) | Notes |
|-----------|--------|--------------|-------|
| **Accuracy** | 30% | | Results match expectations |
| **Performance** | 20% | | Speed meets wedding workflow needs |
| **Code Quality** | 20% | | Clean, maintainable, documented |
| **Guide Adherence** | 15% | | Implementation matches plan |
| **Integration** | 15% | | Works well with Nightfox codebase |

**Final Score**: `(Accuracy x 0.3) + (Performance x 0.2) + (Quality x 0.2) + (Adherence x 0.15) + (Integration x 0.15)`

### Score Interpretation

| Score | Meaning |
|-------|---------|
| 9-10 | Production ready |
| 7-8 | Good, minor improvements possible |
| 5-6 | Functional, needs refinement |
| <5 | Significant issues, revisit earlier phases |

### Recommendations Format

```markdown
## Implementation Score: [X.X]/10

### Strengths
- [what worked well]

### Improvements Required
1. [Critical] [issue] [suggested fix]
2. [Important] [issue] [suggested fix]

### Future Enhancements
- [optimization opportunity]
- [feature extension]

### Lessons Learned
- [what to do differently next time]
```

---

## Wedding Video ML Quick Reference

### Scene Detection Settings

```python
# PySceneDetect recommended settings for wedding video
from scenedetect import detect, ContentDetector, AdaptiveDetector

# For ceremony/speeches (slow, subtle changes)
scenes = detect(video_path, AdaptiveDetector(
    adaptive_threshold=3.0,
    min_scene_len=90  # 3 seconds at 30fps
))

# For reception/dancing (fast cuts, movement)
scenes = detect(video_path, ContentDetector(
    threshold=27.0,
    min_scene_len=30  # 1 second at 30fps
))
```

### Sharpness Scoring

```python
import cv2

def calculate_sharpness(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()

# Typical thresholds for wedding video
# < 100: Very blurry (motion blur, out of focus)
# 100-300: Acceptable
# 300-500: Good
# > 500: Very sharp
```

### Smart Crop for Social Media

```python
def smart_crop_9_16(frame, face_boxes):
    """Crop 16:9 to 9:16 keeping faces centered"""
    h, w = frame.shape[:2]
    target_w = int(h * 9 / 16)

    if face_boxes:
        # Center on primary face (largest)
        primary = max(face_boxes, key=lambda b: b['width'] * b['height'])
        center_x = primary['x'] + primary['width'] // 2
    else:
        # Rule of thirds fallback
        center_x = w // 2

    # Calculate crop bounds
    x1 = max(0, center_x - target_w // 2)
    x2 = min(w, x1 + target_w)
    x1 = max(0, x2 - target_w)  # Adjust if hitting right edge

    return frame[:, x1:x2]
```

---

## AI Source Attribution

All AI-generated content must include source attribution:

```typescript
interface AIResult {
  content: string;
  source: {
    model: string;        // e.g., "qwen2-vl:7b"
    provider: string;     // e.g., "ollama" (via LiteLLM)
    timestamp: Date;
    confidence?: number;  // if model provides it
  };
  safetyCheck: {
    reviewed: boolean;
    flags?: string[];
  };
}
```

Display attribution in UI per Braun design guidelines.
