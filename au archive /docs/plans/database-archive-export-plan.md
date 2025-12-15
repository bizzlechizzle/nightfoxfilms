# Database Archive Export Implementation Plan

## Goal

Export a snapshot of the SQLite database to the archive folder after each internal backup and on app quit, ensuring the archive folder is a complete, portable backup.

## Architecture

```
[archive]/
├── _database/
│   ├── au-archive-snapshot.db   # Complete database copy
│   ├── snapshot.sha256          # SHA256 checksum
│   └── snapshot-info.json       # Export metadata
├── locations/
│   └── [STATE]-[TYPE]/...
```

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `electron/services/database-archive-service.ts` | Core export logic |

### Modified Files

| File | Change |
|------|--------|
| `electron/services/backup-scheduler.ts` | Call archive export after backup |
| `electron/main/index.ts` | Export on app quit (before-quit event) |
| `electron/main/ipc-handlers/database.ts` | Add manual export IPC handler |
| `electron/preload/preload.cjs` | Expose export API |
| `src/types/electron.d.ts` | Type definitions |
| `src/pages/Settings.svelte` | Show export status, manual trigger |

## DatabaseArchiveService API

```typescript
interface ArchiveExportResult {
  success: boolean;
  path: string;
  size: number;
  checksum: string;
  timestamp: string;
  error?: string;
}

interface ArchiveExportInfo {
  exported_at: string;
  app_version: string;
  location_count: number;
  image_count: number;
  video_count: number;
  document_count: number;
  verified: boolean;
  checksum: string;
}

class DatabaseArchiveService {
  exportToArchive(): Promise<ArchiveExportResult>
  getLastExportInfo(): Promise<ArchiveExportInfo | null>
  verifyExport(): Promise<boolean>
}
```

## Integration Points

### 1. After Internal Backup
In `backup-scheduler.ts`:
```typescript
async createAndVerifyBackup() {
  const backup = await this.createBackup();
  if (backup) {
    // NEW: Also export to archive
    await getDatabaseArchiveService().exportToArchive();
  }
  return backup;
}
```

### 2. On App Quit
In `electron/main/index.ts`:
```typescript
app.on('before-quit', async (event) => {
  event.preventDefault();
  await getDatabaseArchiveService().exportToArchive();
  app.exit();
});
```

### 3. Manual Trigger (UI)
IPC handler: `database:exportToArchive`

## snapshot-info.json Schema

```json
{
  "exported_at": "2025-11-30T19:00:00.000Z",
  "app_version": "0.1.0",
  "location_count": 47,
  "image_count": 1234,
  "video_count": 56,
  "document_count": 89,
  "map_count": 12,
  "verified": true,
  "checksum": "sha256:abc123..."
}
```

## UI in Settings

Location: Settings > Archive > Database section (existing)

Show:
- Last export timestamp
- Export status (success/failed)
- "Export Now" button
- Auto-export enabled indicator

## CLAUDE.md Compliance

| Rule | Compliance |
|------|------------|
| Scope Discipline | Only database export feature |
| Archive-First | Serves 35+ year preservation goal |
| Offline-First | Works without network |
| No AI in Docs | No AI mentions |
| IPC Naming | `database:exportToArchive` |
| Keep It Simple | Single service, minimal files |

## Implementation Order

1. Create `DatabaseArchiveService`
2. Add IPC handler
3. Update preload and types
4. Hook into backup scheduler
5. Add on-quit export
6. Update Settings UI
7. Test and verify
8. Update documentation
9. Commit and push

---

**Last Updated**: 2025-11-30
