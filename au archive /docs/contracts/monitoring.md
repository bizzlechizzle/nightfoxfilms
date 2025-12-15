# Monitoring Contract

**Version:** 1.0
**Added:** 2025-12-05

---

## Overview

The Monitoring & Audit System provides observability for the Import v2 pipeline through three integrated services: MetricsCollector, Tracer, and AlertManager.

---

## Architecture

### Services

| Service | Purpose | Location |
|---------|---------|----------|
| MetricsCollector | Time-series metrics (counters, gauges, histograms, timers) | `services/monitoring/metrics-collector.ts` |
| Tracer | Distributed tracing with spans and parent-child relationships | `services/monitoring/tracer.ts` |
| AlertManager | Rule-based alerting with cooldowns and notifications | `services/monitoring/alert-manager.ts` |

### Database Tables (Migration 51)

| Table | Purpose |
|-------|---------|
| `metrics` | Time-series metric values with tags |
| `traces` | Distributed trace spans |
| `alerts` | Alert definitions and states |
| `alert_history` | Fired alert records |
| `health_snapshots` | Periodic system health captures |
| `audit_log` | User and system action audit trail |

---

## Metrics

### Naming Convention

Metrics use dot-notation: `{domain}.{component}.{metric}`

### Standard Metrics

| Metric Name | Type | Description |
|------------|------|-------------|
| `import.files.total` | Counter | Total files processed |
| `import.files.success` | Counter | Successfully imported files |
| `import.files.failed` | Counter | Failed file imports |
| `import.files.skipped` | Counter | Skipped files (duplicates) |
| `import.files.duration` | Histogram | Import duration per file (ms) |
| `import.bytes.total` | Counter | Total bytes processed |
| `jobs.enqueued` | Counter | Jobs added to queue |
| `jobs.completed` | Counter | Successfully completed jobs |
| `jobs.failed` | Counter | Failed jobs |
| `jobs.retried` | Counter | Jobs scheduled for retry |
| `jobs.dead` | Counter | Jobs moved to dead letter queue |
| `jobs.duration` | Histogram | Job execution time (ms) |
| `jobs.queue.depth` | Gauge | Current queue depth |
| `workers.active` | Gauge | Active worker count |
| `workers.idle` | Gauge | Idle worker count |
| `system.disk.free` | Gauge | Free disk space (bytes) |
| `system.memory.used` | Gauge | RSS memory usage (bytes) |
| `system.memory.heap` | Gauge | Heap memory usage (bytes) |
| `errors.count` | Counter | Error count by type |

### Metric Types

```typescript
// Counter - monotonically increasing value
metrics.incrementCounter('import.files.total', 1, { source: 'drop-zone' });

// Gauge - point-in-time value
metrics.gauge('jobs.queue.depth', queueSize, { queue: 'media-import' });

// Histogram - value distribution
metrics.histogram('import.files.duration', durationMs, { fileType: 'image' });

// Timer - convenience wrapper for duration measurement
const timer = metrics.timer('jobs.duration', { queue: 'media-import' });
await processJob();
timer.stop(); // Records elapsed time
```

### Tags

All metrics support optional tags for filtering:

```typescript
metrics.incrementCounter('jobs.failed', 1, {
  queue: 'media-import',
  error_type: 'validation',
  file_type: 'video'
});
```

---

## Tracing

### Span Structure

```typescript
interface Span {
  traceId: string;      // Unique trace identifier
  spanId: string;       // Unique span identifier
  parentSpanId?: string; // Parent span for nested operations
  operationName: string; // e.g., 'import.file', 'job.process'
  startTime: number;    // Unix timestamp (ms)
  endTime?: number;     // Unix timestamp (ms)
  duration?: number;    // Calculated duration (ms)
  status: 'pending' | 'success' | 'error';
  tags: Record<string, string | number | boolean>;
  logs: Array<{ timestamp: number; message: string; level: string }>;
}
```

### Standard Operations

| Operation Name | Description |
|---------------|-------------|
| `import.batch` | Full batch import operation |
| `import.file` | Single file import |
| `import.hash` | File hashing operation |
| `import.metadata` | Metadata extraction |
| `import.copy` | File copy to archive |
| `job.process` | Job processing |
| `job.execute` | Job execution (handler) |
| `db.query` | Database query |
| `db.write` | Database write |

### Usage

```typescript
// Start a span
const span = tracer.startSpan('import.file', {
  filePath: '/path/to/file.jpg',
  fileSize: 1024000
});

try {
  await importFile();
  span.setTag('result', 'success');
  tracer.finishSpan(span.spanId, 'success');
} catch (error) {
  span.log('error', error.message);
  tracer.finishSpan(span.spanId, 'error');
}

// Nested spans (parent-child)
const parentSpan = tracer.startSpan('import.batch');
const childSpan = tracer.startSpan('import.file', { parentSpanId: parentSpan.spanId });
```

---

## Alerts

### Default Alert Rules

| Rule | Condition | Severity | Cooldown |
|------|-----------|----------|----------|
| Low Disk Space | Free space < 10% | critical | 1 hour |
| Disk Space Warning | Free space < 20% | warning | 30 min |
| High Job Failure Rate | > 10% failures | warning | 15 min |
| Dead Letter Queue Growth | > 100 dead jobs | critical | 1 hour |
| Memory Pressure | Heap > 1.5GB | warning | 30 min |
| High Error Rate | > 10 errors/min | warning | 15 min |

### Alert Metrics Input

```typescript
interface AlertMetrics {
  diskSpacePercent: number;     // % free
  diskSpaceFreeGB: number;      // GB free
  jobsPending: number;
  jobsProcessing: number;
  jobsFailed: number;
  jobsDead: number;
  oldestJobAgeMinutes: number;
  activeImports: number;
  importErrorRate: number;
  workersActive: number;
  workersIdle: number;
  errorsLastHour: number;
  errorRatePerMinute: number;
}
```

### Custom Rules

```typescript
alertManager.addRule({
  id: 'custom-rule',
  name: 'Custom Alert',
  condition: (metrics) => metrics.jobsPending > 1000,
  severity: 'warning',
  message: 'Job queue is backing up',
  cooldownMinutes: 15
});
```

---

## IPC Endpoints

### Metrics

| Channel | Parameters | Returns |
|---------|------------|---------|
| `monitoring:metrics:get` | `{ name?, startTime?, endTime?, tags? }` | `MetricRecord[]` |
| `monitoring:metrics:summary` | none | `{ counters, gauges, histograms }` |
| `monitoring:metrics:record` | `{ name, value, type, tags? }` | `void` |
| `monitoring:metrics:clear` | `{ name }` | `void` |

### Traces

| Channel | Parameters | Returns |
|---------|------------|---------|
| `monitoring:traces:get` | `{ traceId?, operationName?, status?, limit? }` | `Span[]` |
| `monitoring:traces:getById` | `{ traceId }` | `Span[]` |
| `monitoring:traces:startSpan` | `{ operationName, parentSpanId?, tags? }` | `Span` |
| `monitoring:traces:finishSpan` | `{ spanId, status, tags? }` | `void` |
| `monitoring:traces:clear` | `{ olderThanMs? }` | `void` |

### Alerts

| Channel | Parameters | Returns |
|---------|------------|---------|
| `monitoring:alerts:getAll` | none | `Alert[]` |
| `monitoring:alerts:getActive` | none | `Alert[]` |
| `monitoring:alerts:getHistory` | `{ limit?, severity? }` | `AlertHistoryEntry[]` |
| `monitoring:alerts:acknowledge` | `{ alertId }` | `void` |
| `monitoring:alerts:check` | `{ metrics: AlertMetrics }` | `FiredAlert[]` |

### Dashboard

| Channel | Parameters | Returns |
|---------|------------|---------|
| `monitoring:dashboard:summary` | none | `DashboardSummary` |
| `monitoring:dashboard:cleanup` | `{ metricsOlderThanDays?, tracesOlderThanDays? }` | `{ metrics, traces, alerts }` |

---

## Retention & Cleanup

### Default Retention

| Data Type | Default Retention |
|-----------|-------------------|
| Metrics | 7 days |
| Traces | 3 days |
| Alert History | 30 days |
| Health Snapshots | 30 days |
| Audit Log | 90 days |

### Cleanup API

```typescript
await window.electron.monitoring.dashboard.cleanup({
  metricsOlderThanDays: 7,
  tracesOlderThanDays: 3
});
```

---

## Instrumentation Points

### Import Pipeline

1. **Orchestrator** (`orchestrator.ts`)
   - Batch start/complete metrics
   - Per-file import traces
   - Error counting

2. **Job Queue** (`job-queue.ts`)
   - Enqueue/complete/fail counters
   - Dead letter queue tracking
   - Retry counting

3. **Job Worker** (`job-worker-service.ts`)
   - Worker active/idle gauges
   - Job duration histograms
   - Processing traces

4. **Health Monitor** (`health-monitor.ts`)
   - System resource gauges
   - Alert condition checks

---

## Health Snapshots

Periodic snapshots capture system state:

```typescript
interface HealthSnapshot {
  overall_status: 'healthy' | 'warning' | 'critical';
  disk_free: number;
  disk_total: number;
  memory_used: number;
  memory_heap: number;
  job_queue_pending: number;
  job_queue_processing: number;
  error_count: number;
  components_json: string;
}
```

---

## Audit Log

Records user and system actions:

```typescript
interface AuditEntry {
  action: string;        // e.g., 'location.create', 'import.start'
  actor: string;         // User or 'system'
  resource_type: string; // e.g., 'location', 'media'
  resource_id?: string;  // Resource identifier
  details_json?: string; // Additional context
  timestamp: string;     // ISO8601
}
```

---

## Best Practices

1. **Always use MetricNames constants** - Prevents typos and enables refactoring
2. **Tag metrics appropriately** - Enable filtering without creating metric explosion
3. **Finish all spans** - Unfinished spans pollute trace data
4. **Use timers for duration** - More accurate than manual start/end
5. **Check alerts regularly** - Call `checkAlerts()` in health checks
6. **Clean up old data** - Run periodic cleanup to manage database size

---

## Error Handling

- Monitoring services never throw - failures are logged and degraded gracefully
- Missing metrics return empty arrays, not errors
- Invalid spans are logged but don't break traces
- Alert check failures don't block health checks

---

## Testing

Run monitoring-specific tests:

```bash
pnpm --filter desktop test:monitoring
```

Verify instrumentation:
1. Start app in dev mode
2. Trigger import
3. Check DevTools console for metric/trace logs
4. Query metrics via IPC: `window.electron.monitoring.metrics.summary()`
