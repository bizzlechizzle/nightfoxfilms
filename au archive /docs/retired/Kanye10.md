# KANYE10: Premium RAW Processing with Darktable CLI

**Version:** 10.0.0
**Created:** 2025-11-23
**Status:** IMPLEMENTED
**Type:** Feature Implementation - Professional RAW Processing

---

## EXECUTIVE SUMMARY

Implemented Darktable CLI integration for professional-grade RAW-to-JPEG conversion. This provides premium-quality output for RAW camera files (NEF, CR2, ARW, etc.) using Darktable's professional processing engine.

### Integration Design

```
IMPORT FLOW
-----------
1. File dropped/selected
2. ExifTool extracts metadata
3. ExifTool extracts embedded preview (fast, instant display)
4. File copied and named (SHA256.ext)
5. Thumbnails generated from preview
6. ** NEW: RAW files queued for Darktable (non-blocking)
7. Import completes immediately
8. ** Background: Darktable processes queue one at a time
9. ** On complete: DB updated with darktable_path
```

### Key Principle

**Don't block import.** Users see their files immediately via ExifTool preview extraction. Darktable processing happens in background queue and can take 30-120 seconds per file.

---

## ARCHITECTURE

### New Services Created

| Service | File | Purpose |
|---------|------|---------|
| DarktableService | `darktable-service.ts` | CLI wrapper, binary detection, spawn process |
| DarktableQueueService | `darktable-queue-service.ts` | Background queue, one-at-a-time processing |
| MediaPathService | `media-path-service.ts` | Added getDarktableDir(), getDarktablePath() |

### Database Changes (Migration 11)

```sql
ALTER TABLE imgs ADD COLUMN darktable_path TEXT;
ALTER TABLE imgs ADD COLUMN darktable_processed INTEGER DEFAULT 0;
ALTER TABLE imgs ADD COLUMN darktable_processed_at TEXT;

CREATE INDEX idx_imgs_darktable ON imgs(darktable_processed)
  WHERE darktable_processed = 0;
```

### File Structure

```
.darktable/
  [bucket]/           # First 2 chars of hash
    [sha256].jpg      # Darktable output
```

---

## IMPLEMENTATION DETAILS

### DarktableService (`darktable-service.ts`)

~150 lines, handles:
- Binary detection (bundled, homebrew, system install)
- RAW format detection
- CLI invocation with quality settings
- Process spawning with timeout (2 min per file)

```typescript
// Usage
const dt = new DarktableService(mediaPathService);
const result = await dt.processRawFile(sourcePath, hash, 92); // quality 92
// result: { success, outputPath, processingTime, error? }
```

### DarktableQueueService (`darktable-queue-service.ts`)

~180 lines, handles:
- FIFO queue management
- One-at-a-time processing (CPU intensive)
- Event emission for progress tracking
- Callback on completion for DB update

```typescript
// Usage
const queue = new DarktableQueueService(
  darktableService,
  mediaPathService,
  async (hash, outputPath) => {
    await mediaRepo.updateImageDarktablePath(hash, outputPath);
  }
);

await queue.enqueue(hash, sourcePath, locid);
```

### Repository Methods

Added to `sqlite-media-repository.ts`:

```typescript
// Get RAW files pending Darktable processing
getImagesForDarktableProcessing()

// Update after Darktable completes
updateImageDarktablePath(imgsha, darktablePath)

// Mark failed (sets processed=1 to avoid retry)
markDarktableFailed(imgsha)
```

### Import Integration

In `file-import-service.ts`, after batch processing completes:

```typescript
if (this.darktableQueueService) {
  const rawFiles = results
    .filter(r => r.success && !r.duplicate && r.type === 'image')
    .filter(r => this.previewExtractorService.isRawFormat(r.archivePath!));

  // Fire-and-forget - don't block import
  this.darktableQueueService.enqueueBatch(rawFiles);
}
```

---

## IPC HANDLERS

| Handler | Purpose |
|---------|---------|
| `media:darktableAvailable` | Check if CLI is installed |
| `media:darktableQueueStatus` | Get queue progress |
| `media:darktableProcessPending` | Trigger processing of all pending files |
| `media:darktableSetEnabled` | Enable/disable processing |

---

## SETTINGS UI

Added Darktable section to Settings page showing:
- Availability status (green/gray indicator)
- Binary path (if found)
- Install link (if not found)
- Queue status (if processing)
- "Process Pending RAW Files" button

---

## SUPPORTED FORMATS

```typescript
const RAW_EXTENSIONS = new Set([
  'nef', 'cr2', 'cr3', 'arw', 'srf', 'sr2', 'orf', 'pef', 'dng',
  'rw2', 'raf', 'raw', 'rwl', '3fr', 'fff', 'iiq', 'mrw', 'x3f',
  'erf', 'mef', 'mos', 'kdc', 'dcr',
]);
```

---

## BINARY DETECTION

Searches in order:
1. Bundled binary (`resources/bin/[platform]/darktable-cli`)
2. System locations:
   - macOS: `/Applications/darktable.app/Contents/MacOS/darktable-cli`, `/opt/homebrew/bin/darktable-cli`
   - Linux: `/usr/bin/darktable-cli`, `/usr/local/bin/darktable-cli`
   - Windows: `C:\Program Files\darktable\bin\darktable-cli.exe`

---

## DARKTABLE CLI INVOCATION

```bash
darktable-cli <input.nef> <output.jpg> \
  --core \
  --conf plugins/imageio/format/jpeg/quality=92
```

Default quality: 92 (professional standard)
Timeout: 120 seconds per file

---

## USER EXPERIENCE

### During Import
1. User drops NEF files
2. Import completes in ~2-5 seconds per file (ExifTool preview)
3. Thumbnails appear immediately
4. Toast: "3 RAW files queued for Darktable"
5. Background processing begins

### After Processing
1. `darktable_path` column populated
2. MediaViewer can use Darktable output for highest quality
3. Settings shows processing complete

### If Darktable Not Installed
1. ExifTool preview works normally
2. Settings shows "Darktable CLI Not Found"
3. Link provided to install

---

## FILES MODIFIED

| File | Change |
|------|--------|
| `electron/services/darktable-service.ts` | NEW - CLI wrapper |
| `electron/services/darktable-queue-service.ts` | NEW - Background queue |
| `electron/services/media-path-service.ts` | Added Darktable dir/path methods |
| `electron/main/database.ts` | Migration 11 - Darktable columns |
| `electron/main/database.types.ts` | Added darktable_* fields to ImgsTable |
| `electron/repositories/sqlite-media-repository.ts` | Darktable repository methods |
| `electron/services/file-import-service.ts` | Queue integration after import |
| `electron/main/ipc-handlers/media-processing.ts` | Darktable IPC handlers |
| `electron/preload/index.ts` | Exposed Darktable API methods |
| `src/pages/Settings.svelte` | Darktable UI section |

---

## FUTURE ENHANCEMENTS

1. **Custom XMP Styles**: Allow users to apply Darktable styles/presets
2. **Quality Slider**: Let users choose output quality in Settings
3. **Priority Queue**: Process currently-viewed images first
4. **Progress Notifications**: Toast when Darktable finishes a file
5. **Dual Output**: Keep both ExifTool preview and Darktable output

---

## TESTING CHECKLIST

- [ ] Install Darktable (`brew install darktable` on macOS)
- [ ] Restart app with `pnpm dev`
- [ ] Check Settings - should show "Darktable CLI Available"
- [ ] Import NEF files
- [ ] Verify import completes quickly (ExifTool preview)
- [ ] Check console for "[DarktableQueue] Processing..."
- [ ] Wait for processing to complete
- [ ] Query DB: `SELECT darktable_path FROM imgs WHERE darktable_processed = 1`
- [ ] Verify .darktable folder contains output JPEGs

---

## CHANGELOG

| Date | Action |
|------|--------|
| 2025-11-23 | Created DarktableService |
| 2025-11-23 | Created DarktableQueueService |
| 2025-11-23 | Added Migration 11 for darktable columns |
| 2025-11-23 | Added repository methods |
| 2025-11-23 | Integrated with file-import-service |
| 2025-11-23 | Added IPC handlers |
| 2025-11-23 | Added Settings UI |
| 2025-11-23 | Created Kanye10.md |

---

*This is kanye10.md - Premium RAW processing with Darktable CLI integration.*
