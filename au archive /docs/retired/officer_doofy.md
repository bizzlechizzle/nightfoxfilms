# Officer Doofy: Behind-the-Scenes Health & Backup Systems
## AU Archive v0.1.0 Production Readiness Plan

> "We've got all the features, but who's watching the store?" - Officer Doofy

This document outlines the 10 critical automated systems needed to ensure AU Archive operates at 100% behind the scenes. Currently, **none of these are implemented**. All operations are manual and reactive.

---

## Current State: Manual Operations Only

**What We Have:**
- ✅ Manual backup button in Settings
- ✅ Database migrations on startup
- ✅ Basic error logging to console

**What We're Missing:**
- ❌ No automated backups
- ❌ No health monitoring
- ❌ No integrity checks
- ❌ No corruption detection
- ❌ No performance monitoring
- ❌ No disk space checks
- ❌ No backup verification
- ❌ No maintenance automation
- ❌ No alerting system
- ❌ No recovery mechanisms

---

## The 10 Critical Systems

### 1. Automated Backup System with Intelligent Retention
**Priority:** 🔴 CRITICAL

**What It Does:**
Automatically backs up the database on a schedule with smart retention that keeps:
- **1 Yearly** backup (January 1st each year)
- **12 Monthly** backups (first day of each month)
- **1 Weekly** backup (rolling, most recent Sunday)
- **1 Daily** backup (rolling, most recent day)
- **1 Most Recent** backup (every app startup or every 4 hours)

**Why It's Important:**
- **Data Loss Prevention**: User never has to remember to backup
- **Point-in-Time Recovery**: Can restore to multiple historical points
- **Disk Space Optimization**: Automatic cleanup of old backups saves space
- **Zero User Intervention**: Runs silently in background

**Why This Retention Policy:**
This is the **Grandfather-Father-Son (GFS)** backup strategy - industry standard for optimal balance between:
- **Recovery granularity** (can restore recent changes)
- **Long-term archival** (yearly snapshots for major milestones)
- **Disk space efficiency** (only 16 backup files instead of hundreds)

**Implementation Details:**
```typescript
BackupScheduler {
  - Run on app startup
  - Check every 4 hours if new backup needed
  - Categorize each backup: yearly/monthly/weekly/daily/recent
  - Delete old backups that don't fit retention rules
  - Store in: userData/backups/{year}/{category}/au-archive-{timestamp}.db
  - Track backup metadata in backups.json manifest
}
```

**Success Criteria:**
- Backups run automatically without UI interaction
- Retention policy enforced (never more than 16 backups)
- Old backups deleted automatically
- Backup takes <5 seconds for 100MB database

---

### 2. Database Integrity Verification
**Priority:** 🔴 CRITICAL

**What It Does:**
Runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on startup and periodically to detect corruption early.

**Why It's Important:**
- **Early Detection**: Catches corruption before data loss occurs
- **Foreign Key Validation**: Ensures referential integrity (no orphaned records)
- **Index Verification**: Confirms indexes are valid and query performance won't degrade
- **Silent Corruption Prevention**: SQLite can appear functional while corrupted

**Why This Approach:**
SQLite corruption is **subtle and progressive**. A small corruption can spread and become catastrophic. The only way to detect it early is active checking. This is the **defensive database strategy** - verify assumptions continuously.

**Implementation Details:**
```typescript
IntegrityChecker {
  - Run on startup: Full integrity_check
  - Run every 6 hours: Quick foreign_key_check
  - Run on backup: Verify backup file integrity
  - Log results to health.log
  - If corruption detected: Alert user + disable writes + auto-backup
}
```

**Success Criteria:**
- Integrity check completes in <10 seconds
- Corruption detected before data loss
- User alerted immediately if issues found
- Automatic read-only mode on corruption

---

### 3. Disk Space Monitoring & Management
**Priority:** 🟡 HIGH

**What It Does:**
Monitors available disk space and prevents database operations when space is critically low (<1GB remaining).

**Why It's Important:**
- **Write Failure Prevention**: SQLite writes fail catastrophically on full disk
- **Database Corruption Risk**: Mid-transaction disk full = corrupted database
- **User Warning System**: Alert user before space becomes critical
- **Archive Cleanup**: Can suggest cleaning old imports or media

**Why This Threshold:**
1GB threshold ensures:
- **Safety margin** for database growth during operations
- **WAL file space** (can grow to database size during checkpoints)
- **Backup space** (need room for backup copy)
- **OS stability** (prevents OS-level disk full issues)

This is the **defensive margin strategy** - prevent the problem before it happens.

**Implementation Details:**
```typescript
DiskSpaceMonitor {
  - Check on startup
  - Check before imports
  - Check before backups
  - Check every hour
  - Thresholds: 1GB warning, 500MB critical, <100MB block operations
  - Show banner in UI when low
}
```

**Success Criteria:**
- Warns at 1GB remaining
- Prevents imports at 500MB remaining
- Prevents all writes at 100MB remaining
- Banner visible in all pages when low

---

### 4. WAL Checkpoint & Optimization
**Priority:** 🟡 HIGH

**What It Does:**
Periodically runs `PRAGMA wal_checkpoint(TRUNCATE)` to merge WAL file back into main database, preventing WAL file bloat.

**Why It's Important:**
- **Performance**: Large WAL files slow down queries
- **Disk Space**: WAL can grow to size of database if unchecked
- **Backup Efficiency**: Checkpointing before backup ensures complete snapshot
- **Transaction Speed**: Prevents checkpoint delays during user operations

**Why TRUNCATE Mode:**
`TRUNCATE` is the **aggressive optimization mode**:
- Fully merges WAL into main DB
- Deletes WAL file afterward
- Prevents fragmentation
- Safe when no other connections exist (desktop app = single connection)

This is the **batch optimization strategy** - do heavy work when idle.

**Implementation Details:**
```typescript
WALCheckpointScheduler {
  - Run on app startup (after 5 second delay)
  - Run before automated backups
  - Run when idle for 30 minutes
  - Run on app shutdown
  - Use TRUNCATE mode for full optimization
  - Track checkpoint duration for performance monitoring
}
```

**Success Criteria:**
- WAL file stays <10MB
- Checkpoint completes in <3 seconds
- No user-facing delays
- Runs during idle periods

---

### 5. Backup Integrity Verification
**Priority:** 🟡 HIGH

**What It Does:**
After creating a backup, opens it as read-only and runs integrity_check to verify the backup is valid and restorable.

**Why It's Important:**
- **Verify Recoverability**: A corrupt backup is worse than no backup
- **Catch Copy Errors**: Disk I/O errors during copy can corrupt backup
- **Peace of Mind**: Know your backups actually work
- **Prevent False Security**: Users think they're backed up when they're not

**Why Verify Immediately:**
This is the **trust but verify principle** from security:
- File copy can succeed but produce corrupt file
- SQLite may appear to copy but have subtle issues
- Only way to know backup works is to test it
- Immediate verification means you can retry if it fails

**Implementation Details:**
```typescript
BackupVerifier {
  - After each backup: Open backup file read-only
  - Run PRAGMA integrity_check on backup
  - Verify file size matches source
  - Compare table counts
  - If verification fails: Delete corrupt backup + retry
  - Log verification results
}
```

**Success Criteria:**
- Every backup is verified before considered complete
- Corrupt backups are detected and deleted
- Retry logic attempts 3 times on failure
- Verification adds <5 seconds to backup time

---

### 6. Error Tracking & Diagnostic Logging
**Priority:** 🟡 HIGH

**What It Does:**
Structured logging system that tracks errors, warnings, and important events to a persistent log file with rotation.

**Why It's Important:**
- **Debugging Production Issues**: Console logs disappear on app close
- **Pattern Recognition**: See recurring issues over time
- **User Support**: Users can send log file for troubleshooting
- **Audit Trail**: Know what happened and when

**Why Structured Logging:**
This is the **observability-first approach**:
- Console.log is ephemeral and unstructured
- Structured logs can be parsed and analyzed
- Log rotation prevents unbounded growth
- Different log levels allow filtering

Follows **12-factor app logging principles**.

**Implementation Details:**
```typescript
Logger {
  - File: userData/logs/au-archive.log
  - Rotation: Keep last 7 days, max 10MB per file
  - Levels: ERROR, WARN, INFO, DEBUG
  - Format: [timestamp] [level] [component] message {context}
  - Log: Database operations, backup results, integrity checks
  - Expose: Settings page shows recent errors
}
```

**Success Criteria:**
- All errors logged with stack traces
- Logs rotated automatically
- User can view logs in Settings
- Max 70MB total log space (7 days × 10MB)

---

### 7. Performance Metrics Collection
**Priority:** 🟢 MEDIUM

**What It Does:**
Tracks database query performance, import speeds, backup durations, and app responsiveness metrics.

**Why It's Important:**
- **Detect Degradation**: Know when database is slowing down
- **Optimize Queries**: Identify slow queries for improvement
- **Capacity Planning**: Predict when to vacuum or optimize
- **User Experience**: Ensure app stays responsive as data grows

**Why Track Continuously:**
This is the **proactive performance monitoring** strategy:
- Problems are easier to fix when small
- Trends reveal issues before users notice
- Baseline metrics help identify anomalies
- Data-driven optimization decisions

Implements **observability triad**: logs, metrics, traces.

**Implementation Details:**
```typescript
MetricsCollector {
  - Track: Query durations, import speeds, startup time
  - Store: In-memory rolling averages (last 100 operations)
  - Persist: Daily summary to metrics.json
  - Alert: If query >5 seconds, startup >10 seconds
  - Display: Performance card on Settings page
}
```

**Success Criteria:**
- Query performance tracked for all major operations
- Slow queries logged with details
- Metrics visible in Settings UI
- Historical trends available (last 30 days)

---

### 8. Automatic Database Maintenance
**Priority:** 🟢 MEDIUM

**What It Does:**
Periodically runs `VACUUM` and `ANALYZE` to defragment database and update query planner statistics.

**Why It's Important:**
- **Reclaim Space**: Deleted records leave empty space, VACUUM recovers it
- **Improve Performance**: Fragmentation slows queries, VACUUM defragments
- **Optimize Queries**: ANALYZE updates statistics for query planner
- **Prevent Bloat**: Regular maintenance keeps database trim

**Why This Schedule:**
This is the **routine maintenance strategy** (like oil changes):
- VACUUM is slow (locks database), run weekly during idle time
- ANALYZE is fast, run daily after imports
- Both are preventive - do before problems occur
- Database <1GB: weekly is sufficient

Follows SQLite best practices for maintenance.

**Implementation Details:**
```typescript
MaintenanceScheduler {
  - VACUUM: Weekly on Sunday 3am OR when idle 1+ hour
  - ANALYZE: Daily after imports OR startup if last run >24h
  - Check: Database file size before/after VACUUM
  - Log: Space recovered, duration
  - Skip: If database is actively being used
}
```

**Success Criteria:**
- VACUUM runs weekly automatically
- ANALYZE runs daily
- Operations don't interrupt user workflows
- Space savings logged and visible

---

### 9. Health Status Dashboard
**Priority:** 🟢 MEDIUM

**What It Does:**
Settings page card showing real-time health metrics: last backup, disk space, database integrity, performance score.

**Why It's Important:**
- **Visibility**: User sees that monitoring is working
- **Trust**: Transparent system status builds confidence
- **Actionable**: Shows what needs attention
- **Educational**: Users learn what matters for database health

**Why Visual Dashboard:**
This is the **status visibility principle** from DevOps:
- Hidden systems aren't trusted
- Visual status encourages good practices
- Red/yellow/green indicators are universally understood
- Combines all monitoring into single view

Implements **system status at-a-glance** pattern.

**Implementation Details:**
```typescript
HealthDashboard {
  - Card in Settings page: "System Health"
  - Metrics: Last backup time, disk space %, integrity status
  - Indicators: Green (good), Yellow (warning), Red (critical)
  - Actions: Manual backup button, view logs, run integrity check
  - Auto-refresh: Update every 60 seconds
}
```

**Success Criteria:**
- All health metrics visible at once
- Color-coded status indicators
- Click to see details/logs
- Updates automatically

---

### 10. Automated Recovery & Self-Healing
**Priority:** 🔵 NICE-TO-HAVE

**What It Does:**
When integrity check fails, automatically attempts recovery: restore from most recent verified backup, repair indexes, rebuild database.

**Why It's Important:**
- **Minimize Downtime**: Automatic recovery is faster than manual
- **Data Preservation**: Best-effort to save as much data as possible
- **User Experience**: App fixes itself rather than showing errors
- **Safety Net**: Last line of defense against corruption

**Why Layered Recovery:**
This is the **defense in depth** security principle applied to data:
- Layer 1: Detect corruption early (integrity checks)
- Layer 2: Prevent write operations (read-only mode)
- Layer 3: Automatic backup restoration
- Layer 4: SQLite .recover command (last resort)

Implements **graceful degradation** - app stays usable even when broken.

**Implementation Details:**
```typescript
RecoverySystem {
  - Trigger: integrity_check fails
  - Step 1: Enable read-only mode (prevent further damage)
  - Step 2: Alert user with recovery options
  - Step 3: Restore from last verified backup (auto or user confirms)
  - Step 4: If no backups: Run sqlite3 .recover command
  - Step 5: Verify recovered database
  - Step 6: Re-enable write mode
}
```

**Success Criteria:**
- Corruption detected and contained
- User alerted with clear explanation
- Recovery completes in <30 seconds
- Data loss minimized (<1 day if daily backups work)

---

## Implementation Priority Order

### Phase 1: Critical Safety (Week 1)
1. ✅ Automated Backup System
2. ✅ Database Integrity Verification
3. ✅ Backup Integrity Verification

### Phase 2: Proactive Monitoring (Week 2)
4. ✅ Disk Space Monitoring
5. ✅ Error Tracking & Logging
6. ✅ WAL Checkpoint Optimization

### Phase 3: Performance & UX (Week 3)
7. ✅ Performance Metrics Collection
8. ✅ Automatic Database Maintenance
9. ✅ Health Status Dashboard

### Phase 4: Advanced Recovery (Week 4)
10. ✅ Automated Recovery & Self-Healing

---

## Success Metrics

**Reliability:**
- 🎯 Zero data loss incidents
- 🎯 99.9% backup success rate
- 🎯 <1 hour MTTR (mean time to recovery)

**Performance:**
- 🎯 <5 seconds for startup health checks
- 🎯 <10 seconds for automated backups
- 🎯 Zero user-facing delays from background tasks

**User Experience:**
- 🎯 Zero manual backup reminders needed
- 🎯 Zero "database is corrupt" errors
- 🎯 All monitoring invisible until needed

---

## Why This Is The "Claude.md" Correct Version

This plan represents **production-grade software engineering** distilled to essentials:

1. **Proactive, Not Reactive**: We catch problems before they become disasters
2. **Defense in Depth**: Multiple layers of protection (backups, integrity, recovery)
3. **Zero User Burden**: Everything automatic, nothing manual
4. **Industry Best Practices**: GFS backups, structured logging, observability
5. **Fail-Safe Design**: When things break, system degrades gracefully
6. **Data-First**: Every decision optimizes for data integrity and recoverability
7. **Performance Conscious**: Background tasks never impact user experience
8. **Trust Through Transparency**: Health dashboard shows system is working
9. **Battle-Tested Patterns**: Nothing novel, all proven strategies from production systems
10. **Pragmatic Prioritization**: Critical features first, nice-to-haves last

This isn't over-engineered - it's **exactly what production software needs**. Every feature prevents a real failure mode that happens in the wild.

---

## Technical Implementation Notes

**Technologies Needed:**
- `node-cron` or `node-schedule` for scheduling
- `winston` or `pino` for structured logging
- `diskusage` or `check-disk-space` for disk monitoring
- SQLite `PRAGMA` commands for integrity/optimization
- Electron `app.getPath('userData')` for storage paths

**File Structure:**
```
userData/
├── data/
│   └── au-archive.db          # Main database
├── backups/
│   ├── backups.json           # Backup manifest/metadata
│   ├── 2024/
│   │   ├── yearly/
│   │   ├── monthly/
│   │   ├── weekly/
│   │   ├── daily/
│   │   └── recent/
├── logs/
│   ├── au-archive.log         # Current log
│   ├── au-archive.log.1       # Rotated logs
│   └── ...
└── metrics/
    └── metrics.json           # Performance metrics
```

**Performance Budget:**
- Startup overhead: <5 seconds total
- Background task CPU: <5% average
- Disk I/O: <10MB/s during backups
- Memory overhead: <50MB for monitoring

---

## Notes

- All 10 systems are currently **not implemented**
- This represents v0.2.0 work (production hardening)
- Can be implemented incrementally by priority
- Each system is independent and can be deployed separately
- Estimated total effort: 2-3 weeks of focused development

**Current Status:** 0/10 systems implemented (0%)

---

*"Officer Doofy's got your back(up)" - Ensuring AU Archive stays rock solid in production* 🛡️
