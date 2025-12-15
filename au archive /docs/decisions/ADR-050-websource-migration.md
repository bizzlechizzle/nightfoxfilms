# ADR-050: Web Source Migration (OPT-109)

**Status:** Implemented
**Date:** 2025-12-12
**Author:** Claude Code

---

## Context

The bookmark saving feature from the browser extension stopped working after Migration 57 dropped the `bookmarks` table in favor of the more comprehensive `web_sources` table. The HTTP API server and IPC handlers continued referencing the deleted table, causing failures.

### Root Cause

Migration 57 in `database.ts` executed:
```sql
DROP TABLE bookmarks;
```

But the following code still referenced the deleted table:
- `sqlite-bookmarks-repository.ts` - `insertInto('bookmarks')`
- `ipc-handlers/bookmarks.ts` - All IPC handlers
- `bookmark-api-server.ts` - HTTP endpoints
- `main/index.ts` - Repository instantiation
- Preload bridges - `bookmarks:*` namespace

---

## Decision

Replace all bookmark infrastructure with the existing `web_sources` system while maintaining HTTP API backward compatibility for the browser extension.

### Approach: Clean Break with API Compatibility

1. **Delete dead code** - Remove all files/code referencing deleted `bookmarks` table
2. **Use existing infrastructure** - Leverage the comprehensive `SQLiteWebSourcesRepository`
3. **Preserve HTTP API** - Keep `/api/bookmark` endpoint name for extension compatibility
4. **Add enhancements** - Auto-detect source type, better duplicate handling

---

## Architecture

### Data Flow (Before)

```
Extension → POST /api/bookmark → SQLiteBookmarksRepository → bookmarks table ❌
```

### Data Flow (After)

```
Extension → POST /api/bookmark → SQLiteWebSourcesRepository → web_sources table ✅
```

### Component Changes

| Component | Before | After |
|-----------|--------|-------|
| Repository | `SQLiteBookmarksRepository` | `SQLiteWebSourcesRepository` |
| Table | `bookmarks` (deleted) | `web_sources` |
| Primary Key | `bookmark_id` | `source_id` |
| Date Field | `bookmark_date` | `created_at` |
| Type Field | (none) | `source_type` (auto-detected) |

---

## Files Changed

### Deleted Files
| File | Reason |
|------|--------|
| `sqlite-bookmarks-repository.ts` | References deleted table |
| `ipc-handlers/bookmarks.ts` | Uses deleted repository |

### Modified Files

| File | Changes |
|------|---------|
| `bookmark-api-server.ts` | Use `SQLiteWebSourcesRepository`, add source type detection, duplicate handling |
| `main/index.ts` | Pass `SQLiteWebSourcesRepository` instead of `SQLiteBookmarksRepository` |
| `websocket-server.ts` | Add `notifyWebSourceSaved()` function |
| `ipc-handlers/index.ts` | Remove bookmarks handler registration |
| `preload/index.ts` | Remove `bookmarks:` namespace |
| `preload/preload.cjs` | Remove `bookmarks:` namespace |
| `database.types.ts` | Remove `BookmarksTable` interface |
| `src/types/electron.d.ts` | Remove `bookmarks:` type declarations |
| `sqlite-websources-repository.ts` | Mark `migrateFromBookmarks()` as deprecated no-op |

### New Files

| File | Purpose |
|------|---------|
| `source-type-detector.ts` | Auto-detect source type from URL patterns |

---

## API Response Mapping

For extension backward compatibility, the HTTP API maps fields:

| Extension Expects | WebSource Field |
|-------------------|-----------------|
| `bookmark_id` | `source_id` |
| `bookmark_date` | `created_at` |
| `thumbnail_path` | `screenshot_path` |

### Enhanced Response

The API now returns additional information:

```json
{
  "success": true,
  "bookmark_id": "a7f3b2c1e9d4f086",
  "source_type": "article"
}
```

### Duplicate Handling

If the URL already exists, returns:

```json
{
  "success": true,
  "duplicate": true,
  "bookmark_id": "a7f3b2c1e9d4f086",
  "source_type": "article",
  "message": "Already saved to Location Name"
}
```

---

## Source Type Detection

The new `source-type-detector.ts` automatically categorizes URLs:

| URL Pattern | Source Type |
|-------------|-------------|
| youtube.com, vimeo.com, etc. | `video` |
| facebook.com, twitter.com, etc. | `social` |
| maps.google.com, etc. | `map` |
| archive.org, newspapers.com, etc. | `archive` |
| imgur.com, flickr.com, etc. | `gallery` |
| *.pdf, *.doc, etc. | `document` |
| Default | `article` |

---

## WebSocket Events

### New Event

```json
{
  "type": "websource_saved",
  "source_id": "a7f3b2c1e9d4f086",
  "locid": "abc123def456",
  "subid": null,
  "source_type": "article"
}
```

### Legacy Event (Backward Compat)

Also broadcasts the old event format:

```json
{
  "type": "bookmark_saved",
  "bookmark_id": "a7f3b2c1e9d4f086",
  "locid": "abc123def456",
  "subid": null
}
```

---

## Migration Path for Existing Code

### Renderer Code

If any Svelte components used `window.electron.bookmarks.*`:

**Before:**
```typescript
await window.electron.bookmarks.findByLocation(locid);
```

**After:**
```typescript
await window.electron.websources.findByLocation(locid);
```

### IPC Channels

| Old Channel | New Channel |
|-------------|-------------|
| `bookmarks:create` | `websources:create` |
| `bookmarks:findById` | `websources:findById` |
| `bookmarks:findByLocation` | `websources:findByLocation` |
| `bookmarks:findRecent` | `websources:findRecent` |
| `bookmarks:delete` | `websources:delete` |

---

## Testing Checklist

- [ ] Extension can save bookmarks to locations
- [ ] Duplicate URLs show friendly message instead of error
- [ ] Source type auto-detected correctly
- [ ] WebSocket notifications work for UI updates
- [ ] Recent locations endpoint works
- [ ] Search endpoint works

---

## Rollback Plan

If issues arise:
1. Restore deleted files from git: `git checkout HEAD~1 -- <files>`
2. Revert changes to modified files
3. Note: Cannot restore `bookmarks` table data (already migrated in Migration 57)

---

## References

- Migration 57: `packages/desktop/electron/main/database.ts` lines 2136-2225
- OPT-109: Web Sources Archiving feature specification
- `websources:*` IPC handlers: `packages/desktop/electron/main/ipc-handlers/websources.ts`
