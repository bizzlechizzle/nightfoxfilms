# Performance Profiling Report — v0.1.0

**Generated:** 2025-11-30
**Phase:** Post-Stabilization Optimization, Phase 2

---

## Startup Analysis

- **Current estimated startup time:** 1.4–2.5 seconds
- **Blocking operations:** 12 significant
- **Optimization potential:** 700–1200ms reduction (50–60% faster)

### Startup Bottlenecks

| Priority | Location | Issue | Potential Gain |
|----------|----------|-------|----------------|
| CRITICAL | `database.ts:269-1330` | 39 migrations re-validated every startup using sequential PRAGMA calls | 300–400ms |
| HIGH | `health-monitor.ts:69-72` | Integrity check runs on every startup if enabled | 100–500ms |
| HIGH | `index.ts:241,251,430` | Bookmark API, WebSocket, BrowserView block window render | 120–350ms |
| MEDIUM | `index.ts:261` | Redundant BackupScheduler.initialize() call | 10–20ms |
| LOW | `index.ts:266` | startup backup (if enabled) | 500ms–5s |

### Startup Sequence Trace

| Step | File | Operation | Blocking? | Est. Time |
|------|------|-----------|-----------|-----------|
| 1 | index.ts:27-37 | Protocol registration | Yes | <5ms |
| 2 | index.ts:86 | Single instance lock | Yes | <5ms |
| 3 | index.ts:40-71 | Crash handlers | Yes | <1ms |
| 4 | index.ts:199-201 | Load config | Yes | 5–15ms |
| 5 | index.ts:205 | Database init | Yes | 100–500ms |
| 6 | database.ts:269-1330 | **39 migrations** | **Yes** | **300–400ms** |
| 7 | index.ts:210-212 | Health monitor init | Yes | 50–200ms |
| 8 | index.ts:216-227 | Integrity check | Yes | 100–500ms |
| 9 | index.ts:231 | IPC registration | Yes | 10–20ms |
| 10 | index.ts:241 | Bookmark API Server | Yes | 50–100ms |
| 11 | index.ts:251 | WebSocket Server | Yes | 20–50ms |
| 12 | index.ts:261 | BackupScheduler (duplicate) | Yes | 10–20ms |
| 13 | index.ts:104-128 | Window creation | Yes | 100–300ms |
| 14 | index.ts:430 | Browser view manager | Yes | 50–200ms |

---

## Database Analysis

- **Queries audited:** 50+ patterns identified
- **Missing indexes:** 3 potential
- **N+1 patterns:** 2 critical

### Query Optimizations

| Priority | Query Location | Issue | Fix |
|----------|----------------|-------|-----|
| HIGH | locations.ts:25-38 | `getCurrentUser()` runs 2 queries per handler call | Cache user context in memory |
| HIGH | media-import.ts:29-42 | Duplicate `getCurrentUser()` implementation | Consolidate to shared service |
| HIGH | locations.ts:50-57 | `location:findAll` returns unbounded dataset | Add pagination with LIMIT/OFFSET |
| MEDIUM | ref-maps.ts:254-280 | `getAllPoints` re-deduplicates on every call | Cache catalogued point IDs |
| MEDIUM | media-import.ts:213-221 | Archive path re-queried every import | Cache in memory singleton |
| LOW | ref_map_points table | GPS-based queries may need indexes | Add index on (lat, lng) |

### N+1 Pattern Detail

**getCurrentUser() called in every handler:**
- 2 queries per call (current_user_id, current_user)
- Called 6+ times across location handlers
- Called 2+ times in media-import handlers
- **100 location imports = 400 settings queries**

---

## Rendering Analysis

- **Components audited:** 15+ major components
- **Unnecessary re-renders:** 3 identified
- **Unvirtualized lists:** 2 potential issues

### Rendering Optimizations

| Priority | Component | Issue | Fix |
|----------|-----------|-------|-----|
| HIGH | Atlas.svelte | Router subscription leaks, rerenders on unrelated state | Wrap in $effect with cleanup |
| HIGH | Locations.svelte | Router subscription without cleanup | Add onDestroy cleanup |
| MEDIUM | LocationDetail.svelte | Large media galleries not virtualized | Add virtual scrolling for 100+ items |
| MEDIUM | MediaViewer.svelte | Metadata JSON re-parsed on every view | Cache parsed metadata |
| LOW | LocationGallery.svelte | findIndex() called each iteration | Optimize to direct lookup |

---

## IPC Analysis

| Channel | Payload Size | Frequency | Issue | Fix |
|---------|--------------|-----------|-------|-----|
| location:findAll | 5–10 MB | On page load | Unbounded | Add pagination |
| refMaps:getAllPoints | Variable | On Atlas render | Re-deduplicates each call | Cache filtered results |
| settings:getAll | Small | On init | N/A | Already optimal |
| media:getFullMetadata | Medium | Per media view | JSON re-parsed | Cache parsed |
| imports:findAll | Variable | On history tab | Unbounded | Add pagination |

### IPC Batching Opportunities

1. **User context lookups**: Batch `current_user_id` + `current_user` into single query
2. **Location + media counts**: Combine into single joined query
3. **Settings reads**: Cache all settings on startup, invalidate on write

---

## File System Analysis

| Operation | File | Sync/Async? | Issue | Fix |
|-----------|------|-------------|-------|-----|
| KML parsing | map-parser-service.ts:591 | **Sync** | Blocks main thread | Use async fs.readFile |
| GPX parsing | map-parser-service.ts:596 | **Sync** | Blocks main thread | Use async fs.readFile |
| GeoJSON parsing | map-parser-service.ts:601 | **Sync** | Blocks main thread | Use async fs.readFile |
| CSV parsing | map-parser-service.ts:606 | **Sync** | Blocks main thread | Use async fs.readFile |
| Log read | logger-service.ts:202 | Sync | Low frequency | Acceptable |
| Config read | bootstrap-config.ts:56 | Sync | Startup only | Acceptable |

### File Access Patterns

| Pattern | Present? | Issue |
|---------|----------|-------|
| Streaming hash (crypto) | ✅ Yes | Well implemented |
| Parallel thumbnail generation | ✅ Yes | Well implemented |
| Repeated stat calls | ⚠️ Yes | 3+ stat calls per ref map import |
| File caching | ❌ No | No file content caching |

---

## Memory Analysis

| Issue | Location | Severity |
|-------|----------|----------|
| Router subscription leaks | Atlas.svelte, Locations.svelte | HIGH |
| Toast timer accumulation | toast-store.ts | MEDIUM |
| Metadata JSON not cached | media-processing.ts | MEDIUM |
| ExifTool timeout without kill | exiftool-service.ts | LOW |
| Large payload retention | location:findAll results | LOW |

---

## Quick Wins (< 30 min each)

1. **Cache archive path** — Store in memory singleton instead of querying settings (15 min)
2. **Convert map-parser to async I/O** — Replace 4 `readFileSync` with `readFile` (30 min)
3. **Fix Atlas router subscription** — Wrap in $effect with cleanup return (15 min)
4. **Disable startup integrity check** — Change default config (5 min)
5. **Remove duplicate BackupScheduler.initialize()** — Delete redundant call (5 min)

---

## Major Optimizations (> 2 hours each)

1. **Migration caching system** — Use PRAGMA user_version to skip re-validation (4 hours)
2. **Pagination for location:findAll** — Add limit/offset support, update UI (3 hours)
3. **Defer non-critical servers** — Move Bookmark API, WebSocket, BrowserView to post-render (2 hours)
4. **User context caching service** — Single source, 5-minute cache TTL (2 hours)
5. **Virtual scrolling for galleries** — Add svelte-virtual-list for 100+ items (3 hours)
6. **Batch schema metadata load** — Single query for all PRAGMA info (2 hours)

---

## Performance Targets

| Metric | Current | Target | Priority |
|--------|---------|--------|----------|
| App startup | 1.4–2.5s | <800ms | HIGH |
| location:findAll | unbounded | <100ms w/pagination | HIGH |
| Map parser (50MB file) | ~500ms blocking | <100ms non-blocking | HIGH |
| Settings lookup | 2 queries/call | 0 (cached) | MEDIUM |
| Memory (Atlas page) | Leaks on navigate | Stable | MEDIUM |

---

## Optimized Timeline (After All Fixes)

```
CURRENT STARTUP:
├─ Config load              ~10ms
├─ Database init            ~100ms
├─ Migrations (39×)         ~390ms  ← Bottleneck
├─ Health monitor init      ~100ms
├─ Integrity check          ~300ms  ← Redundant
├─ IPC registration         ~15ms
├─ Bookmark API Server      ~75ms   ← Can defer
├─ WebSocket Server         ~35ms   ← Can defer
├─ Window creation          ~150ms
├─ Browser view manager     ~100ms  ← Can defer
└─ TOTAL:                   ~1.4s

OPTIMIZED STARTUP:
├─ Config load              ~10ms
├─ Database init (cached)   ~50ms
├─ Migrations (skipped)     ~5ms    ← Version check only
├─ Health monitor init      ~50ms
├─ IPC registration         ~15ms
├─ Window creation          ~150ms
├─ (Post-render):
│  ├─ Bookmark API          ~75ms
│  ├─ WebSocket             ~35ms
│  ├─ Browser view          ~100ms
│  └─ Integrity check       ~300ms
└─ UI VISIBLE:              ~350ms  ← 75% faster
```

---

**PHASE 2 COMPLETE** — 5 quick wins, 6 major optimizations identified. Ready for Phase 3.
