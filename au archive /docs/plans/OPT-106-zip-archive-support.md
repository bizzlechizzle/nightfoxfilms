# OPT-106: ZIP Archive Import Support (As Documents)

**Status**: ✅ Completed
**Date**: 2025-12-08

## Problem Statement

ZIP files were silently skipped during import. Users may want to archive ZIP files as-is (old edited images, export packages, historical backups).

## Audit Findings

### Two Import Systems Exist

| System | Handler | File Filter | UI Usage |
|--------|---------|-------------|----------|
| **v1 (Legacy)** | `media-import.ts` → `file-import-service.ts` | Lines 143-235 | **Dead code** - not called |
| **v2 (Active)** | `import-v2.ts` → `scanner.ts` | Lines 24-120 | `LocationDetail.svelte`, `Imports.svelte` |

v1 already has `@deprecated` tag - no changes needed.

### Issues Found

1. **`.psd` conflict**: Was in both `SKIP_EXTENSIONS` and `image` set in v2
2. **Extension parity gap**: v2 had ~50% fewer supported formats than v1

## Changes Made

**File**: `packages/desktop/electron/services/import/scanner.ts`

### 1. Fixed `.psd` conflict
- Removed `.psd` from image set (it belongs only in `SKIP_EXTENSIONS`)

### 2. Added archive extensions to document set
```typescript
'.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz'
```

### 3. Ported missing formats from v1

| Category | Before | After | Added |
|----------|--------|-------|-------|
| Image | 35 | 63 | JPEG 2000, JXL, RAW variants, vector formats |
| Video | 26 | 55 | Flash variants, transport streams, specialty |
| Document | 20 | 31 | Macro-enabled Office, archives, e-books |
| Map | 7 | 14 | Shapefile components, OSM, MBTiles |

### Skip extensions (unchanged)
```typescript
'.aae', '.psb', '.psd', '.acr'
```

## Testing

1. Import a `.zip` file → verify appears in docs table
2. Import JPEG 2000 (`.jp2`) → verify appears in imgs table
3. Import transport stream (`.m2ts`) → verify appears in vids table
4. Verify `.psd` files are still skipped
