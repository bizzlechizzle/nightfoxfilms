# RAM++ Auto-Tagging Implementation Guide

**Feature:** Automatic image tagging using RAM++ (Recognize Anything Model)
**Scope:** All image imports (local files + web images) with Lightbox viewing/editing
**Priority:** Background processing per CLAUDE.md Rule 9 (Local LLM Scope)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        IMPORT PIPELINES                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐         ┌──────────────────────────┐          │
│  │ FileImportService│         │ DownloadOrchestrator     │          │
│  │ (Local Files)    │         │ (Web Images)             │          │
│  └────────┬─────────┘         └────────────┬─────────────┘          │
│           │                                 │                        │
│           └─────────────┬───────────────────┘                        │
│                         ▼                                            │
│           ┌─────────────────────────────┐                           │
│           │       JobQueue              │                           │
│           │  queue: 'image-tagging'     │                           │
│           │  priority: BACKGROUND (0)   │                           │
│           └─────────────┬───────────────┘                           │
│                         ▼                                            │
│           ┌─────────────────────────────┐                           │
│           │   RAM++ Tagging Service     │                           │
│           │   (Background Worker)       │                           │
│           │   - HTTP API on PC (3090)   │                           │
│           │   - OR MPS on Mac Studio    │                           │
│           └─────────────┬───────────────┘                           │
│                         ▼                                            │
│           ┌─────────────────────────────┐                           │
│           │   SQLite: imgs.auto_tags    │                           │
│           │   JSON array of tags        │                           │
│           └─────────────────────────────┘                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### Migration XX: Add auto_tags column to imgs table

```sql
-- Migration XX: RAM++ Auto-Tagging Support
-- Adds auto_tags column to store ML-generated tags for images

ALTER TABLE imgs ADD COLUMN auto_tags TEXT;           -- JSON array: ["abandoned", "factory", "graffiti"]
ALTER TABLE imgs ADD COLUMN auto_tags_source TEXT;    -- "ram++", "manual", "hybrid"
ALTER TABLE imgs ADD COLUMN auto_tags_confidence TEXT; -- JSON: {"abandoned": 0.95, "factory": 0.87}
ALTER TABLE imgs ADD COLUMN auto_tags_generated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_imgs_auto_tags ON imgs(auto_tags) WHERE auto_tags IS NOT NULL;
```

**Fields:**
| Column | Type | Description |
|--------|------|-------------|
| `auto_tags` | TEXT (JSON) | Array of detected tags: `["abandoned", "decay", "industrial"]` |
| `auto_tags_source` | TEXT | Source: `ram++`, `manual`, `hybrid` (user edited ML tags) |
| `auto_tags_confidence` | TEXT (JSON) | Per-tag confidence: `{"abandoned": 0.95, "decay": 0.72}` |
| `auto_tags_generated_at` | TEXT | ISO timestamp of when tags were generated |

---

## 3. RAM++ Tagging Service

### 3.1 Service Architecture

Two deployment options based on hardware:

#### Option A: Remote API (PC with 3090) — Recommended for quality
```
┌─────────────────┐      HTTP POST       ┌─────────────────────┐
│  Electron App   │  ─────────────────▶  │  RAM++ API Server   │
│  (Mac Studio)   │  JSON + Base64 img   │  (PC with 3090)     │
│                 │  ◀─────────────────  │  FastAPI + PyTorch  │
│                 │     JSON tags        │                     │
└─────────────────┘                      └─────────────────────┘
```

#### Option B: Local MPS (Mac Studio) — Fallback
```
┌─────────────────────────────────────────────────────────────┐
│                      Electron App                            │
│  ┌───────────────┐    spawn     ┌─────────────────────────┐ │
│  │ Tagging Worker│ ──────────▶  │ Python subprocess       │ │
│  │               │              │ ram_tagger.py           │ │
│  │               │  ◀────────── │ MPS acceleration        │ │
│  │               │   stdout     │                         │ │
│  └───────────────┘              └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Service File: `packages/desktop/electron/services/ram-tagging-service.ts`

```typescript
/**
 * RAM++ Tagging Service
 *
 * Background image tagging using RAM++ (Recognize Anything Model).
 * Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
 *
 * @module services/ram-tagging-service
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { getLogger } from './logger-service';
import { getSettings } from '../main/settings';

const logger = getLogger();

// Tag categories relevant to abandoned places
const RELEVANT_CATEGORIES = [
  // Building types
  'factory', 'hospital', 'school', 'church', 'prison', 'asylum',
  'warehouse', 'power plant', 'mill', 'theater', 'hotel', 'house',

  // Conditions
  'abandoned', 'decay', 'ruins', 'overgrown', 'graffiti', 'broken',
  'collapsed', 'flooded', 'burned', 'vandalized', 'boarded up',

  // Architectural features
  'brick', 'concrete', 'steel', 'wood', 'tile', 'glass', 'columns',
  'staircase', 'hallway', 'roof', 'tower', 'chimney', 'window',

  // Objects
  'machinery', 'pipes', 'equipment', 'furniture', 'car', 'train',
  'elevator', 'boiler', 'tank', 'crane', 'conveyor',

  // Environment
  'forest', 'field', 'urban', 'industrial', 'rural', 'waterfront',
];

export interface TagResult {
  tags: string[];
  confidence: Record<string, number>;
  raw_tags?: string[];  // All tags before filtering
  duration_ms: number;
}

export interface TaggingConfig {
  // Remote API (preferred for 3090)
  apiUrl?: string;              // e.g., "http://192.168.1.100:8080"
  apiTimeout?: number;          // ms, default 30000

  // Local inference (fallback)
  pythonPath?: string;          // Path to python with RAM++ installed
  modelPath?: string;           // Path to RAM++ weights
  device?: 'cuda' | 'mps' | 'cpu';

  // Processing
  confidenceThreshold?: number; // Min confidence to include tag (0.5)
  maxTags?: number;             // Max tags per image (20)
  filterRelevant?: boolean;     // Only keep RELEVANT_CATEGORIES (true)
}

export class RamTaggingService {
  private config: Required<TaggingConfig>;
  private initialized = false;

  constructor(config: TaggingConfig = {}) {
    this.config = {
      apiUrl: config.apiUrl ?? '',
      apiTimeout: config.apiTimeout ?? 30000,
      pythonPath: config.pythonPath ?? 'python3',
      modelPath: config.modelPath ?? '',
      device: config.device ?? 'cpu',
      confidenceThreshold: config.confidenceThreshold ?? 0.5,
      maxTags: config.maxTags ?? 20,
      filterRelevant: config.filterRelevant ?? false,  // Keep all tags, let user filter
    };
  }

  /**
   * Initialize the service
   * Checks for remote API availability, falls back to local
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Try remote API first
    if (this.config.apiUrl) {
      try {
        const response = await fetch(`${this.config.apiUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          logger.info('RamTagging', `Connected to remote API at ${this.config.apiUrl}`);
          this.initialized = true;
          return;
        }
      } catch (e) {
        logger.warn('RamTagging', 'Remote API not available, will use local inference');
      }
    }

    // Fallback: verify local Python + RAM++ installation
    // This would check for the ram_tagger.py script and model weights
    this.initialized = true;
  }

  /**
   * Tag a single image
   *
   * @param imagePath - Absolute path to image file
   * @returns TagResult with tags and confidence scores
   */
  async tagImage(imagePath: string): Promise<TagResult> {
    const startTime = Date.now();

    // Prefer remote API for quality
    if (this.config.apiUrl) {
      return await this.tagViaRemoteApi(imagePath, startTime);
    }

    // Fallback to local inference
    return await this.tagViaLocalInference(imagePath, startTime);
  }

  /**
   * Tag via remote API (PC with 3090)
   */
  private async tagViaRemoteApi(imagePath: string, startTime: number): Promise<TagResult> {
    // Read image and convert to base64
    const imageBuffer = await fs.readFile(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');

    const response = await fetch(`${this.config.apiUrl}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: `data:image/${ext};base64,${base64}`,
        threshold: this.config.confidenceThreshold,
        max_tags: this.config.maxTags,
      }),
      signal: AbortSignal.timeout(this.config.apiTimeout),
    });

    if (!response.ok) {
      throw new Error(`RAM++ API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as {
      tags: string[];
      confidence: Record<string, number>;
    };

    return {
      tags: this.filterTags(result.tags),
      confidence: result.confidence,
      raw_tags: result.tags,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Tag via local Python subprocess (Mac with MPS)
   */
  private async tagViaLocalInference(imagePath: string, startTime: number): Promise<TagResult> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../scripts/ram_tagger.py');

      const proc = spawn(this.config.pythonPath, [
        scriptPath,
        '--image', imagePath,
        '--device', this.config.device,
        '--threshold', String(this.config.confidenceThreshold),
        '--output', 'json',
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`RAM++ inference failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve({
            tags: this.filterTags(result.tags),
            confidence: result.confidence,
            raw_tags: result.tags,
            duration_ms: Date.now() - startTime,
          });
        } catch (e) {
          reject(new Error(`Failed to parse RAM++ output: ${stdout}`));
        }
      });
    });
  }

  /**
   * Filter tags to relevant categories (optional)
   */
  private filterTags(tags: string[]): string[] {
    if (!this.config.filterRelevant) {
      return tags.slice(0, this.config.maxTags);
    }

    return tags
      .filter(tag => RELEVANT_CATEGORIES.some(cat =>
        tag.toLowerCase().includes(cat) || cat.includes(tag.toLowerCase())
      ))
      .slice(0, this.config.maxTags);
  }

  /**
   * Batch tag multiple images
   * Useful for backfill jobs
   */
  async tagBatch(imagePaths: string[]): Promise<Map<string, TagResult>> {
    const results = new Map<string, TagResult>();

    for (const imagePath of imagePaths) {
      try {
        const result = await this.tagImage(imagePath);
        results.set(imagePath, result);
      } catch (e) {
        logger.warn('RamTagging', `Failed to tag ${imagePath}: ${e}`);
        results.set(imagePath, {
          tags: [],
          confidence: {},
          duration_ms: 0,
        });
      }
    }

    return results;
  }
}

// Singleton instance
let instance: RamTaggingService | null = null;

export function getRamTaggingService(): RamTaggingService {
  if (!instance) {
    // Load config from settings
    const config: TaggingConfig = {
      apiUrl: process.env.RAM_API_URL || '',
      device: process.platform === 'darwin' ? 'mps' : 'cuda',
    };
    instance = new RamTaggingService(config);
  }
  return instance;
}
```

---

## 4. Python API Server (PC with 3090)

### 4.1 File: `scripts/ram_api_server.py`

```python
#!/usr/bin/env python3
"""
RAM++ API Server

Runs on PC with 3090 GPU, serves tagging requests over HTTP.
Electron app sends images, receives tags.

Usage:
    python scripts/ram_api_server.py --port 8080

Requires:
    pip install fastapi uvicorn torch torchvision
    pip install git+https://github.com/xinyu1205/recognize-anything.git
"""

import argparse
import base64
import io
import time
from typing import Optional

import torch
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# RAM++ imports
from ram.models import ram_plus
from ram import inference_ram_plus as inference_ram
from ram import get_transform

app = FastAPI(title="RAM++ Tagging API", version="1.0.0")

# Enable CORS for Electron app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instance
model = None
transform = None
device = None


class TagRequest(BaseModel):
    image: str  # Base64 encoded image or data URL
    threshold: float = 0.5
    max_tags: int = 20


class TagResponse(BaseModel):
    tags: list[str]
    confidence: dict[str, float]
    duration_ms: float


class HealthResponse(BaseModel):
    status: str
    device: str
    model_loaded: bool


def load_model(model_path: str, device_str: str):
    """Load RAM++ model"""
    global model, transform, device

    device = torch.device(device_str)

    # Load model
    model = ram_plus(pretrained=model_path, image_size=384, vit='swin_l')
    model.eval()
    model = model.to(device)

    # Get transform
    transform = get_transform(image_size=384)

    print(f"RAM++ model loaded on {device}")


def decode_image(image_data: str) -> Image.Image:
    """Decode base64 image data"""
    # Handle data URL format
    if image_data.startswith('data:'):
        _, base64_data = image_data.split(',', 1)
    else:
        base64_data = image_data

    image_bytes = base64.b64decode(base64_data)
    return Image.open(io.BytesIO(image_bytes)).convert('RGB')


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        device=str(device) if device else "not initialized",
        model_loaded=model is not None,
    )


@app.post("/tag", response_model=TagResponse)
async def tag_image(request: TagRequest):
    """Tag an image using RAM++"""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    start_time = time.time()

    try:
        # Decode image
        image = decode_image(request.image)

        # Transform
        image_tensor = transform(image).unsqueeze(0).to(device)

        # Inference
        with torch.no_grad():
            tags, confidences = inference_ram.inference(image_tensor, model)

        # Parse results
        tag_list = [t.strip() for t in tags[0].split('|')]
        confidence_dict = {}

        # Filter by threshold and limit
        filtered_tags = []
        for i, tag in enumerate(tag_list):
            conf = confidences[0][i].item() if i < len(confidences[0]) else 0.5
            if conf >= request.threshold:
                filtered_tags.append(tag)
                confidence_dict[tag] = round(conf, 3)

        # Limit tags
        filtered_tags = filtered_tags[:request.max_tags]

        duration_ms = (time.time() - start_time) * 1000

        return TagResponse(
            tags=filtered_tags,
            confidence=confidence_dict,
            duration_ms=round(duration_ms, 2),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def main():
    parser = argparse.ArgumentParser(description="RAM++ Tagging API Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--model", type=str, default="ram_plus_swin_large_14m.pth",
                        help="Path to RAM++ model weights")
    parser.add_argument("--device", type=str, default="cuda",
                        help="Device: cuda, cpu, or mps")
    args = parser.parse_args()

    # Load model
    load_model(args.model, args.device)

    # Run server
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
```

---

## 5. Job Queue Integration

### 5.1 Add Queue Name to `job-queue.ts`

```typescript
// Add to IMPORT_QUEUES constant
export const IMPORT_QUEUES = {
  // ... existing queues ...

  // Image auto-tagging (lowest priority, runs after all other processing)
  IMAGE_TAGGING: 'image-tagging',
} as const;
```

### 5.2 Job Handler: `packages/desktop/electron/services/import/tagging-job-handler.ts`

```typescript
/**
 * Tagging Job Handler
 *
 * Processes IMAGE_TAGGING jobs from the queue.
 * Runs in background with lowest priority.
 *
 * @module services/import/tagging-job-handler
 */

import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import { getRamTaggingService } from '../ram-tagging-service';
import { getLogger } from '../logger-service';

const logger = getLogger();

export interface TaggingJobPayload {
  imghash: string;
  imagePath: string;
  locid: string;
}

export interface TaggingJobResult {
  success: boolean;
  imghash: string;
  tags?: string[];
  error?: string;
  duration_ms?: number;
}

/**
 * Process a single tagging job
 */
export async function handleTaggingJob(
  db: Kysely<Database>,
  payload: TaggingJobPayload
): Promise<TaggingJobResult> {
  const { imghash, imagePath, locid } = payload;

  try {
    const service = getRamTaggingService();
    await service.initialize();

    const result = await service.tagImage(imagePath);

    // Store tags in database
    const now = new Date().toISOString();
    await db
      .updateTable('imgs')
      .set({
        auto_tags: JSON.stringify(result.tags),
        auto_tags_source: 'ram++',
        auto_tags_confidence: JSON.stringify(result.confidence),
        auto_tags_generated_at: now,
      })
      .where('imghash', '=', imghash)
      .execute();

    logger.info('TaggingJob', `Tagged image ${imghash.slice(0, 8)}... with ${result.tags.length} tags in ${result.duration_ms}ms`);

    return {
      success: true,
      imghash,
      tags: result.tags,
      duration_ms: result.duration_ms,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn('TaggingJob', `Failed to tag ${imghash}: ${error}`);

    return {
      success: false,
      imghash,
      error,
    };
  }
}
```

---

## 6. Import Pipeline Integration

### 6.1 Hook into FileImportService

In `file-import-service.ts`, after successful image import, enqueue tagging job:

```typescript
// Add after Step 7 (database insert) for images
if (type === 'image' && result.success && !result.duplicate) {
  // Queue tagging job (background, lowest priority)
  const jobQueue = getJobQueue();
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.IMAGE_TAGGING,
    priority: JOB_PRIORITY.BACKGROUND,  // 0 = lowest
    payload: {
      imghash: hash,
      imagePath: archivePath,
      locid: file.locid,
    } as TaggingJobPayload,
  });
}
```

### 6.2 Hook into DownloadOrchestrator (Web Images)

In `download-orchestrator.ts`, after image is staged and imported:

```typescript
// After image is added to archive, queue tagging
if (importResult.success && importResult.type === 'image') {
  const jobQueue = getJobQueue();
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.IMAGE_TAGGING,
    priority: JOB_PRIORITY.BACKGROUND,
    payload: {
      imghash: importResult.hash,
      imagePath: importResult.archivePath,
      locid: locid,
    } as TaggingJobPayload,
  });
}
```

---

## 7. Worker Integration

### 7.1 Register Handler in Job Worker Service

In `job-worker-service.ts`:

```typescript
import { handleTaggingJob, type TaggingJobPayload } from './import/tagging-job-handler';

// Add to job handlers
private readonly handlers: Map<string, JobHandler> = new Map([
  // ... existing handlers ...
  [IMPORT_QUEUES.IMAGE_TAGGING, async (job) => {
    return await handleTaggingJob(this.db, job.payload as TaggingJobPayload);
  }],
]);
```

---

## 8. UI: Lightbox Tag Display & Editing

### 8.1 Update MediaViewer.svelte

Add tag display panel below image info:

```svelte
<!-- Tags Section -->
{#if currentMedia?.type === 'image'}
  <div class="border-t border-braun-200 pt-4 mt-4">
    <div class="flex items-center justify-between mb-2">
      <h4 class="text-sm font-medium text-braun-700">Tags</h4>
      <button
        onclick={() => isEditingTags = !isEditingTags}
        class="text-xs text-braun-500 hover:text-braun-700"
      >
        {isEditingTags ? 'Done' : 'Edit'}
      </button>
    </div>

    {#if currentTags.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each currentTags as tag}
          <span
            class="px-2 py-1 text-xs rounded-full
                   {isEditingTags ? 'bg-braun-100 cursor-pointer hover:bg-red-100' : 'bg-braun-100'}
                   text-braun-700"
            onclick={() => isEditingTags && removeTag(tag)}
          >
            {tag}
            {#if isEditingTags}
              <span class="ml-1 text-red-500">×</span>
            {/if}
          </span>
        {/each}
      </div>
    {:else if !tagsLoading}
      <p class="text-xs text-braun-400 italic">
        {tagsQueued ? 'Tagging in progress...' : 'No tags yet'}
      </p>
    {/if}

    {#if isEditingTags}
      <div class="mt-2">
        <input
          type="text"
          placeholder="Add tag..."
          bind:value={newTag}
          onkeydown={(e) => e.key === 'Enter' && addTag()}
          class="w-full px-2 py-1 text-sm border border-braun-200 rounded"
        />
      </div>
    {/if}
  </div>
{/if}
```

### 8.2 Tag State and Functions

```typescript
// Tag state
let currentTags = $state<string[]>([]);
let tagsLoading = $state(false);
let tagsQueued = $state(false);
let isEditingTags = $state(false);
let newTag = $state('');

// Load tags when image changes
$effect(() => {
  if (currentMedia?.type === 'image') {
    loadTags(currentMedia.hash);
  }
});

async function loadTags(imghash: string) {
  tagsLoading = true;
  try {
    const result = await window.electron.media.getImageTags(imghash);
    currentTags = result.tags || [];
    tagsQueued = result.queued || false;
  } catch (e) {
    console.error('Failed to load tags:', e);
  }
  tagsLoading = false;
}

async function addTag() {
  if (!newTag.trim() || !currentMedia) return;

  const tag = newTag.trim().toLowerCase();
  if (!currentTags.includes(tag)) {
    currentTags = [...currentTags, tag];
    await window.electron.media.updateImageTags(currentMedia.hash, currentTags, 'hybrid');
  }
  newTag = '';
}

async function removeTag(tag: string) {
  if (!currentMedia) return;
  currentTags = currentTags.filter(t => t !== tag);
  await window.electron.media.updateImageTags(currentMedia.hash, currentTags, 'hybrid');
}
```

---

## 9. IPC Handlers

### 9.1 Add to `media-handlers.ts`

```typescript
// Get image tags
ipcMain.handle('media:getImageTags', async (_, imghash: string) => {
  const img = await db
    .selectFrom('imgs')
    .select(['auto_tags', 'auto_tags_source', 'auto_tags_confidence'])
    .where('imghash', '=', imghash)
    .executeTakeFirst();

  if (!img) {
    return { tags: [], source: null, confidence: {} };
  }

  // Check if tagging is queued
  const job = await db
    .selectFrom('jobs')
    .select(['status'])
    .where('queue', '=', 'image-tagging')
    .where('payload', 'like', `%${imghash}%`)
    .where('status', 'in', ['pending', 'processing'])
    .executeTakeFirst();

  return {
    tags: img.auto_tags ? JSON.parse(img.auto_tags) : [],
    source: img.auto_tags_source,
    confidence: img.auto_tags_confidence ? JSON.parse(img.auto_tags_confidence) : {},
    queued: !!job,
  };
});

// Update image tags (manual edit)
ipcMain.handle('media:updateImageTags', async (_, imghash: string, tags: string[], source: string) => {
  const now = new Date().toISOString();
  await db
    .updateTable('imgs')
    .set({
      auto_tags: JSON.stringify(tags),
      auto_tags_source: source,
      auto_tags_generated_at: now,
    })
    .where('imghash', '=', imghash)
    .execute();

  return { success: true };
});

// Trigger re-tagging for an image
ipcMain.handle('media:retagImage', async (_, imghash: string) => {
  const img = await db
    .selectFrom('imgs')
    .select(['imgloc', 'locid'])
    .where('imghash', '=', imghash)
    .executeTakeFirst();

  if (!img) {
    throw new Error('Image not found');
  }

  const jobQueue = getJobQueue();
  const jobId = await jobQueue.addJob({
    queue: IMPORT_QUEUES.IMAGE_TAGGING,
    priority: JOB_PRIORITY.HIGH,  // User-initiated = higher priority
    payload: {
      imghash,
      imagePath: img.imgloc,
      locid: img.locid,
    },
  });

  return { jobId };
});
```

### 9.2 Add to Preload Bridge

```javascript
// In preload.cjs
media: {
  // ... existing methods ...
  getImageTags: (imghash) => ipcRenderer.invoke('media:getImageTags', imghash),
  updateImageTags: (imghash, tags, source) => ipcRenderer.invoke('media:updateImageTags', imghash, tags, source),
  retagImage: (imghash) => ipcRenderer.invoke('media:retagImage', imghash),
},
```

---

## 10. Settings Integration

### 10.1 Add to Settings Page

```svelte
<!-- RAM++ Configuration -->
<div class="border-b border-braun-200 pb-6">
  <h3 class="text-lg font-medium text-braun-900 mb-4">Auto-Tagging</h3>

  <div class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-braun-700 mb-1">
        RAM++ API Server
      </label>
      <input
        type="text"
        placeholder="http://192.168.1.100:8080"
        bind:value={ramApiUrl}
        class="w-full px-3 py-2 border border-braun-200 rounded"
      />
      <p class="text-xs text-braun-500 mt-1">
        Leave empty to use local inference (slower)
      </p>
    </div>

    <div>
      <label class="flex items-center space-x-2">
        <input
          type="checkbox"
          bind:checked={autoTagOnImport}
          class="rounded border-braun-300"
        />
        <span class="text-sm text-braun-700">
          Automatically tag images on import
        </span>
      </label>
    </div>

    <button
      onclick={testRamConnection}
      disabled={testingRam}
      class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-800 disabled:opacity-50"
    >
      {testingRam ? 'Testing...' : 'Test Connection'}
    </button>

    {#if ramTestResult}
      <p class="text-sm {ramTestResult.success ? 'text-green-600' : 'text-red-600'}">
        {ramTestResult.message}
      </p>
    {/if}
  </div>
</div>
```

---

## 11. Backfill Script

For existing images without tags:

### 11.1 File: `scripts/backfill-image-tags.py`

```python
#!/usr/bin/env python3
"""
Backfill image tags using RAM++ for existing images.

Usage:
    python scripts/backfill-image-tags.py --limit 100
    python scripts/backfill-image-tags.py --dry-run
"""

import argparse
import json
import sqlite3
from pathlib import Path

# ... implementation similar to backfill-extractions.py ...
```

---

## 12. Implementation Checklist

### Phase 1: Database & Service
- [ ] Add Migration XX for auto_tags columns
- [ ] Create `ram-tagging-service.ts`
- [ ] Create `ram_api_server.py` for PC with 3090
- [ ] Add IMAGE_TAGGING queue to job-queue.ts
- [ ] Create tagging-job-handler.ts

### Phase 2: Import Integration
- [ ] Hook into FileImportService (local imports)
- [ ] Hook into DownloadOrchestrator (web images)
- [ ] Register handler in JobWorkerService

### Phase 3: UI
- [ ] Add tag display to MediaViewer.svelte
- [ ] Add tag editing capability
- [ ] Add "Re-tag" button for manual trigger
- [ ] Add Settings UI for RAM++ configuration

### Phase 4: IPC & Preload
- [ ] Add media:getImageTags handler
- [ ] Add media:updateImageTags handler
- [ ] Add media:retagImage handler
- [ ] Update preload.cjs

### Phase 5: Testing & Backfill
- [ ] Test with local images
- [ ] Test with web images
- [ ] Create backfill script for existing images
- [ ] Document in lilbits.md

---

## 13. Configuration

### Environment Variables

```bash
# RAM++ API server URL (PC with 3090)
RAM_API_URL=http://192.168.1.100:8080

# Local inference device (fallback)
RAM_DEVICE=mps  # or 'cuda' or 'cpu'
```

### Settings Table

```sql
-- Auto-tagging settings
INSERT INTO settings (key, value) VALUES
  ('ram_api_url', 'http://192.168.1.100:8080'),
  ('auto_tag_on_import', 'true'),
  ('tag_confidence_threshold', '0.5');
```

---

## 14. Performance Considerations

| Metric | Target | Notes |
|--------|--------|-------|
| Tagging latency (3090) | <500ms | Per image, remote API |
| Tagging latency (MPS) | <2s | Per image, local inference |
| Queue throughput | 100+ img/min | With remote API |
| Memory (model loaded) | ~4GB | RAM++ model on GPU |

---

## 15. Error Handling

- **API timeout**: Retry with exponential backoff (max 3 attempts)
- **Model not loaded**: Queue job for later, don't fail import
- **Invalid image**: Skip tagging, log warning
- **Network error**: Fallback to local inference if available

---

## 16. Future Enhancements

1. **Batch tagging**: Send multiple images in one API call
2. **Tag suggestions**: Show common tags for location type
3. **Tag search**: Find images by tag across all locations
4. **Tag statistics**: Dashboard showing most common tags
5. **Custom tag categories**: User-defined tag groups
