# AU ARCHIVE — COMPREHENSIVE MONITORING & AUDIT STRATEGY

**Think Bigger: Production-Grade Observability for Complex Import Pipeline**

---

## 🎯 MONITORING PHILOSOPHY

**Core Principle**: Every operation should be:
1. **Observable** — Know what's happening in real-time
2. **Auditable** — Reconstruct what happened historically  
3. **Debuggable** — Diagnose failures without reproduction
4. **Measurable** — Quantify performance and reliability
5. **Alertable** — Know when things break before users complain

---

## 📊 TELEMETRY LAYERS

### Layer 1: Structured Logging
**Purpose**: Comprehensive event stream for debugging and audit trails

```typescript
// src/services/logging/Logger.ts
import winston from 'winston';
import path from 'path';

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace',
}

export interface LogContext {
  // Import identifiers
  importSessionId?: string;
  assetId?: string;
  locationId?: string;
  
  // Job identifiers
  jobId?: string;
  jobType?: string;
  
  // File identifiers
  sourcePath?: string;
  archivePath?: string;
  hash?: string;
  
  // Performance
  duration?: number;
  bytesProcessed?: number;
  
  // Error context
  errorCode?: string;
  stackTrace?: string;
  
  // User context
  userId?: string;
}

export class StructuredLogger {
  private logger: winston.Logger;
  
  constructor(component: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { component },
      transports: [
        // JSON logs for parsing/searching
        new winston.transports.File({
          filename: path.join(app.getPath('logs'), 'import-system.log'),
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 10, // Keep 10 files = ~500MB total
        }),
        // Error-only log
        new winston.transports.File({
          filename: path.join(app.getPath('logs'), 'errors.log'),
          level: 'error',
        }),
        // Console for development
        new winston.transports.Console({
          format: winston.format.simple(),
        }),
      ],
    });
  }
  
  info(message: string, context?: LogContext) {
    this.logger.info(message, context);
  }
  
  error(message: string, error: Error, context?: LogContext) {
    this.logger.error(message, {
      ...context,
      error: error.message,
      stack: error.stack,
    });
  }
  
  // Add span tracking for operations
  startSpan(operation: string, context?: LogContext) {
    const spanId = crypto.randomUUID();
    const startTime = Date.now();
    
    this.logger.debug(`${operation}.start`, {
      ...context,
      spanId,
      timestamp: startTime,
    });
    
    return {
      spanId,
      end: (result?: 'success' | 'error', additionalContext?: LogContext) => {
        const duration = Date.now() - startTime;
        this.logger.info(`${operation}.end`, {
          ...context,
          ...additionalContext,
          spanId,
          duration,
          result,
        });
      },
    };
  }
}
```

**Log Schema Examples**:

```json
// Import started
{
  "timestamp": "2025-12-05T10:30:00.000Z",
  "level": "info",
  "component": "ImportOrchestrator",
  "message": "import.started",
  "importSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "locationId": "essexcountyj-7cdf2623",
  "sourcePath": "/Volumes/Camera/DCIM",
  "estimatedFiles": 847,
  "estimatedBytes": 2834606800,
  "strategy": "hardlink"
}

// File hashed
{
  "timestamp": "2025-12-05T10:30:15.234Z",
  "level": "info",
  "component": "Hasher",
  "message": "file.hashed",
  "importSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "assetId": "123",
  "sourcePath": "/Volumes/Camera/DCIM/_DSC1234.NEF",
  "hash": "abc123def456...",
  "duration": 234,
  "bytesProcessed": 28346068
}

// Error during copy
{
  "timestamp": "2025-12-05T10:32:45.678Z",
  "level": "error",
  "component": "Copier",
  "message": "file.copy.failed",
  "importSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "assetId": "456",
  "sourcePath": "/Volumes/Camera/DCIM/_DSC5678.NEF",
  "archivePath": "/archive/locations/.../abc789.nef",
  "error": "ENOSPC: no space left on device",
  "errorCode": "DISK_FULL",
  "stack": "..."
}
```

---

### Layer 2: Metrics Collection
**Purpose**: Time-series data for performance monitoring and alerting

```typescript
// src/services/monitoring/Metrics.ts
import { EventEmitter } from 'events';

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags: Record<string, string>;
}

export class MetricsCollector extends EventEmitter {
  private metrics: Metric[] = [];
  private flushInterval: NodeJS.Timeout;
  
  constructor() {
    super();
    // Flush to disk every 60 seconds
    this.flushInterval = setInterval(() => this.flush(), 60000);
  }
  
  // Counter: monotonically increasing
  incrementCounter(name: string, value = 1, tags: Record<string, string> = {}) {
    this.record(name, value, tags);
  }
  
  // Gauge: current value at a point in time
  gauge(name: string, value: number, tags: Record<string, string> = {}) {
    this.record(name, value, tags);
  }
  
  // Histogram: distribution of values (we'll compute percentiles)
  histogram(name: string, value: number, tags: Record<string, string> = {}) {
    this.record(name, value, tags);
  }
  
  // Timer: measure duration
  timer(name: string, tags: Record<string, string> = {}) {
    const start = Date.now();
    return {
      end: () => {
        const duration = Date.now() - start;
        this.histogram(`${name}.duration`, duration, tags);
      },
    };
  }
  
  private record(name: string, value: number, tags: Record<string, string>) {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      tags,
    });
    
    // Emit for real-time subscribers
    this.emit('metric', { name, value, tags });
  }
  
  private async flush() {
    if (this.metrics.length === 0) return;
    
    // Write to SQLite metrics table
    await db.execute(`
      INSERT INTO metrics (name, value, timestamp, tags)
      VALUES ${this.metrics.map(() => '(?, ?, ?, ?)').join(', ')}
    `, this.metrics.flatMap(m => [
      m.name,
      m.value,
      m.timestamp,
      JSON.stringify(m.tags)
    ]));
    
    this.metrics = [];
  }
}

// Usage in code:
const metrics = new MetricsCollector();

// Track import throughput
metrics.incrementCounter('import.files.processed', 1, { 
  location: locationId,
  type: 'image' 
});

// Track file size distribution
metrics.histogram('import.file.size', fileSizeBytes, { 
  extension: '.nef' 
});

// Track operation timing
const timer = metrics.timer('import.hash.duration', { algorithm: 'blake3' });
await hashFile(path);
timer.end();

// Track queue depth
metrics.gauge('jobs.queue.depth', queueSize, { queue: 'thumbnails' });
```

**Key Metrics to Track**:

```typescript
// Import pipeline metrics
'import.started'                    // Counter
'import.completed'                  // Counter  
'import.failed'                     // Counter
'import.files.scanned'              // Counter
'import.files.processed'            // Counter
'import.files.duplicates'           // Counter
'import.bytes.processed'            // Counter
'import.duration'                   // Histogram
'import.throughput.mbps'            // Gauge

// Per-step metrics
'import.scan.duration'              // Histogram
'import.hash.duration'              // Histogram
'import.copy.duration'              // Histogram
'import.validate.duration'          // Histogram

// File operation metrics
'file.hash.duration'                // Histogram (per file)
'file.copy.duration'                // Histogram (per file)
'file.size'                         // Histogram
'file.copy.strategy'                // Counter (tags: hardlink/reflink/copy)

// Job queue metrics
'jobs.enqueued'                     // Counter (tags: queue)
'jobs.completed'                    // Counter (tags: queue, status)
'jobs.failed'                       // Counter (tags: queue, reason)
'jobs.retry'                        // Counter (tags: queue)
'jobs.duration'                     // Histogram (tags: queue, type)
'jobs.queue.depth'                  // Gauge (tags: queue)
'jobs.queue.oldest'                 // Gauge (age of oldest job)

// Resource metrics
'system.cpu.percent'                // Gauge
'system.memory.used'                // Gauge
'system.disk.free'                  // Gauge
'workers.active'                    // Gauge (tags: pool)
'workers.idle'                      // Gauge (tags: pool)

// Error metrics
'errors.count'                      // Counter (tags: component, type)
'errors.disk_full'                  // Counter
'errors.permission_denied'          // Counter
'errors.hash_mismatch'              // Counter
```

---

### Layer 3: Trace Collection
**Purpose**: Distributed tracing for multi-step operations

```typescript
// src/services/monitoring/Tracer.ts
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startTime: number;
  endTime?: number;
  tags: Record<string, any>;
  logs: Array<{ timestamp: number; message: string; fields: any }>;
}

export class Tracer {
  private spans: Map<string, Span> = new Map();
  
  startSpan(operation: string, parentSpan?: Span): Span {
    const span: Span = {
      traceId: parentSpan?.traceId || crypto.randomUUID(),
      spanId: crypto.randomUUID(),
      parentSpanId: parentSpan?.spanId,
      operation,
      startTime: Date.now(),
      tags: {},
      logs: [],
    };
    
    this.spans.set(span.spanId, span);
    return span;
  }
  
  endSpan(span: Span, tags?: Record<string, any>) {
    span.endTime = Date.now();
    if (tags) {
      span.tags = { ...span.tags, ...tags };
    }
    
    // Persist to database
    this.persistSpan(span);
  }
  
  logToSpan(span: Span, message: string, fields?: any) {
    span.logs.push({
      timestamp: Date.now(),
      message,
      fields: fields || {},
    });
  }
  
  // Example: trace entire import
  async traceImport(importSessionId: string, fn: (span: Span) => Promise<void>) {
    const span = this.startSpan('import.session', null);
    span.tags.importSessionId = importSessionId;
    
    try {
      await fn(span);
      this.endSpan(span, { status: 'success' });
    } catch (error) {
      this.logToSpan(span, 'Import failed', { error: error.message });
      this.endSpan(span, { status: 'error' });
      throw error;
    }
  }
  
  private async persistSpan(span: Span) {
    await db.execute(`
      INSERT INTO traces (trace_id, span_id, parent_span_id, operation, 
                         start_time, end_time, duration, tags, logs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      span.traceId,
      span.spanId,
      span.parentSpanId,
      span.operation,
      span.startTime,
      span.endTime,
      span.endTime ? span.endTime - span.startTime : null,
      JSON.stringify(span.tags),
      JSON.stringify(span.logs),
    ]);
  }
}

// Usage: Trace an entire import with nested operations
const tracer = new Tracer();

await tracer.traceImport(importSessionId, async (importSpan) => {
  // Step 1: Scan
  const scanSpan = tracer.startSpan('import.scan', importSpan);
  const files = await scanner.scan(sourcePath);
  tracer.endSpan(scanSpan, { fileCount: files.length });
  
  // Step 2: Hash
  const hashSpan = tracer.startSpan('import.hash', importSpan);
  for (const file of files) {
    const fileHashSpan = tracer.startSpan('file.hash', hashSpan);
    fileHashSpan.tags.path = file.path;
    const hash = await hasher.hash(file);
    tracer.endSpan(fileHashSpan, { hash });
  }
  tracer.endSpan(hashSpan);
  
  // ... etc
});
```

**Trace Visualization**: Build a simple UI to view traces like Jaeger/Zipkin:

```
Import Session: 550e8400-e29b-41d4-a716-446655440000 (45.2s total)
│
├─ import.scan (2.3s)
│  └─ fs.readdir (1.8s)
│
├─ import.hash (15.7s)
│  ├─ file.hash: _DSC1234.NEF (0.234s)
│  ├─ file.hash: _DSC1235.NEF (0.241s)
│  └─ ... (847 files)
│
├─ import.copy (18.5s)
│  ├─ file.copy: _DSC1234.NEF (0.021s) [hardlink]
│  └─ ...
│
├─ import.validate (6.8s)
└─ import.finalize (1.9s)
```

---

### Layer 4: Health Checks
**Purpose**: Real-time system health monitoring

```typescript
// src/services/monitoring/HealthCheck.ts
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    [key: string]: {
      status: 'ok' | 'warn' | 'error';
      message: string;
      lastCheck: number;
      details?: any;
    };
  };
}

export class HealthChecker {
  async getHealth(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkDiskSpace(),
      this.checkJobQueue(),
      this.checkWorkerPool(),
      this.checkFileSystem(),
    ]);
    
    const health: HealthStatus = {
      status: 'healthy',
      checks: {},
    };
    
    for (const check of checks) {
      health.checks[check.name] = check;
      
      if (check.status === 'error') {
        health.status = 'unhealthy';
      } else if (check.status === 'warn' && health.status === 'healthy') {
        health.status = 'degraded';
      }
    }
    
    return health;
  }
  
  private async checkDatabase() {
    try {
      await db.execute('SELECT 1');
      return {
        name: 'database',
        status: 'ok' as const,
        message: 'Database responsive',
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'error' as const,
        message: `Database error: ${error.message}`,
        lastCheck: Date.now(),
      };
    }
  }
  
  private async checkDiskSpace() {
    const archivePath = config.get('archivePath');
    const stats = await fs.statfs(archivePath);
    const freeGB = (stats.bfree * stats.bsize) / 1024 / 1024 / 1024;
    const totalGB = (stats.blocks * stats.bsize) / 1024 / 1024 / 1024;
    const percentFree = (freeGB / totalGB) * 100;
    
    if (percentFree < 5) {
      return {
        name: 'disk_space',
        status: 'error' as const,
        message: `Critical: Only ${freeGB.toFixed(1)}GB free`,
        lastCheck: Date.now(),
        details: { freeGB, totalGB, percentFree },
      };
    } else if (percentFree < 15) {
      return {
        name: 'disk_space',
        status: 'warn' as const,
        message: `Warning: ${freeGB.toFixed(1)}GB free (${percentFree.toFixed(1)}%)`,
        lastCheck: Date.now(),
        details: { freeGB, totalGB, percentFree },
      };
    } else {
      return {
        name: 'disk_space',
        status: 'ok' as const,
        message: `${freeGB.toFixed(1)}GB free (${percentFree.toFixed(1)}%)`,
        lastCheck: Date.now(),
        details: { freeGB, totalGB, percentFree },
      };
    }
  }
  
  private async checkJobQueue() {
    const stats = await jobQueue.getStats();
    const oldestJobAge = stats.oldestJobTimestamp 
      ? Date.now() - stats.oldestJobTimestamp 
      : 0;
    
    // Alert if jobs stuck for >1 hour
    if (oldestJobAge > 3600000) {
      return {
        name: 'job_queue',
        status: 'warn' as const,
        message: `Oldest job is ${(oldestJobAge / 1000 / 60).toFixed(0)}min old`,
        lastCheck: Date.now(),
        details: stats,
      };
    }
    
    return {
      name: 'job_queue',
      status: 'ok' as const,
      message: `${stats.pending} pending, ${stats.active} active`,
      lastCheck: Date.now(),
      details: stats,
    };
  }
  
  private async checkWorkerPool() {
    const pools = [workerPool, videoWorkerPool];
    let totalActive = 0;
    let totalIdle = 0;
    
    for (const pool of pools) {
      const stats = pool.getStats();
      totalActive += stats.active;
      totalIdle += stats.idle;
    }
    
    return {
      name: 'worker_pool',
      status: 'ok' as const,
      message: `${totalActive} active, ${totalIdle} idle`,
      lastCheck: Date.now(),
      details: { active: totalActive, idle: totalIdle },
    };
  }
  
  private async checkFileSystem() {
    try {
      const archivePath = config.get('archivePath');
      const testFile = path.join(archivePath, '.health-check');
      
      await fs.writeFile(testFile, 'health check');
      await fs.unlink(testFile);
      
      return {
        name: 'filesystem',
        status: 'ok' as const,
        message: 'Archive filesystem writable',
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        name: 'filesystem',
        status: 'error' as const,
        message: `Archive not writable: ${error.message}`,
        lastCheck: Date.now(),
      };
    }
  }
}

// Expose health check endpoint
ipcMain.handle('system:health', async () => {
  return await healthChecker.getHealth();
});

// Run periodic health checks
setInterval(async () => {
  const health = await healthChecker.getHealth();
  
  if (health.status !== 'healthy') {
    logger.warn('System health degraded', { health });
    
    // Optionally notify user
    mainWindow.webContents.send('system:health-alert', health);
  }
}, 60000); // Check every minute
```

---

## 🗄️ DATABASE SCHEMA FOR OBSERVABILITY

```sql
-- Structured logs table (ring buffer, keep last 30 days)
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT, -- JSON
  
  -- Indexes for common queries
  INDEX idx_logs_timestamp (timestamp),
  INDEX idx_logs_component (component),
  INDEX idx_logs_level (level)
);

-- Metrics table (time-series data)
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  tags TEXT, -- JSON
  
  INDEX idx_metrics_name_timestamp (name, timestamp),
  INDEX idx_metrics_timestamp (timestamp)
);

-- Traces table (distributed tracing)
CREATE TABLE traces (
  trace_id TEXT NOT NULL,
  span_id TEXT PRIMARY KEY,
  parent_span_id TEXT,
  operation TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration INTEGER,
  tags TEXT, -- JSON
  logs TEXT, -- JSON array of log entries
  
  INDEX idx_traces_trace_id (trace_id),
  INDEX idx_traces_operation (operation),
  INDEX idx_traces_start_time (start_time)
);

-- Import session audit trail
CREATE TABLE import_sessions (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  user_id TEXT,
  source_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL, -- 'in_progress', 'completed', 'failed', 'cancelled'
  
  -- Counts
  files_scanned INTEGER DEFAULT 0,
  files_imported INTEGER DEFAULT 0,
  files_duplicate INTEGER DEFAULT 0,
  files_failed INTEGER DEFAULT 0,
  bytes_processed INTEGER DEFAULT 0,
  
  -- Strategy
  copy_strategy TEXT, -- 'hardlink', 'reflink', 'copy'
  
  -- Timing
  scan_duration INTEGER,
  hash_duration INTEGER,
  copy_duration INTEGER,
  validate_duration INTEGER,
  total_duration INTEGER,
  
  -- Error tracking
  error_summary TEXT, -- JSON array of errors
  
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

-- Per-asset audit trail
CREATE TABLE asset_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'created', 'hashed', 'copied', 'validated', 'metadata_extracted', etc.
  status TEXT NOT NULL, -- 'success', 'error', 'skipped'
  details TEXT, -- JSON
  
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  INDEX idx_asset_audit_asset_id (asset_id),
  INDEX idx_asset_audit_timestamp (timestamp)
);

-- Job execution audit
CREATE TABLE job_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  asset_id INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL, -- 'success', 'error', 'timeout'
  attempt INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  duration INTEGER,
  
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  INDEX idx_job_audit_job_id (job_id),
  INDEX idx_job_audit_asset_id (asset_id),
  INDEX idx_job_audit_started_at (started_at)
);

-- System health snapshots
CREATE TABLE health_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'healthy', 'degraded', 'unhealthy'
  checks TEXT NOT NULL, -- JSON
  
  INDEX idx_health_timestamp (timestamp)
);

-- Performance benchmarks (for regression testing)
CREATE TABLE benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  version TEXT NOT NULL, -- App version
  operation TEXT NOT NULL, -- 'import_1000_files', 'hash_100mb', etc.
  duration INTEGER NOT NULL,
  throughput REAL, -- MB/s or files/s
  details TEXT, -- JSON
  
  INDEX idx_benchmarks_operation (operation),
  INDEX idx_benchmarks_timestamp (timestamp)
);
```

---

## 📈 DASHBOARD & REPORTING

### Real-Time Monitoring Dashboard

```typescript
// src/ui/components/MonitoringDashboard.tsx
export function MonitoringDashboard() {
  const [health, setHealth] = useState<HealthStatus>();
  const [metrics, setMetrics] = useState<MetricsSummary>();
  const [activeImports, setActiveImports] = useState<ImportSession[]>([]);
  const [jobStats, setJobStats] = useState<JobQueueStats>();
  
  useEffect(() => {
    // Subscribe to real-time updates
    const unsubscribe = window.electron.on('monitoring:update', (data) => {
      setHealth(data.health);
      setMetrics(data.metrics);
      setActiveImports(data.activeImports);
      setJobStats(data.jobStats);
    });
    
    // Poll for initial data
    refreshData();
    
    return unsubscribe;
  }, []);
  
  return (
    <div className="monitoring-dashboard">
      <HealthPanel health={health} />
      <MetricsPanel metrics={metrics} />
      <ActiveImportsPanel imports={activeImports} />
      <JobQueuePanel stats={jobStats} />
      <LogStreamPanel />
    </div>
  );
}
```

### Historical Reports

```typescript
// Generate daily report
export async function generateDailyReport(date: Date): Promise<Report> {
  const startOfDay = startOfDayTimestamp(date);
  const endOfDay = endOfDayTimestamp(date);
  
  return {
    date,
    
    imports: {
      total: await db.get(`
        SELECT COUNT(*) as count FROM import_sessions
        WHERE started_at >= ? AND started_at < ?
      `, [startOfDay, endOfDay]),
      
      successful: await db.get(`
        SELECT COUNT(*) as count FROM import_sessions
        WHERE started_at >= ? AND started_at < ?
          AND status = 'completed'
      `, [startOfDay, endOfDay]),
      
      filesImported: await db.get(`
        SELECT SUM(files_imported) as count FROM import_sessions
        WHERE started_at >= ? AND started_at < ?
      `, [startOfDay, endOfDay]),
      
      bytesImported: await db.get(`
        SELECT SUM(bytes_processed) as bytes FROM import_sessions
        WHERE started_at >= ? AND started_at < ?
      `, [startOfDay, endOfDay]),
      
      averageDuration: await db.get(`
        SELECT AVG(total_duration) as avg FROM import_sessions
        WHERE started_at >= ? AND started_at < ?
          AND status = 'completed'
      `, [startOfDay, endOfDay]),
    },
    
    jobs: {
      completed: await db.get(`
        SELECT COUNT(*) as count FROM job_audit_log
        WHERE started_at >= ? AND started_at < ?
          AND status = 'success'
      `, [startOfDay, endOfDay]),
      
      failed: await db.get(`
        SELECT COUNT(*) as count FROM job_audit_log
        WHERE started_at >= ? AND started_at < ?
          AND status = 'error'
      `, [startOfDay, endOfDay]),
      
      averageDuration: await db.get(`
        SELECT job_type, AVG(duration) as avg_duration
        FROM job_audit_log
        WHERE started_at >= ? AND started_at < ?
          AND status = 'success'
        GROUP BY job_type
      `, [startOfDay, endOfDay]),
    },
    
    errors: {
      total: await db.get(`
        SELECT COUNT(*) as count FROM logs
        WHERE timestamp >= ? AND timestamp < ?
          AND level = 'error'
      `, [startOfDay, endOfDay]),
      
      byComponent: await db.all(`
        SELECT component, COUNT(*) as count FROM logs
        WHERE timestamp >= ? AND timestamp < ?
          AND level = 'error'
        GROUP BY component
        ORDER BY count DESC
      `, [startOfDay, endOfDay]),
    },
    
    performance: {
      hashThroughput: await calculateAverageMetric(
        'file.hash.throughput', startOfDay, endOfDay
      ),
      copyThroughput: await calculateAverageMetric(
        'file.copy.throughput', startOfDay, endOfDay
      ),
      jobQueueDepth: await calculateMaxMetric(
        'jobs.queue.depth', startOfDay, endOfDay
      ),
    },
  };
}
```

---

## 🚨 ALERTING SYSTEM

```typescript
// src/services/monitoring/AlertManager.ts
export interface AlertRule {
  id: string;
  name: string;
  condition: (metrics: Metrics) => boolean;
  severity: 'info' | 'warning' | 'critical';
  cooldown: number; // Min time between alerts (ms)
  actions: AlertAction[];
}

export type AlertAction = 
  | { type: 'notify_user'; message: string }
  | { type: 'log'; level: 'warn' | 'error' }
  | { type: 'pause_imports' }
  | { type: 'webhook'; url: string };

export class AlertManager {
  private rules: AlertRule[] = [
    {
      id: 'disk_space_critical',
      name: 'Critical Disk Space',
      condition: (m) => m.diskSpacePercent < 5,
      severity: 'critical',
      cooldown: 300000, // 5 minutes
      actions: [
        { type: 'notify_user', message: 'Critical: Disk space < 5%' },
        { type: 'pause_imports' },
        { type: 'log', level: 'error' },
      ],
    },
    {
      id: 'disk_space_low',
      name: 'Low Disk Space',
      condition: (m) => m.diskSpacePercent < 15,
      severity: 'warning',
      cooldown: 900000, // 15 minutes
      actions: [
        { type: 'notify_user', message: 'Warning: Disk space < 15%' },
        { type: 'log', level: 'warn' },
      ],
    },
    {
      id: 'job_queue_stuck',
      name: 'Job Queue Stuck',
      condition: (m) => m.oldestJobAgeMinutes > 60,
      severity: 'warning',
      cooldown: 600000, // 10 minutes
      actions: [
        { type: 'notify_user', message: 'Job stuck in queue for >1 hour' },
        { type: 'log', level: 'warn' },
      ],
    },
    {
      id: 'high_error_rate',
      name: 'High Error Rate',
      condition: (m) => m.errorRateLastHour > 10,
      severity: 'warning',
      cooldown: 600000,
      actions: [
        { type: 'notify_user', message: `High error rate: ${m.errorRateLastHour} errors/hour` },
        { type: 'log', level: 'warn' },
      ],
    },
    {
      id: 'import_stalled',
      name: 'Import Stalled',
      condition: (m) => m.activeImportWithNoProgressMinutes > 10,
      severity: 'warning',
      cooldown: 300000,
      actions: [
        { type: 'notify_user', message: 'Import appears stalled (no progress for 10min)' },
        { type: 'log', level: 'warn' },
      ],
    },
  ];
  
  private lastAlertTime: Map<string, number> = new Map();
  
  async checkAlerts(metrics: Metrics) {
    for (const rule of this.rules) {
      if (!rule.condition(metrics)) continue;
      
      // Check cooldown
      const lastAlert = this.lastAlertTime.get(rule.id) || 0;
      if (Date.now() - lastAlert < rule.cooldown) continue;
      
      // Trigger alert
      await this.triggerAlert(rule, metrics);
      this.lastAlertTime.set(rule.id, Date.now());
    }
  }
  
  private async triggerAlert(rule: AlertRule, metrics: Metrics) {
    logger.warn(`Alert triggered: ${rule.name}`, { rule, metrics });
    
    for (const action of rule.actions) {
      switch (action.type) {
        case 'notify_user':
          mainWindow?.webContents.send('alert', {
            severity: rule.severity,
            message: action.message,
          });
          break;
          
        case 'log':
          logger[action.level](`Alert: ${rule.name}`, { rule, metrics });
          break;
          
        case 'pause_imports':
          await importOrchestrator.pauseAll();
          break;
          
        case 'webhook':
          await fetch(action.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rule, metrics }),
          });
          break;
      }
    }
  }
}

// Run alert checks every 30 seconds
setInterval(async () => {
  const metrics = await metricsCollector.getCurrentMetrics();
  await alertManager.checkAlerts(metrics);
}, 30000);
```

---

## 🔍 DEBUGGING TOOLS

### Interactive Log Browser

```typescript
// src/ui/components/LogBrowser.tsx
export function LogBrowser() {
  return (
    <div>
      {/* Filters */}
      <LogFilters
        onFilter={(filters) => setFilters(filters)}
        levels={['error', 'warn', 'info', 'debug']}
        components={['Scanner', 'Hasher', 'Copier', 'JobQueue']}
      />
      
      {/* Search */}
      <LogSearch
        onSearch={(query) => setSearchQuery(query)}
        placeholder="Search logs (e.g., importSessionId:550e8400...)"
      />
      
      {/* Results */}
      <LogTable
        logs={logs}
        onLogClick={(log) => showLogDetails(log)}
      />
      
      {/* Context panel */}
      {selectedLog && (
        <LogContextPanel
          log={selectedLog}
          showBefore={5}
          showAfter={5}
        />
      )}
    </div>
  );
}
```

### Trace Visualizer

```typescript
// src/ui/components/TraceVisualizer.tsx
export function TraceVisualizer({ traceId }: { traceId: string }) {
  const [spans, setSpans] = useState<Span[]>([]);
  
  useEffect(() => {
    fetchTrace(traceId).then(setSpans);
  }, [traceId]);
  
  return (
    <div className="trace-visualizer">
      {/* Timeline view */}
      <Timeline spans={spans} />
      
      {/* Span details */}
      <SpanDetails span={selectedSpan} />
      
      {/* Flame graph */}
      <FlameGraph spans={spans} />
    </div>
  );
}
```

### Performance Profiler

```typescript
// Export performance profile for external analysis
export async function exportPerformanceProfile(
  importSessionId: string
): Promise<string> {
  const traces = await db.all(`
    SELECT * FROM traces
    WHERE tags LIKE '%"importSessionId":"${importSessionId}"%'
    ORDER BY start_time
  `);
  
  const logs = await db.all(`
    SELECT * FROM logs
    WHERE context LIKE '%"importSessionId":"${importSessionId}"%'
    ORDER BY timestamp
  `);
  
  const metrics = await db.all(`
    SELECT * FROM metrics
    WHERE timestamp >= ? AND timestamp <= ?
  `, [traces[0].start_time, traces[traces.length - 1].end_time]);
  
  // Export in Chrome DevTools format (can be loaded in chrome://tracing)
  return JSON.stringify({
    traceEvents: traces.map(spanToTraceEvent),
    metadata: {
      importSessionId,
      appVersion: app.getVersion(),
      platform: process.platform,
    },
  });
}
```

---

## 📊 QUERY EXAMPLES

```typescript
// Find slowest imports
const slowImports = await db.all(`
  SELECT id, location_id, files_imported, total_duration,
         (bytes_processed / 1024 / 1024) as mb_processed,
         (bytes_processed / total_duration * 1000 / 1024 / 1024) as mbps
  FROM import_sessions
  WHERE status = 'completed'
    AND total_duration > 60000  -- > 1 minute
  ORDER BY total_duration DESC
  LIMIT 20
`);

// Find most common errors
const errorStats = await db.all(`
  SELECT 
    json_extract(context, '$.errorCode') as error_code,
    component,
    COUNT(*) as count,
    MAX(timestamp) as last_seen
  FROM logs
  WHERE level = 'error'
    AND timestamp > ?  -- Last 7 days
  GROUP BY error_code, component
  ORDER BY count DESC
`);

// Analyze hash performance over time
const hashPerformance = await db.all(`
  SELECT 
    DATE(timestamp / 1000, 'unixepoch') as date,
    AVG(value) as avg_duration,
    MIN(value) as min_duration,
    MAX(value) as max_duration,
    COUNT(*) as samples
  FROM metrics
  WHERE name = 'file.hash.duration'
    AND timestamp > ?  -- Last 30 days
  GROUP BY date
  ORDER BY date DESC
`);

// Find assets with failed jobs
const failedAssets = await db.all(`
  SELECT 
    a.id,
    a.original_name,
    a.source_path,
    jal.job_type,
    jal.error_message,
    jal.attempt,
    jal.started_at
  FROM assets a
  JOIN job_audit_log jal ON a.id = jal.asset_id
  WHERE jal.status = 'error'
    AND jal.attempt >= 3  -- Failed all retries
  ORDER BY jal.started_at DESC
`);

// Calculate percentile latencies
const hashLatencyPercentiles = await db.all(`
  WITH sorted AS (
    SELECT value,
           ROW_NUMBER() OVER (ORDER BY value) as row_num,
           COUNT(*) OVER () as total
    FROM metrics
    WHERE name = 'file.hash.duration'
      AND timestamp > ?  -- Last 24 hours
  )
  SELECT
    MAX(CASE WHEN row_num = CAST(total * 0.50 AS INT) THEN value END) as p50,
    MAX(CASE WHEN row_num = CAST(total * 0.90 AS INT) THEN value END) as p90,
    MAX(CASE WHEN row_num = CAST(total * 0.95 AS INT) THEN value END) as p95,
    MAX(CASE WHEN row_num = CAST(total * 0.99 AS INT) THEN value END) as p99
  FROM sorted
`);
```

---

## 🧪 TESTING OBSERVABILITY

```typescript
// Test that logging works
describe('StructuredLogger', () => {
  it('should log with context', () => {
    logger.info('test message', { importSessionId: '123' });
    
    const logs = readLastNLogs(1);
    expect(logs[0].message).toBe('test message');
    expect(logs[0].context.importSessionId).toBe('123');
  });
});

// Test that metrics are recorded
describe('MetricsCollector', () => {
  it('should record counter', () => {
    metrics.incrementCounter('test.counter', 1);
    
    const recorded = metrics.getMetric('test.counter');
    expect(recorded.value).toBe(1);
  });
});

// Test that traces are created
describe('Tracer', () => {
  it('should create parent-child span relationship', () => {
    const parent = tracer.startSpan('parent');
    const child = tracer.startSpan('child', parent);
    
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.traceId).toBe(parent.traceId);
  });
});

// Test that alerts fire
describe('AlertManager', () => {
  it('should trigger alert on low disk space', async () => {
    const mockMetrics = { diskSpacePercent: 3 };
    
    await alertManager.checkAlerts(mockMetrics);
    
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        message: expect.stringContaining('Disk space'),
      })
    );
  });
});
```

---

## 📝 SUMMARY: YOUR COMPLETE MONITORING STACK

### What You Get:

1. **Structured Logging** — Searchable, parseable event stream
2. **Metrics** — Time-series performance data  
3. **Tracing** — Request-scoped distributed tracing
4. **Health Checks** — Real-time system health status
5. **Alerts** — Proactive problem detection
6. **Dashboards** — Real-time and historical views
7. **Debugging Tools** — Log browser, trace visualizer, profiler
8. **Audit Trail** — Complete history of every operation
9. **Reports** — Daily/weekly summaries
10. **Performance Baselines** — Regression testing over time

### Next Steps:

1. **Implement foundational services** (Logger, Metrics, Tracer)
2. **Instrument your code** (add logging/metrics/spans everywhere)
3. **Set up database schema** (tables for logs, metrics, traces)
4. **Build dashboards** (real-time monitoring UI)
5. **Configure alerts** (define thresholds and actions)
6. **Write tests** (verify observability works)
7. **Export to external tools** (optional: send to Grafana, Prometheus, etc.)

---

**Now you can audit and monitor EVERYTHING.** 🎯
