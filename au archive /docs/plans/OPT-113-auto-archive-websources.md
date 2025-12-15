# OPT-113: Auto-Archive Web Sources on Save

**Status**: COMPLETE - MERGED TO feature/import-v2 (commit 9c1a3f7)
**Created**: 2025-12-12
**Author**: Claude Code

---

## User Decisions

1. **Always auto-archive** - No settings toggle, always enabled
2. **Lower priority** - Archive jobs yield to media imports
3. **"Archive All Pending" button** - Add to BOTH App Settings AND Location Settings
4. **Location-scoped** - Location Settings button only archives sources for that location

---

## Problem Statement

Currently, users must:
1. Save a bookmark via Research Browser or WebBrowser page
2. Navigate to the bookmark
3. Manually click "Archive" button to trigger archiving

This is two extra steps. Users expect: save bookmark → done.

---

## Goals

1. Automatically trigger archiving when a web source is created
2. Run archiving in the background (non-blocking)
3. Provide visual feedback on archive progress
4. Handle failures gracefully (don't block future saves)

---

## Current Architecture

```
User saves URL
    ↓
websources:create IPC handler
    ↓
Repository.create() → status='pending'
    ↓
Returns to UI (DONE)
    ↓
[User must manually click Archive]
    ↓
websources:archive IPC handler
    ↓
Orchestrator.archiveSource()
```

---

## Proposed Architecture

```
User saves URL
    ↓
websources:create IPC handler
    ↓
Repository.create() → status='pending'
    ↓
Add job to JobQueue (queue='websource-archive')  ← NEW
    ↓
Returns to UI immediately (DONE)
    ↓
[Background]
Job worker picks up job
    ↓
Orchestrator.archiveSource()
    ↓
Status updates via IPC events
```

---

## Implementation Options

### Option A: Direct Archive Call (NOT RECOMMENDED)
- Call `orchestrator.archiveSource()` directly in `websources:create` handler
- **Cons**: Blocks UI, no concurrency control, poor error isolation

### Option B: Job Queue (RECOMMENDED) ✅
- Use existing `JobQueue` infrastructure from Import v2
- Add job after create, return immediately
- Job worker processes archive in background
- **Pros**: Non-blocking, retry support, progress tracking, already tested

### Option C: setTimeout/setImmediate
- Simple but no persistence, no retry, no queue management
- **Cons**: Lost on restart, no monitoring

**Recommendation: Option B** - Leverages battle-tested job queue with retry, monitoring, persistence.

---

## Critical Constraint: Browser Profile Lock

**Issue**: Research Browser profile at `~/Library/Application Support/Chromium/` is **locked while Research Browser is running**.

**Implication**: If user saves bookmark from Research Browser extension, we can't immediately archive using their cookies because the profile is locked.

### Mitigation Options

1. **Warn user**: "Close Research Browser for best results"
2. **Fallback profile**: Use separate `browser-profile/` when main profile is locked
3. **Delay archive**: Queue job, attempt when browser closes
4. **Accept degraded mode**: Some sites may block without cookies

**Recommendation**: Option 2 + 4 - Try Research Browser profile, fallback to app profile if locked.

---

## File Changes

| File | Change | Description |
|------|--------|-------------|
| `websources.ts` (IPC) | MODIFY | Add job enqueue after create, duplicate check |
| `job-worker-service.ts` | MODIFY | Add `websource-archive` queue handler |
| `websource-capture-service.ts` | MODIFY | Detect profile lock, use fallback |
| `Settings.svelte` | MODIFY | Add "Archive Pending Web Sources" button |
| `LocationDetail.svelte` | MODIFY | Add "Archive Pending Sources" button |
| `preload.cjs` | MODIFY | Expose archive completion event listener |
| UI components | MODIFY | Show archiving indicator badges |

---

## Job Queue Integration

```typescript
// In websources.ts IPC handler after create
import { getJobQueue } from '../../services/job-queue';

ipcMain.handle('websources:create', async (_event, input) => {
  const source = await webSourcesRepo.create(validatedInput);

  // Queue archive job (non-blocking)
  const jobQueue = getJobQueue(db);
  await jobQueue.addJob({
    queue: 'websource-archive',
    payload: { sourceId: source.source_id },
    priority: 5, // Lower than media import
  });

  return source;
});
```

```typescript
// In job-worker-service.ts
case 'websource-archive': {
  const { sourceId } = payload as { sourceId: string };
  const orchestrator = getOrchestrator(db);
  await orchestrator.archiveSource(sourceId);
  break;
}
```

---

## Browser Profile Lock Detection

```typescript
// In websource-capture-service.ts
export function isProfileLocked(profilePath: string): boolean {
  const lockFile = path.join(profilePath, 'SingletonLock');
  return fs.existsSync(lockFile);
}

export function getResearchBrowserProfilePath(): string {
  const primaryProfile = path.join(os.homedir(), 'Library/Application Support/Chromium');

  if (fs.existsSync(primaryProfile) && !isProfileLocked(primaryProfile)) {
    console.log('[WebSource] Using Research Browser profile');
    return primaryProfile;
  }

  // Fallback to app-managed profile
  console.log('[WebSource] Research Browser locked, using fallback profile');
  const { app } = require('electron');
  const fallbackDir = path.join(app.getPath('userData'), 'browser-profile');
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return fallbackDir;
}
```

---

## UI Feedback

### Option 1: Status Badge on Card
- Show spinner/badge while archiving
- Green check when complete
- Red X with retry button on failure

### Option 2: Toast Notifications
- "Archiving [domain]..."
- "Archive complete: [title]"
- "Archive failed: [error]" with retry link

### Option 3: Dashboard Widget
- "Archiving: 3 in queue"
- Links to pending items

**Recommendation**: Option 1 + 2 for immediate feedback without clutter.

---

## Rate Limiting

To avoid overwhelming the system:

```typescript
// Job queue configuration
const WEBSOURCE_ARCHIVE_CONFIG = {
  concurrency: 1,        // One archive at a time
  delayBetweenJobs: 2000, // 2 second delay between archives
  maxRetries: 3,
  retryDelay: 30000,     // 30 seconds before retry
};
```

---

## Error Handling

| Error | Handling |
|-------|----------|
| Profile locked | Use fallback profile, warn user in UI |
| Bot detection (403) | Mark as failed, suggest manual visit |
| Network error | Retry with backoff |
| Timeout | Mark partial, save what we got |
| Disk full | Alert user, pause queue |

---

## Testing Checklist

- [ ] Save bookmark → archive starts automatically
- [ ] UI shows archiving progress indicator
- [ ] Archive completes → badge updates to complete
- [ ] Archive fails → badge shows error with retry
- [ ] Multiple saves → queue processes in order
- [ ] Research Browser open → falls back to app profile
- [ ] Research Browser closed → uses Research Browser cookies
- [ ] App restart → pending jobs resume
- [ ] Settings toggle disables auto-archive

---

## Migration

No schema changes required. Existing `pending` sources can be batch-archived via `websources:archivePending`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Queue backs up | Concurrency limit, progress visibility, "Archive All" button |
| Bot detection | Stealth plugin + cookies (OPT-112) |
| Profile lock causes failures | Fallback profile, clear messaging |
| Duplicate jobs | Check queue before adding |

---

## Best Practices Applied

1. **Non-blocking** - Job queue returns immediately
2. **Persistence** - SQLite-backed queue survives restart
3. **Retry** - Failed jobs retry with backoff
4. **Monitoring** - Uses existing metrics/tracing
5. **Graceful degradation** - Fallback profile when primary locked
6. **User feedback** - Visual progress indicators + IPC events
7. **Rate limiting** - One archive at a time, prevents overwhelming system
8. **Idempotent** - Duplicate job prevention

---

## CLAUDE.md Compliance

- [x] Scope Discipline - Only implements requested feature
- [x] Archive-First - Serves research/metadata workflows
- [x] Offline-First - No new external dependencies
- [x] Keep It Simple - Reuses existing job queue
- [x] No AI in Docs - No AI mentions in UI

---

## Gaps Identified & Solutions

| Gap | Issue | Solution |
|-----|-------|----------|
| **Duplicate jobs** | Same URL queued twice | Check queue before adding job |
| **Deleted while queued** | Source deleted before archive | Worker checks existence first |
| **UI updates** | UI doesn't know when done | Emit IPC event on completion |
| **Offline saves** | Save while offline | Queue anyway, retry when online |
| **Location-scoped button** | Archive only for one location | Pass `locid` filter to archivePending |

---

## "Archive All Pending" Buttons

### App Settings (Global)
- Location: Settings → Archive section (near "Regenerate Thumbnails")
- Action: Archives ALL pending web sources across all locations
- Label: "Archive Pending Web Sources"
- Shows count: "(12 pending)"

### Location Settings
- Location: LocationDetail → Settings tab (near thumbnail regenerate)
- Action: Archives pending web sources FOR THIS LOCATION ONLY
- Label: "Archive Pending Sources"
- Shows count: "(3 pending for this location)"

---

## IPC Events for UI Reactivity

```typescript
// Emit when archive completes/fails
ipcMain.emit('websources:archive-complete', {
  sourceId: string,
  success: boolean,
  error?: string
});

// Renderer listens and updates UI
window.electron.websources.onArchiveComplete((result) => {
  // Update card badge, show toast, etc.
});
```

---

## Future Enhancements (Not in this PR)

### Near-term
- **Priority boost** - Bump priority when user views pending source
- **Domain rate limiting** - Don't hit same domain too fast

### Long-term
- **Archive profiles** - Full, Light (no video), Images only
- **Remote save API** - Save from phone via local network
- **Parallel archives** - Multiple concurrent (different domains)

**REJECTED** (this is point-in-time archive, not monitoring):
- ~~Scheduled re-archiving~~ - User manually re-archives when needed
- ~~Change detection~~ - Each archive is a timestamp snapshot, not a diff tool

---

## Estimated Changes (Updated)

| File | Lines | Purpose |
|------|-------|---------|
| `websources.ts` (IPC) | ~60 | Job enqueue + duplicate check |
| `job-worker-service.ts` | ~40 | Archive queue handler |
| `websource-capture-service.ts` | ~25 | Lock detection |
| `Settings.svelte` | ~40 | Global "Archive All" button |
| `LocationDetail.svelte` | ~40 | Location "Archive All" button |
| `preload.cjs` | ~10 | Event listener exposure |
| UI components | ~30 | Progress indicators |

**Total: ~245 lines**

