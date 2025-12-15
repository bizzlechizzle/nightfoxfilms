# Nightfox Films

Manage wedding videography workflows with camera profiles, automated imports, and social media asset generation.

## Three-Doc Stack

This project uses three core instruction files. Read them in order before any task:

| File | Purpose | Modify? |
|------|---------|---------|
| **CLAUDE.md** (this file) | Project rules, architecture, constraints, reference index | Never |
| **@techguide.md** | Implementation details, build setup, environment config, deep troubleshooting | Never |
| **@lilbits.md** | Script registry every utility script with purpose, usage, line count | Never |

These three files are the complete instruction set. All other docs are reference material consulted on-demand.

**If any of these files are missing, empty, or unreadable: STOP and report to human. Do not proceed.**

## Quick Context

- **Mission**: Streamline wedding video workflows from import through social media delivery
- **Current**: Desktop release v0.1.0 (Electron + Svelte)
- **Target**: Camera-aware import pipeline with smart asset generation (screenshots, clips, captions)
- **Persona**: Wedding videographer managing footage across multiple camera sources and couples
- **Runtime**: Node >=20, pnpm >=10, Electron 35+

## Boot Sequence

1. Read this file (CLAUDE.md) completely
2. Read @techguide.md for implementation details
3. Read @lilbits.md for script registry
4. Read the task request
5. **Then** touch code not before

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Run desktop app in dev mode
pnpm build            # Build all packages for production
pnpm -r test          # Run tests in all packages
pnpm -r lint          # Lint all packages
pnpm format           # Format code with Prettier
pnpm --filter core build      # Build only core package
pnpm --filter desktop rebuild # Rebuild native modules (better-sqlite3, sharp)
pnpm reinstall        # Clean and reinstall (fixes native module issues)
```

> **Note**: Verify these commands match `package.json` scripts before relying on them.

## Development Rules

1. **Scope Discipline** Only implement what the current request describes; no surprise features
2. **Workflow-First** Every change must serve import, organization, or asset generation workflows
3. **Prefer Open Source + Verify Licenses** Default to open tools, avoid cloud services, log every dependency license
4. **Offline-First** Assume zero connectivity; add graceful fallbacks when online helpers exist
5. **One Script = One Function** Keep each script focused, under ~300 lines, recorded in lilbits.md
6. **No AI in Docs** Never mention Claude, ChatGPT, Codex, or similar in user-facing docs or UI
7. **Keep It Simple** Favor obvious code, minimal abstraction, fewer files
8. **Binary Dependencies Welcome** App size is not a concern; freely add binaries (ffmpeg, ffprobe, exiftool, blake3) when they solve problems better than pure-JS alternatives
9. **Real-Time UI Updates** Any operation that modifies data (imports, saves, deletes) must trigger automatic UI refresh. Never require manual page refresh to see changes. Use IPC events from main process to notify renderer when data changes.
10. **Verify Build Before Done** After any implementation work, run `pnpm build` and `pnpm dev` to confirm the app compiles and boots without errors. Monitor console output for crashes, native module failures, or import errors. A feature is not complete until the app runs.

## Do Not

- Invent new features, pages, or data models beyond what the task or referenced docs authorize
- Bypass the hashing contract when importing media or linking files to couples
- Remove or rename migration files; schema edits go through new migrations only
- Leak or transmit local data outside the user's machine
- Add third-party SDKs or services without logging licenses and confirming they function offline
- Mention AI assistants in UI, user docs, exports, or metadata
- Leave TODOs or unexplained generated code in production branches
- **Modify or remove core instruction files** CLAUDE.md, techguide.md, and lilbits.md are protected; flag issues for human review instead of auto-fixing
- **Assume when uncertain** If a task is ambiguous or conflicts with these rules, stop and ask

## Stop and Ask When

- Task requires modifying CLAUDE.md, techguide.md, or lilbits.md
- Task conflicts with a rule in this file
- Referenced file or path doesn't exist
- Task scope is unclear or seems to exceed "one feature"
- You're about to delete code without understanding why it exists
- Schema change is needed but not explicitly authorized

## Critical Gotchas

| Gotcha | Details |
|--------|---------|
| **Preload MUST be CommonJS** | Static `.cjs` file copied via custom Vite plugin (NOT bundled). Use `require('electron')` only, never `import`. ES module syntax crashes at runtime before UI loads. See `vite.config.ts` `copyPreloadPlugin()`. |
| **Database source of truth** | `migrations/` only. Never edit schema inline in docs or ad-hoc SQL files. |
| **Database location** | `./data/nightfox.db` (project-relative in dev), `[userData]/nightfox.db` (production). Foreign keys always enabled via PRAGMA on connection. |
| **Camera profile matching** | Filename patterns > Folder patterns > Metadata make/model. If no match, store `detected_make`/`detected_model` with `camera_id = NULL`. |
| **Import spine** | Scanner finds files -> hashes every file -> metadata extraction -> camera matching -> copies into managed folder -> links via BLAKE3 primary keys |
| **Hashing first** | BLAKE3 computed before any metadata extraction or file moves |
| **Managed folder structure** | `[storage_path]/[year]/[date]-[couple-name]/raw/{medium}/` (ADR-001) |
| **Ownership pledge** | All assets stay on disk. No telemetry, no cloud sync, no auto-updates. |
| **Dual storage** | SQLite is source of truth; JSON exports per couple for portability |
| **pnpm v10+ native modules** | Project pre-configures `onlyBuiltDependencies` for better-sqlite3, electron, sharp, esbuild, blake3. If "Ignored build scripts" warnings appear, run `pnpm reinstall`. |
| **Native modules in Vite** | Native modules with platform-specific binaries (better-sqlite3, sharp, blake3) MUST be in `vite.config.ts` external array. Bundling them causes "Could not dynamically require" crashes at runtime. |
| **Sidecar file handling** | .TOD/.MOI pairs, .LRF, .THM, .SRT are linked as sidecars, not standalone files |

## Architecture (Quick)

- **Pattern**: Clean architecture (presentation -> infrastructure -> core domain) in pnpm monorepo
- **Layout**: `packages/core` = domain models, repository contracts; `packages/desktop` = Electron main + renderer + services
- **IPC flow**: Renderer -> Preload bridge -> Main -> Desktop services
- **IPC naming**: `domain:action` format (e.g., `camera:create`, `couple:import`, `file:hash`)
- **Security**: `contextIsolation: true`, `sandbox: false` (for drag-drop), no nodeIntegration in renderer
- **Testing priority**: Unit focus on hashing pipeline, camera pattern matching, metadata extraction

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Svelte components | PascalCase | `CameraCard.svelte` |
| Services/utilities | kebab-case | `hash-service.ts` |
| Domain models | PascalCase | `Camera.ts` |
| IPC handlers | kebab-case with domain prefix | `camera-handlers.ts` |
| Migrations | timestamp prefix | `001_initial_schema.sql` |

## Domain Model Overview

### Mediums

| Medium | Description | Typical Extensions |
|--------|-------------|-------------------|
| `dadcam` | VHS, mini-DV, digital camcorder | .tod, .moi, .mts, .m2ts, .mpg |
| `super8` | Film scans (digitized) | .mov, .mp4 |
| `modern` | Contemporary digital cameras | .mp4, .mov, .mxf |

### Camera Profiles

Camera profiles enable automatic file routing and LUT application:

```
Camera Profile
├── Identity
│   ├── name: "Canon HV20"
│   ├── medium: dadcam | super8 | modern
│   └── notes: "MiniDV camera, 1080i AVCHD"
│
├── File Matching (priority order)
│   ├── filename_patterns: ["*.MTS", "*.M2TS"]
│   ├── folder_patterns: ["**/AVCHD/**", "**/PRIVATE/**"]
│   └── extension_pairs: [".mts", ".m2ts"]
│
├── Technical Defaults
│   ├── lut_path: "canon_hv20_rec709.cube" | null
│   ├── deinterlace: true | false
│   └── audio_channels: "stereo" | "mono" | "none"
│
└── Quality Profile
    ├── sharpness_baseline: 450  // Laplacian variance
    └── transcode_preset: "prores_hq" | "h265_high"
```

### Couples

Each wedding is a "couple" with associated files:

```
Couple
├── name: "Smith-Jones"
├── wedding_date: "2024-06-15"
├── folder_name: "2024-06-15-smith-jones"
├── files: [imported videos]
└── exports: [generated assets]
```

## Data Flow

### Import Pipeline

```
1. Scanner Service
   └── Recursively find video + sidecar files
   └── Return: FileCandidate[]

2. Hasher Service
   └── BLAKE3 each file (16-char hex)
   └── Check for duplicates (already in DB?)
   └── Return: HashedFile[]

3. Metadata Service
   └── Run exiftool + ffprobe
   └── Store full JSON dumps
   └── Extract key fields (duration, resolution, codec)
   └── Return: FileWithMetadata[]

4. Camera Matcher Service
   └── Match against camera_patterns
   └── Link sidecars by filename (.TOD <-> .MOI)
   └── If no match: store detected_make/detected_model
   └── Return: MatchedFile[] with camera_id (nullable)

5. File Manager Service
   └── Copy to managed folder structure
   └── Rename to {blake3_short}.{ext}
   └── Return: ManagedFile[]

6. Database Commit
   └── Insert files, file_metadata, file_sidecars
   └── Update couple file counts

7. JSON Export
   └── Write couple.json to couple folder
   └── Self-documenting portable archive
```

### Asset Generation Pipeline

```
1. Scene Detection (PySceneDetect)
   └── ContentDetector for cuts
   └── AdaptiveDetector for camera movement
   └── Return: SceneBoundary[]

2. Frame Analysis
   └── Sharpness scoring (Laplacian variance)
   └── Face detection (OpenCV Haar cascades)
   └── Return: ScoredFrame[]

3. Screenshot Generation
   └── Pick sharpest frame per scene
   └── Apply LUT if camera profile specifies
   └── Export as JPEG
   └── Return: Screenshot[]

4. Clip Generation
   └── Smart crop for aspect ratios (face-priority)
   └── Audio normalization (EBU R128)
   └── LUT application
   └── Export as H.264/H.265
   └── Return: Clip[]

5. AI Captioning (Optional)
   └── Send frames to LiteLLM
   └── Generate social media captions
   └── Store with attribution
   └── Return: Caption[]
```

## External Tool Wrappers

### ffprobe

```typescript
// packages/desktop/electron/services/external/ffprobe.ts
export interface FFProbeResult {
  format: { duration: string; size: string; bit_rate: string; };
  streams: Array<{
    codec_type: 'video' | 'audio';
    codec_name: string;
    width?: number;
    height?: number;
    frame_rate?: string;
  }>;
}

export async function probe(filePath: string): Promise<FFProbeResult>;
export async function probeRaw(filePath: string): Promise<string>;
```

### exiftool

```typescript
// packages/desktop/electron/services/external/exiftool.ts
export interface ExifToolResult {
  Make?: string;
  Model?: string;
  CreateDate?: string;
  Duration?: number;
  ImageWidth?: number;
  ImageHeight?: number;
  // ... full metadata
}

export async function extract(filePath: string): Promise<string>;  // Raw JSON
export async function extractParsed(filePath: string): Promise<ExifToolResult>;
```

### ffmpeg

```typescript
// packages/desktop/electron/services/external/ffmpeg.ts
export interface TranscodeOptions {
  input: string;
  output: string;
  codec?: 'h264' | 'h265' | 'prores';
  lut?: string;
  crop?: { x: number; y: number; width: number; height: number };
  audio_normalize?: boolean;
}

export async function transcode(options: TranscodeOptions): Promise<void>;
export async function extractFrame(input: string, time: number, output: string): Promise<void>;
```

### blake3

```typescript
// packages/desktop/electron/services/crypto-service.ts
export const HASH_LENGTH = 16;

export async function calculateHash(filePath: string): Promise<string>;
export function generateId(): string;
export function isValidHash(hash: string): boolean;
```

## AI Integration

### LiteLLM Configuration

All AI calls route through LiteLLM proxy. Never hardcode providers.

```typescript
// packages/desktop/electron/services/ai/litellm-client.ts
interface LiteLLMConfig {
  baseUrl: string;      // Default: http://localhost:4000
  modelVLM: string;     // Vision model alias (e.g., "local-vlm")
  modelLLM: string;     // Text model alias (e.g., "local-llm")
}

interface AIResult {
  content: string;
  source: {
    model: string;
    provider: string;
    timestamp: Date;
    confidence?: number;
  };
}
```

### Usage Pattern

```typescript
const caption = await litellmClient.generateCaption({
  frames: [frameBase64],
  prompt: "Write a wedding social media caption for this scene...",
  model: settings.litellm_model_vlm,
});

// Store with attribution
await db.insert('ai_analysis').values({
  file_id: fileId,
  analysis_type: 'caption',
  result_json: JSON.stringify(caption),
  model_name: caption.source.model,
  provider_name: caption.source.provider,
  created_at: new Date().toISOString(),
});
```

## IPC Patterns

### Handler Registration

```typescript
// packages/desktop/electron/main/ipc-handlers/index.ts
export function registerAllHandlers(): void {
  registerCameraHandlers();
  registerCoupleHandlers();
  registerFileHandlers();
  registerSettingsHandlers();
  registerExportHandlers();
}
```

### Handler Pattern

```typescript
// packages/desktop/electron/main/ipc-handlers/camera-handlers.ts
import { z } from 'zod';
import { ipcMain } from 'electron';

const CameraInputSchema = z.object({
  name: z.string().min(1),
  medium: z.enum(['dadcam', 'super8', 'modern']),
  notes: z.string().optional(),
});

export function registerCameraHandlers(db: Database) {
  ipcMain.handle('camera:create', async (_event, input: unknown) => {
    try {
      const validated = CameraInputSchema.parse(input);
      // ... create camera
      return { success: true, id: newId };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });
}
```

### Preload Bridge

```javascript
// packages/desktop/electron/preload/preload.cjs
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const api = {
  cameras: {
    findAll: invoke("camera:findAll"),
    findById: invoke("camera:findById"),
    create: invoke("camera:create"),
    update: invoke("camera:update"),
    delete: invoke("camera:delete"),
  },
  couples: {
    findAll: invoke("couple:findAll"),
    findById: invoke("couple:findById"),
    create: invoke("couple:create"),
    update: invoke("couple:update"),
    delete: invoke("couple:delete"),
    exportJson: invoke("couple:exportJson"),
  },
  files: {
    import: invoke("file:import"),
    findByCouple: invoke("file:findByCouple"),
    hash: invoke("file:hash"),
    onImportProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("file:import:progress", listener);
      return () => ipcRenderer.removeListener("file:import:progress", listener);
    },
  },
  settings: {
    get: invoke("settings:get"),
    set: invoke("settings:set"),
    getAll: invoke("settings:getAll"),
  },
  export: {
    screenshot: invoke("export:screenshot"),
    clip: invoke("export:clip"),
    detectScenes: invoke("export:detectScenes"),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
```

## Change Protocols

| Change Type | Required Steps |
|-------------|----------------|
| UI copy/layout | Update `docs/ui-spec.md` + summary in `docs/decisions/` |
| Schema change | New migration file only; never edit existing migrations |
| New dependency | Log license in commit message; verify offline functionality |
| Deviation from spec | Document in `docs/decisions/` with decision ID; reference in commit |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Ignored build scripts" warning | Run `pnpm reinstall` |
| Preload crashes silently | Check for ES module syntax in `.cjs` file; must use `require()` |
| Database locked errors | Ensure only one Electron instance running |
| Native module mismatch | Run `pnpm --filter desktop rebuild` |
| Types out of sync | Run `pnpm --filter core build` first |
| ffprobe/exiftool not found | Check PATH or use bundled binaries |
| Camera not matching | Check pattern priority: filename > folder > metadata |

## Package-Level Guides

Read these when working in specific packages:

- @packages/core/CLAUDE.md
- @packages/desktop/CLAUDE.md

## On-Demand References

Read these when the task touches the relevant area:

**Architecture & Data:**
- @docs/ARCHITECTURE.md
- @docs/DATA_FLOW.md

**Contracts:**
- @docs/contracts/hashing.md
- @docs/contracts/camera-profiles.md
- @docs/contracts/folder-structure.md
- @docs/contracts/dual-storage.md

**Workflows:**
- @docs/workflows/import.md
- @docs/workflows/export.md
- @docs/workflows/scene-detection.md
- @docs/workflows/ai-captioning.md

## Authoritative Sources

| Source | Purpose |
|--------|---------|
| `migrations/` | Database schema, constraints, seed data. Single source of truth for DB structure. |
| `docs/ui-spec.md` | Page layouts, navigation order, typography, component states |
| `docs/schema.md` | Field descriptions, enums, JSON schema contracts |
| `docs/decisions/*.md` | ADR-style reasoning for deviations; reference IDs in commits |

## Contact Surface

All prompts funnel through this CLAUDE.md. Do not copy instructions elsewhere.
