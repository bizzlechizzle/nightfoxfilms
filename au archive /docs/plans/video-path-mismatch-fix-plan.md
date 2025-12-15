# Plan: Video Import Thumbnail Failures - Path Mismatch Fix

## Problem Statement

Videos fail to generate thumbnails/posters when clicking "Fix Videos" button:
```
[media:fixLocationVideos] No poster generated for 0903857f2d7b5bf6c8f2b6e36bd5f67d12c1459d3ded8a599efa6ea6d5859f02
[media:fixLocationVideos] Complete: 0 fixed, 25 errors
```

## Root Cause Analysis

### Investigation Findings

1. **Database paths don't match disk paths**:
   - DB path: `/Volumes/abandoned/archive/locations/NY-automotive/brockportsch-79f577c8a9f3/org-vid-79f577c8a9f3/1d88370...mov`
   - Disk path: `/Volumes/abandoned/archive/locations/NY-automotive/brockportsch-3288b138de5d/org-vid-3288b138de5d/1d88370...mov`

2. **The `loc12` identifier changed**:
   - Old loc12 in DB: `79f577c8a9f3`
   - New loc12 on disk: `3288b138de5d`

3. **Video files exist but FFmpeg can't find them**:
   - `fixLocationVideos` handler reads `vidloc` from database
   - Passes path to `PosterFrameService.generatePoster()`
   - FFmpeg tries to read from non-existent path → fails

4. **Same issue affects two location folders**:
   - `brockportsch-79f577c8a9f3` (DB) → `brockportsch-3288b138de5d` (disk)
   - `mitchellauto-cd3174069755` (DB) → doesn't exist on disk

### Why This Happened

The `loc12` is a 12-character identifier derived from the location's UUID. If a location was deleted and recreated, or if the database was restored from a backup, the loc12 values can mismatch.

## Solution Options

### Option A: Manual Path Update Script (Recommended)
Create a script to update database paths based on actual file locations on disk.

**Pros**: Quick fix, preserves all metadata
**Cons**: One-time fix, doesn't prevent future issues

### Option B: Add Path Verification to Fix Handler
Modify `fixLocationVideos` to search for the file by hash if the stored path fails.

**Pros**: Self-healing, works for future imports
**Cons**: More complex, slower (searches disk)

### Option C: Re-import Videos
Delete orphaned video records, re-import from archive.

**Pros**: Clean slate
**Cons**: Loses metadata (dates, import info, etc.)

## Implementation: Option A + B Combined

### Part 1: One-Time Path Repair Script

Create `scripts/fix-video-paths.py`:

```python
#!/usr/bin/env python3
"""
Fix video paths in database to match actual file locations on disk.
Uses SHA256 hash to match videos - the hash is in the filename.
"""
import sqlite3
import os
from pathlib import Path

DB_PATH = 'packages/desktop/data/au-archive.db'
ARCHIVE_PATH = '/Volumes/abandoned/archive'

def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get all videos
    cursor.execute('SELECT vidsha, vidloc FROM vids')
    videos = cursor.fetchall()

    fixed = 0
    not_found = 0

    for vidsha, vidloc in videos:
        # Check if current path exists
        if os.path.exists(vidloc):
            continue

        # Search for file by hash in archive
        # Filename is {hash}.{ext}
        ext = Path(vidloc).suffix
        filename = f"{vidsha}{ext}"

        # Search in locations directory
        locations_dir = Path(ARCHIVE_PATH) / 'locations'
        found_path = None

        for video_file in locations_dir.rglob(filename):
            found_path = str(video_file)
            break

        if found_path:
            print(f"Fixing: {vidsha[:12]}")
            print(f"  Old: {vidloc}")
            print(f"  New: {found_path}")
            cursor.execute(
                'UPDATE vids SET vidloc = ? WHERE vidsha = ?',
                (found_path, vidsha)
            )
            fixed += 1
        else:
            print(f"NOT FOUND: {vidsha[:12]} - {vidloc}")
            not_found += 1

    conn.commit()
    conn.close()

    print(f"\nResults: {fixed} fixed, {not_found} not found")

if __name__ == '__main__':
    main()
```

### Part 2: Add Fallback Search to Fix Handler

Modify `media-processing.ts` to search for files by hash if path fails:

```typescript
// In fixLocationVideos handler
for (const vid of videos) {
  try {
    let sourcePath = vid.vidloc;

    // Check if source file exists
    try {
      await fs.access(sourcePath);
    } catch {
      // File not at stored path - search by hash
      console.log(`[media:fixLocationVideos] File not found at stored path, searching by hash: ${vid.vidsha.slice(0, 12)}`);
      const foundPath = await findVideoByHash(archivePath, vid.vidsha, path.extname(vid.vidloc));
      if (foundPath) {
        sourcePath = foundPath;
        // Update database with correct path
        await db.updateTable('vids').set({ vidloc: foundPath }).where('vidsha', '=', vid.vidsha).execute();
        console.log(`[media:fixLocationVideos] Found at: ${foundPath}`);
      } else {
        console.error(`[media:fixLocationVideos] Video file not found on disk: ${vid.vidsha}`);
        errors++;
        continue;
      }
    }

    // Generate poster frame (existing code)
    const posterPath = await posterService.generatePoster(sourcePath, vid.vidsha);
    // ...
  }
}

// Helper function to find video by hash
async function findVideoByHash(archivePath: string, hash: string, ext: string): Promise<string | null> {
  const locationsDir = path.join(archivePath, 'locations');
  const filename = `${hash}${ext}`;

  // Recursive search for the file
  async function searchDir(dir: string): Promise<string | null> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await searchDir(fullPath);
        if (found) return found;
      } else if (entry.name === filename) {
        return fullPath;
      }
    }
    return null;
  }

  return searchDir(locationsDir);
}
```

### Part 3: Add Better Error Messages

Update FFmpegService to log more details:

```typescript
async extractFrame(
  sourcePath: string,
  outputPath: string,
  timestampSeconds: number = 1,
  size: number = 256
): Promise<void> {
  // Check if source file exists BEFORE calling FFmpeg
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      // ... existing code
      .on('error', (err) => {
        console.error('[FFmpegService] extractFrame failed:', err.message);
        console.error('[FFmpegService] Source:', sourcePath);
        console.error('[FFmpegService] Output:', outputPath);
        reject(err);
      })
      .run();
  });
}
```

## Files to Modify

1. **NEW** `scripts/fix-video-paths.py` - One-time path repair script
2. `packages/desktop/electron/main/ipc-handlers/media-processing.ts` - Add fallback search
3. `packages/desktop/electron/services/ffmpeg-service.ts` - Add file existence check

## Verification Steps

1. Run `python3 scripts/fix-video-paths.py` to fix existing paths
2. Check database: `sqlite3 data/au-archive.db "SELECT COUNT(*) FROM vids WHERE NOT EXISTS (SELECT 1 FROM ...);"`
3. Open app, go to location with videos
4. Click "Fix Videos" button
5. Verify thumbnails are generated
6. Verify videos play in MediaViewer

## Scope

- **In scope**: Fix video path mismatches, improve error handling
- **Out of scope**:
  - Fixing image path mismatches (separate issue if needed)
  - Root cause prevention (would require database/archive sync system)

## CLAUDE.md Compliance

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only fixing video thumbnail failures |
| Keep It Simple | ✅ | Simple path lookup fallback |
| Offline-First | ✅ | All local filesystem operations |
| One Script = One Function | ✅ | Script focuses on path repair only |
