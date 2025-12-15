# AU Archive v0.1.0 - Technical Implementation Guide

**For**: Completing all v0.1.0 features to 100%
**Based on**: claude.md, techguide.md, finish_v010.md
**Target Audience**: Developer implementing remaining features

---

## PHASE 1: CRITICAL DATA FEATURES

### 1. DATABASE BACKUP FUNCTIONALITY

**Technical Approach:**
```typescript
// packages/desktop/electron/main/ipc-handlers.ts

ipcMain.handle('database:backup', async () => {
  try {
    const dbPath = getDatabasePath(); // From database.ts

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Backup Database',
      defaultPath: `au-archive-backup-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.db`,
      filters: [
        { name: 'SQLite Database', extensions: ['db'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, message: 'Backup canceled' };
    }

    // Copy database file
    await fs.promises.copyFile(dbPath, result.filePath);

    return { success: true, path: result.filePath };
  } catch (error) {
    console.error('Backup error:', error);
    throw error;
  }
});
```

**Files to Modify:**
1. `packages/desktop/electron/main/ipc-handlers.ts` - Add handler
2. `packages/desktop/electron/preload/index.ts` - Expose API
3. `packages/desktop/src/pages/Settings.svelte` - Call API

**Testing:**
- Test backup to valid path
- Test cancellation
- Verify backup file integrity
- Test insufficient permissions

---

### 2. IMPORT HISTORY TRACKING

**Database Migration:**
```typescript
// packages/desktop/electron/main/database.ts - runMigrations()

// Migration 2: Add imports table
const tables = sqlite.pragma('table_list') as Array<{ name: string }>;
const hasImports = tables.some(t => t.name === 'imports');

if (!hasImports) {
  console.log('Running migration: Creating imports table');
  sqlite.exec(`
    CREATE TABLE imports (
      import_id TEXT PRIMARY KEY,
      locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
      import_date TEXT NOT NULL,
      auth_imp TEXT,
      img_count INTEGER DEFAULT 0,
      vid_count INTEGER DEFAULT 0,
      doc_count INTEGER DEFAULT 0,
      map_count INTEGER DEFAULT 0,
      notes TEXT
    );
    CREATE INDEX idx_imports_date ON imports(import_date DESC);
    CREATE INDEX idx_imports_locid ON imports(locid);
  `);
  console.log('Migration completed: imports table created');
}
```

**Repository:**
```typescript
// packages/desktop/electron/repositories/sqlite-import-repository.ts

export interface ImportRecord {
  import_id: string;
  locid: string;
  import_date: string;
  auth_imp: string | null;
  img_count: number;
  vid_count: number;
  doc_count: number;
  map_count: number;
  notes: string | null;
  location?: Location; // Joined data
}

export class SQLiteImportRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: Omit<ImportRecord, 'import_id'>): Promise<ImportRecord> {
    const import_id = randomUUID();
    await this.db.insertInto('imports').values({ import_id, ...input }).execute();
    return this.findById(import_id);
  }

  async findRecent(limit: number = 5): Promise<ImportRecord[]> {
    const rows = await this.db
      .selectFrom('imports')
      .leftJoin('locs', 'imports.locid', 'locs.locid')
      .selectAll('imports')
      .select(['locs.locnam', 'locs.address_state'])
      .orderBy('imports.import_date', 'desc')
      .limit(limit)
      .execute();
    return rows;
  }
}
```

**Dashboard Integration:**
```typescript
// packages/desktop/src/pages/Dashboard.svelte

let recentImports = $state<ImportRecord[]>([]);

onMount(async () => {
  const imports = await window.electronAPI.imports.findRecent(5);
  recentImports = imports;
});
```

---

### 3. MEDIA IMPORT PIPELINE

**Architecture:**

```
User selects files → FileImportService
  ↓
1. Calculate SHA256 hash
  ↓
2. Check for duplicates in database
  ↓
3. Extract metadata (ExifTool/FFmpeg)
  ↓
4. Organize file to archive folder
  ↓
5. Insert record in database
  ↓
6. Delete original if setting enabled
  ↓
7. Track import session
```

**ExifTool Service:**
```typescript
// packages/desktop/electron/services/exiftool-service.ts

import { exiftool } from 'exiftool-vendored';

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  dateTaken: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  gps: {
    lat: number;
    lng: number;
    altitude?: number;
    accuracy?: number;
  } | null;
}

export class ExifToolService {
  async extractMetadata(filePath: string): Promise<ImageMetadata> {
    try {
      const tags = await exiftool.read(filePath);

      return {
        width: tags.ImageWidth || null,
        height: tags.ImageHeight || null,
        dateTaken: tags.DateTimeOriginal?.toISOString() || null,
        cameraMake: tags.Make || null,
        cameraModel: tags.Model || null,
        gps: tags.GPSLatitude && tags.GPSLongitude ? {
          lat: tags.GPSLatitude,
          lng: tags.GPSLongitude,
          altitude: tags.GPSAltitude,
          accuracy: tags.GPSHPositioningError
        } : null
      };
    } catch (error) {
      console.error('ExifTool error:', error);
      return {
        width: null,
        height: null,
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        gps: null
      };
    }
  }

  async close() {
    await exiftool.end();
  }
}
```

**FFmpeg Service:**
```typescript
// packages/desktop/electron/services/ffmpeg-service.ts

import ffmpeg from 'fluent-ffmpeg';

export interface VideoMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
  dateTaken: string | null;
}

export class FFmpegService {
  async extractMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error('FFmpeg error:', err);
          return resolve({
            duration: null,
            width: null,
            height: null,
            codec: null,
            fps: null,
            dateTaken: null
          });
        }

        const videoStream = metadata.streams?.find(s => s.codec_type === 'video');

        resolve({
          duration: metadata.format?.duration || null,
          width: videoStream?.width || null,
          height: videoStream?.height || null,
          codec: videoStream?.codec_name || null,
          fps: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : null,
          dateTaken: metadata.format?.tags?.creation_time || null
        });
      });
    });
  }
}
```

**Crypto Service:**
```typescript
// packages/desktop/electron/services/crypto-service.ts

import crypto from 'crypto';
import fs from 'fs';

export class CryptoService {
  async calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
```

**File Import Service:**
```typescript
// packages/desktop/electron/services/file-import-service.ts

import path from 'path';
import fs from 'fs';
import { CryptoService } from './crypto-service';
import { ExifToolService } from './exiftool-service';
import { FFmpegService } from './ffmpeg-service';
import { SQLiteMediaRepository } from '../repositories/sqlite-media-repository';
import { SQLiteImportRepository } from '../repositories/sqlite-import-repository';

export interface ImportOptions {
  locid: string;
  filePaths: string[];
  archiveFolder: string;
  deleteOriginals: boolean;
  author: string;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  duplicates: number;
  errors: number;
  import_id: string;
}

export class FileImportService {
  private crypto = new CryptoService();
  private exiftool = new ExifToolService();
  private ffmpeg = new FFmpegService();

  constructor(
    private mediaRepo: SQLiteMediaRepository,
    private importRepo: SQLiteImportRepository
  ) {}

  async import(options: ImportOptions): Promise<ImportResult> {
    const { locid, filePaths, archiveFolder, deleteOriginals, author } = options;

    let imported = 0;
    let duplicates = 0;
    let errors = 0;
    let imgCount = 0;
    let vidCount = 0;
    let docCount = 0;

    for (const filePath of filePaths) {
      try {
        // 1. Calculate SHA256
        const sha = await this.crypto.calculateSHA256(filePath);

        // 2. Check for duplicates
        const existing = await this.mediaRepo.findBySHA(sha);
        if (existing) {
          duplicates++;
          continue;
        }

        // 3. Determine file type
        const ext = path.extname(filePath).toLowerCase();
        const fileType = this.getFileType(ext);

        // 4. Extract metadata
        let metadata = null;
        if (fileType === 'image') {
          metadata = await this.exiftool.extractMetadata(filePath);
          imgCount++;
        } else if (fileType === 'video') {
          metadata = await this.ffmpeg.extractMetadata(filePath);
          vidCount++;
        } else {
          docCount++;
        }

        // 5. Organize file to archive
        const newPath = await this.organizeFile(filePath, locid, sha, ext, archiveFolder, fileType);

        // 6. Insert into database
        await this.mediaRepo.create({
          sha,
          originalName: path.basename(filePath),
          originalPath: filePath,
          newName: `${sha}${ext}`,
          newPath,
          locid,
          fileType,
          metadata,
          author,
        });

        // 7. Delete original if enabled
        if (deleteOriginals) {
          await fs.promises.unlink(filePath);
        }

        imported++;
      } catch (error) {
        console.error(`Error importing ${filePath}:`, error);
        errors++;
      }
    }

    // 8. Track import session
    const importRecord = await this.importRepo.create({
      locid,
      import_date: new Date().toISOString(),
      auth_imp: author,
      img_count: imgCount,
      vid_count: vidCount,
      doc_count: docCount,
      map_count: 0,
      notes: null
    });

    return {
      success: true,
      imported,
      duplicates,
      errors,
      import_id: importRecord.import_id
    };
  }

  private getFileType(ext: string): 'image' | 'video' | 'document' {
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.heic'];
    const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'];

    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    return 'document';
  }

  private async organizeFile(
    sourcePath: string,
    locid: string,
    sha: string,
    ext: string,
    archiveFolder: string,
    fileType: 'image' | 'video' | 'document'
  ): Promise<string> {
    // Get location details for folder structure
    const location = await this.getLocation(locid);
    const state = location.address?.state || 'UNKNOWN';
    const type = location.type || 'Unknown';
    const slocnam = location.slocnam;
    const loc12 = location.loc12;

    // Build folder structure: [STATE]-[TYPE]/[SLOCNAM]-[LOC12]/org-img-[LOC12]/
    const typeFolder = `${state}-${type}`;
    const locFolder = `${slocnam}-${loc12}`;
    const mediaFolder = `org-${fileType === 'image' ? 'img' : fileType === 'video' ? 'vid' : 'doc'}-${loc12}`;

    const targetDir = path.join(archiveFolder, 'locations', typeFolder, locFolder, mediaFolder);

    // Create directory if it doesn't exist
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Copy file with SHA256 name
    const targetPath = path.join(targetDir, `${sha}${ext}`);
    await fs.promises.copyFile(sourcePath, targetPath);

    // Verify integrity
    const targetSha = await this.crypto.calculateSHA256(targetPath);
    if (targetSha !== sha) {
      await fs.promises.unlink(targetPath);
      throw new Error('File integrity check failed');
    }

    return targetPath;
  }

  async cleanup() {
    await this.exiftool.close();
  }
}
```

**Media Repository:**
```typescript
// packages/desktop/electron/repositories/sqlite-media-repository.ts

export interface MediaRecord {
  sha: string;
  originalName: string;
  originalPath: string;
  newName: string;
  newPath: string;
  locid: string;
  subid?: string;
  fileType: 'image' | 'video' | 'document';
  metadata: any;
  author: string;
  addedDate: string;
}

export class SQLiteMediaRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(media: Omit<MediaRecord, 'addedDate'>): Promise<void> {
    const addedDate = new Date().toISOString();
    const { fileType } = media;

    if (fileType === 'image') {
      await this.db.insertInto('imgs').values({
        imgsha: media.sha,
        imgnam: media.originalName,
        imgnamo: media.newName,
        imgloc: media.originalPath,
        imgloco: media.newPath,
        locid: media.locid,
        subid: media.subid || null,
        auth_imp: media.author,
        imgadd: addedDate,
        meta_exiftool: JSON.stringify(media.metadata),
        meta_width: media.metadata?.width || null,
        meta_height: media.metadata?.height || null,
        meta_date_taken: media.metadata?.dateTaken || null,
        meta_camera_make: media.metadata?.cameraMake || null,
        meta_camera_model: media.metadata?.cameraModel || null,
        meta_gps_lat: media.metadata?.gps?.lat || null,
        meta_gps_lng: media.metadata?.gps?.lng || null,
      }).execute();
    } else if (fileType === 'video') {
      await this.db.insertInto('vids').values({
        vidsha: media.sha,
        vidnam: media.originalName,
        vidnamo: media.newName,
        vidloc: media.originalPath,
        vidloco: media.newPath,
        locid: media.locid,
        subid: media.subid || null,
        auth_imp: media.author,
        vidadd: addedDate,
        meta_ffmpeg: JSON.stringify(media.metadata),
        meta_exiftool: null,
        meta_duration: media.metadata?.duration || null,
        meta_width: media.metadata?.width || null,
        meta_height: media.metadata?.height || null,
        meta_codec: media.metadata?.codec || null,
        meta_fps: media.metadata?.fps || null,
        meta_date_taken: media.metadata?.dateTaken || null,
      }).execute();
    } else {
      await this.db.insertInto('docs').values({
        docsha: media.sha,
        docnam: media.originalName,
        docnamo: media.newName,
        docloc: media.originalPath,
        docloco: media.newPath,
        locid: media.locid,
        subid: media.subid || null,
        auth_imp: media.author,
        docadd: addedDate,
        meta_exiftool: JSON.stringify(media.metadata),
        meta_page_count: null,
        meta_author: null,
        meta_title: null,
      }).execute();
    }
  }

  async findBySHA(sha: string): Promise<MediaRecord | null> {
    // Check all three tables
    const img = await this.db.selectFrom('imgs').selectAll().where('imgsha', '=', sha).executeTakeFirst();
    if (img) return this.mapImageToMedia(img);

    const vid = await this.db.selectFrom('vids').selectAll().where('vidsha', '=', sha).executeTakeFirst();
    if (vid) return this.mapVideoToMedia(vid);

    const doc = await this.db.selectFrom('docs').selectAll().where('docsha', '=', sha).executeTakeFirst();
    if (doc) return this.mapDocToMedia(doc);

    return null;
  }

  async findByLocation(locid: string): Promise<{
    images: any[];
    videos: any[];
    documents: any[];
  }> {
    const [images, videos, documents] = await Promise.all([
      this.db.selectFrom('imgs').selectAll().where('locid', '=', locid).orderBy('imgadd', 'desc').execute(),
      this.db.selectFrom('vids').selectAll().where('locid', '=', locid).orderBy('vidadd', 'desc').execute(),
      this.db.selectFrom('docs').selectAll().where('locid', '=', locid).orderBy('docadd', 'desc').execute(),
    ]);

    return { images, videos, documents };
  }
}
```

**IPC Handler:**
```typescript
// packages/desktop/electron/main/ipc-handlers.ts

import { FileImportService } from '../services/file-import-service';

ipcMain.handle('import:files', async (_event, options: unknown) => {
  try {
    const validated = ImportOptionsSchema.parse(options);
    const importService = new FileImportService(mediaRepo, importRepo);

    const result = await importService.import(validated);
    await importService.cleanup();

    return result;
  } catch (error) {
    console.error('Import error:', error);
    throw error;
  }
});

ipcMain.handle('import:selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp', 'heic'] },
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});
```

---

### 4. MEDIA DISPLAY ON LOCATION DETAIL

**Media Gallery Component:**
```typescript
// packages/desktop/src/components/MediaGallery.svelte

<script lang="ts">
  interface Props {
    images: any[];
    videos: any[];
    documents: any[];
    onImageClick?: (image: any) => void;
  }

  let { images, videos, documents, onImageClick }: Props = $props();
</script>

<div class="space-y-6">
  {#if images.length > 0}
    <div>
      <h3 class="text-lg font-semibold mb-3">Images ({images.length})</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {#each images as image}
          <button
            onclick={() => onImageClick?.(image)}
            class="aspect-square bg-gray-100 rounded overflow-hidden hover:opacity-80 transition"
          >
            <img
              src="file://{image.imgloco}"
              alt={image.imgnam}
              class="w-full h-full object-cover"
            />
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if videos.length > 0}
    <div>
      <h3 class="text-lg font-semibold mb-3">Videos ({videos.length})</h3>
      <ul class="space-y-2">
        {#each videos as video}
          <li class="flex items-center gap-3 p-3 bg-gray-50 rounded">
            <svg class="w-8 h-8 text-gray-400"><!-- video icon --></svg>
            <div class="flex-1">
              <p class="font-medium">{video.vidnam}</p>
              <p class="text-sm text-gray-500">
                {video.meta_duration ? `${Math.floor(video.meta_duration)}s` : ''}
                {video.meta_width && video.meta_height ? `${video.meta_width}x${video.meta_height}` : ''}
              </p>
            </div>
            <button onclick={() => openFile(video.vidloco)} class="text-accent hover:underline">
              Open
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if documents.length > 0}
    <div>
      <h3 class="text-lg font-semibold mb-3">Documents ({documents.length})</h3>
      <ul class="space-y-2">
        {#each documents as doc}
          <li class="flex items-center gap-3 p-3 bg-gray-50 rounded">
            <svg class="w-8 h-8 text-gray-400"><!-- document icon --></svg>
            <div class="flex-1">
              <p class="font-medium">{doc.docnam}</p>
            </div>
            <button onclick={() => openFile(doc.docloco)} class="text-accent hover:underline">
              Open
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if images.length === 0 && videos.length === 0 && documents.length === 0}
    <div class="text-center py-12 text-gray-400">
      <p>No media files yet</p>
      <p class="text-sm mt-2">Import media from the Imports page</p>
    </div>
  {/if}
</div>
```

**Image Lightbox:**
```typescript
// packages/desktop/src/components/ImageLightbox.svelte

<script lang="ts">
  interface Props {
    image: any;
    onClose: () => void;
  }

  let { image, onClose }: Props = $props();
</script>

<div
  class="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center"
  onclick={onClose}
>
  <button
    onclick={onClose}
    class="absolute top-4 right-4 text-white text-2xl hover:opacity-70"
  >
    ×
  </button>

  <img
    src="file://{image.imgloco}"
    alt={image.imgnam}
    class="max-w-[90vw] max-h-[90vh] object-contain"
    onclick={(e) => e.stopPropagation()}
  />

  <div class="absolute bottom-4 left-4 text-white">
    <p class="font-medium">{image.imgnam}</p>
    {#if image.meta_date_taken}
      <p class="text-sm opacity-80">{new Date(image.meta_date_taken).toLocaleDateString()}</p>
    {/if}
  </div>
</div>
```

---

## PHASE 2: UI COMPLETENESS

### 5. SUB-LOCATION FORM UI

**LocationForm Enhancement:**
```typescript
// packages/desktop/src/components/LocationForm.svelte

let isSubLocation = $state(false);
let parentLocationId = $state('');
let isPrimary = $state(false);

{#if isSubLocation}
  <div class="mb-4">
    <label class="block text-sm font-medium text-gray-700 mb-2">
      Parent Location *
    </label>
    <select bind:value={parentLocationId} required class="w-full px-3 py-2 border rounded">
      <option value="">Select parent location...</option>
      {#each allLocations as loc}
        <option value={loc.locid}>{loc.locnam}</option>
      {/each}
    </select>
  </div>

  <div class="mb-4 flex items-center">
    <input type="checkbox" bind:checked={isPrimary} id="isPrimary" class="mr-2" />
    <label for="isPrimary">Primary Sub-Location</label>
  </div>
{/if}
```

**IPC Handlers:**
```typescript
ipcMain.handle('sublocation:create', async (_event, input: unknown) => {
  const validated = SubLocationInputSchema.parse(input);
  // Create sub-location in slocs table
});

ipcMain.handle('sublocation:findByLocation', async (_event, locid: string) => {
  // Get all sub-locations for a parent
});
```

---

### 6. AUTOFILL TYPEAHEAD

**Autocomplete Component:**
```typescript
// packages/desktop/src/components/AutocompleteInput.svelte

<script lang="ts">
  interface Props {
    value: string;
    onValueChange: (value: string) => void;
    fetchSuggestions: (query: string) => Promise<string[]>;
    placeholder?: string;
  }

  let { value, onValueChange, fetchSuggestions, placeholder }: Props = $props();
  let suggestions = $state<string[]>([]);
  let showSuggestions = $state(false);
  let debounceTimer: any = null;

  function handleInput(e: Event) {
    const newValue = (e.target as HTMLInputElement).value;
    onValueChange(newValue);

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (newValue.length > 0) {
        suggestions = await fetchSuggestions(newValue);
        showSuggestions = true;
      } else {
        suggestions = [];
        showSuggestions = false;
      }
    }, 300);
  }

  function selectSuggestion(suggestion: string) {
    onValueChange(suggestion);
    showSuggestions = false;
  }
</script>

<div class="relative">
  <input
    type="text"
    value={value}
    oninput={handleInput}
    onfocus={() => suggestions.length > 0 && (showSuggestions = true)}
    onblur={() => setTimeout(() => showSuggestions = false, 200)}
    placeholder={placeholder}
    class="w-full px-3 py-2 border border-gray-300 rounded"
  />

  {#if showSuggestions && suggestions.length > 0}
    <ul class="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-60 overflow-auto">
      {#each suggestions as suggestion}
        <li>
          <button
            onclick={() => selectSuggestion(suggestion)}
            class="w-full text-left px-3 py-2 hover:bg-gray-100"
          >
            {suggestion}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

**IPC Handlers for Autocomplete:**
```typescript
ipcMain.handle('autocomplete:types', async (_event, query: string) => {
  const results = await db
    .selectFrom('locs')
    .select('type')
    .distinct()
    .where('type', 'like', `%${query}%`)
    .where('type', 'is not', null)
    .limit(10)
    .execute();
  return results.map(r => r.type);
});

ipcMain.handle('autocomplete:authors', async (_event, query: string) => {
  const results = await db
    .selectFrom('locs')
    .select('auth_imp')
    .distinct()
    .where('auth_imp', 'like', `%${query}%`)
    .where('auth_imp', 'is not', null)
    .limit(10)
    .execute();
  return results.map(r => r.auth_imp);
});
```

---

## PHASE 3: MAJOR FEATURES

### 7. NOTES SYSTEM

**Database Migration:**
```typescript
// Migration 3: Add notes table
if (!tables.some(t => t.name === 'notes')) {
  sqlite.exec(`
    CREATE TABLE notes (
      note_id TEXT PRIMARY KEY,
      locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
      note_text TEXT NOT NULL,
      note_date TEXT NOT NULL,
      auth_imp TEXT,
      note_type TEXT DEFAULT 'general'
    );
    CREATE INDEX idx_notes_locid ON notes(locid);
    CREATE INDEX idx_notes_date ON notes(note_date DESC);
  `);
}
```

**Notes Component:**
```typescript
// packages/desktop/src/components/NotesSection.svelte

<script lang="ts">
  interface Note {
    note_id: string;
    note_text: string;
    note_date: string;
    auth_imp: string | null;
  }

  interface Props {
    locationId: string;
  }

  let { locationId }: Props = $props();
  let notes = $state<Note[]>([]);
  let newNote = $state('');

  async function loadNotes() {
    notes = await window.electronAPI.notes.findByLocation(locationId);
  }

  async function addNote() {
    if (!newNote.trim()) return;
    await window.electronAPI.notes.create(locationId, newNote);
    newNote = '';
    await loadNotes();
  }

  onMount(loadNotes);
</script>

<div class="space-y-4">
  <h3 class="text-lg font-semibold">Notes</h3>

  <textarea
    bind:value={newNote}
    placeholder="Add a note..."
    class="w-full px-3 py-2 border border-gray-300 rounded resize-none"
    rows="3"
  ></textarea>

  <button onclick={addNote} class="px-4 py-2 bg-accent text-white rounded">
    Add Note
  </button>

  {#if notes.length > 0}
    <ul class="space-y-3">
      {#each notes as note}
        <li class="p-3 bg-gray-50 rounded">
          <p class="text-sm text-gray-600 mb-1">
            {new Date(note.note_date).toLocaleString()}
            {#if note.auth_imp}
              · {note.auth_imp}
            {/if}
          </p>
          <p class="whitespace-pre-wrap">{note.note_text}</p>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-gray-400 text-center py-4">No notes yet</p>
  {/if}
</div>
```

---

### 8. TRUE PROJECTS SYSTEM

**Database Migrations:**
```typescript
// Migration 4 & 5: Add projects tables
if (!tables.some(t => t.name === 'projects')) {
  sqlite.exec(`
    CREATE TABLE projects (
      project_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_date TEXT NOT NULL,
      auth_imp TEXT
    );

    CREATE TABLE project_locations (
      project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
      locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
      added_date TEXT NOT NULL,
      PRIMARY KEY (project_id, locid)
    );

    CREATE INDEX idx_project_locations_project ON project_locations(project_id);
    CREATE INDEX idx_project_locations_location ON project_locations(locid);
  `);
}
```

**Project Repository:**
```typescript
// packages/desktop/electron/repositories/sqlite-project-repository.ts

export interface Project {
  project_id: string;
  project_name: string;
  description: string | null;
  created_date: string;
  auth_imp: string | null;
  location_count?: number;
}

export class SQLiteProjectRepository {
  async create(input: Omit<Project, 'project_id' | 'created_date'>): Promise<Project> {
    const project_id = randomUUID();
    const created_date = new Date().toISOString();

    await this.db.insertInto('projects').values({
      project_id,
      project_name: input.project_name,
      description: input.description || null,
      created_date,
      auth_imp: input.auth_imp || null,
    }).execute();

    return this.findById(project_id);
  }

  async addLocation(projectId: string, locid: string): Promise<void> {
    await this.db.insertInto('project_locations').values({
      project_id: projectId,
      locid,
      added_date: new Date().toISOString(),
    }).execute();
  }

  async findTopProjects(limit: number = 5): Promise<Project[]> {
    const results = await this.db
      .selectFrom('projects')
      .leftJoin('project_locations', 'projects.project_id', 'project_locations.project_id')
      .select([
        'projects.project_id',
        'projects.project_name',
        'projects.description',
        'projects.created_date',
        'projects.auth_imp',
        (eb) => eb.fn.count('project_locations.locid').as('location_count')
      ])
      .groupBy('projects.project_id')
      .orderBy('location_count', 'desc')
      .limit(limit)
      .execute();

    return results;
  }
}
```

---

## TESTING STRATEGY

### Unit Tests
```typescript
// packages/desktop/electron/services/__tests__/crypto-service.test.ts

import { CryptoService } from '../crypto-service';
import fs from 'fs';
import path from 'path';

describe('CryptoService', () => {
  const crypto = new CryptoService();

  it('should calculate SHA256 hash', async () => {
    const testFile = path.join(__dirname, 'fixtures/test.txt');
    await fs.promises.writeFile(testFile, 'test content');

    const hash = await crypto.calculateSHA256(testFile);

    expect(hash).toBe('6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72');

    await fs.promises.unlink(testFile);
  });
});
```

### Integration Tests
```typescript
// packages/desktop/electron/services/__tests__/file-import-service.test.ts

describe('FileImportService', () => {
  let service: FileImportService;
  let db: Kysely<Database>;

  beforeEach(() => {
    db = createTestDatabase();
    service = new FileImportService(
      new SQLiteMediaRepository(db),
      new SQLiteImportRepository(db)
    );
  });

  it('should import image file', async () => {
    const result = await service.import({
      locid: 'test-loc-id',
      filePaths: ['test.jpg'],
      archiveFolder: '/tmp/archive',
      deleteOriginals: false,
      author: 'test-user'
    });

    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.errors).toBe(0);
  });
});
```

---

## DEPLOYMENT CHECKLIST

Before releasing v0.1.0:

1. ✅ All critical features implemented
2. ✅ All major features implemented
3. ✅ Database migrations tested
4. ✅ Import pipeline tested with real files
5. ✅ Media display works correctly
6. ✅ All forms validate input
7. ✅ Database backup/restore works
8. ✅ Test coverage ≥ 60%
9. ✅ Build succeeds without errors
10. ✅ Manual testing on all pages
11. ✅ Performance: Import 100+ files successfully
12. ✅ Update techguide.md and lilbits.md
13. ✅ Create release notes
14. ✅ Tag release: v0.1.0

---

## MAINTENANCE NOTES

**ExifTool Process:**
- ExifTool spawns a subprocess that must be closed
- Call `exiftool.end()` when done importing
- Do not create multiple instances

**FFmpeg Configuration:**
- Requires FFmpeg binaries in PATH or bundled
- Set path via: `ffmpeg.setFfmpegPath(path)`
- Set ffprobe path via: `ffmpeg.setFfprobePath(path)`

**File Permissions:**
- Archive folder must have write permissions
- Original files must have read permissions
- Check permissions before importing

**Error Handling:**
- All import errors should be caught per-file
- Continue processing other files if one fails
- Report errors to user with file names

---

**Document Version**: 1.0
**Last Updated**: 2025-11-21
**For**: AU Archive v0.1.0 Implementation
