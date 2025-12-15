# 🔍 MONITORING & DEBUGGING INTEGRATION GUIDE

**Quick reference for adding comprehensive monitoring to AU Archive**

---

## 🚀 QUICK START (5 minutes)

### Step 1: Add the File Operation Monitor

```bash
# Copy the file-ops-monitor.js to your project
cp file-ops-monitor.js packages/desktop/scripts/

# Test it immediately
node packages/desktop/scripts/file-ops-monitor.js check /path/to/file1 /path/to/file2
```

### Step 2: Test Your Copy Strategy Right Now

```bash
# Create a test file
echo "test content" > /tmp/test-source.txt

# Test all strategies
node packages/desktop/scripts/file-ops-monitor.js test-all \
  /tmp/test-source.txt \
  /tmp/test-dest.txt

# Output will show:
# ✅ Hardlink: 2ms (if same device)
# ❌ Reflink: Failed (if not APFS)
# ✅ Copy: 145ms
```

### Step 3: Check Your Actual Paths

```bash
# Find out if your source and archive are on the same device
node packages/desktop/scripts/file-ops-monitor.js device \
  /Volumes/Camera/DCIM \
  /Users/you/Documents/au-archive

# Output:
# 📊 Device Check:
#   /Volumes/Camera/DCIM → device 16777220
#   /Users/you/Documents/au-archive → device 16777220
#   Same device: ✅ YES  (hardlink will work!)
# 
# OR:
#   Same device: ❌ NO   (will need to copy)
```

---

## 🔧 INTEGRATION INTO YOUR APP

### Option 1: Drop-In Import Tracer (Recommended)

Wrap your existing import code with the tracer:

```typescript
// In your ImportOrchestrator.ts or similar
import { ImportTracer } from './utils/import-tracer';

export class ImportOrchestrator {
  async importFiles(sourcePath: string, locationId: string) {
    // Create tracer for this import session
    const tracer = new ImportTracer(importSessionId, {
      logToConsole: true,
      logToFile: path.join(app.getPath('logs'), 'import-trace.log'),
    });
    
    // Listen to events for UI updates
    tracer.on('progress', (progress) => {
      mainWindow.webContents.send('import:progress', progress);
    });
    
    tracer.on('file:error', (error) => {
      logger.error('Import file error', error);
    });
    
    try {
      // SCAN PHASE
      tracer.startPhase('scan', { sourcePath });
      
      const files = await this.scanDirectory(sourcePath);
      
      for (let i = 0; i < files.length; i++) {
        await tracer.traceFile(files[i].path, async () => {
          // Your existing scan logic
          await this.processFileMetadata(files[i]);
        });
        
        tracer.updateProgress(i + 1, files.length, 'scan');
      }
      
      tracer.endPhase();
      
      // COPY PHASE
      tracer.startPhase('copy');
      
      for (const file of files) {
        // Determine strategy ONCE at the beginning
        const strategy = await tracer.traceCopyStrategy(
          file.sourcePath,
          file.archivePath
        );
        
        // Trace the actual copy
        await tracer.traceFile(file.sourcePath, async () => {
          // Your existing copy logic
          if (strategy === 'hardlink') {
            await fs.link(file.sourcePath, file.archivePath);
          } else {
            await fs.copyFile(file.sourcePath, file.archivePath);
          }
        }, { strategy });
        
        // Verify hardlinks actually worked
        if (strategy === 'hardlink') {
          const isHardlinked = await tracer.verifyHardlink(
            file.sourcePath,
            file.archivePath
          );
          
          if (!isHardlinked) {
            logger.warn('Hardlink verification failed, file was copied instead', {
              file: file.sourcePath,
            });
          }
        }
      }
      
      tracer.endPhase();
      
      // Print report to logs
      tracer.printReport();
      
      // Save detailed JSON for analysis
      await tracer.saveReport(
        path.join(app.getPath('logs'), `import-${importSessionId}.json`)
      );
      
      return tracer.getStats();
      
    } catch (error) {
      logger.error('Import failed', error);
      tracer.printReport(); // Show report even on failure
      throw error;
    }
  }
}
```

### Option 2: Full Observability Stack

For production-grade monitoring, implement the full stack from the monitoring strategy:

```typescript
// 1. Add structured logging
import { StructuredLogger } from './services/monitoring/Logger';
const logger = new StructuredLogger('ImportOrchestrator');

// 2. Add metrics
import { MetricsCollector } from './services/monitoring/Metrics';
const metrics = new MetricsCollector();

// 3. Add tracing
import { Tracer } from './services/monitoring/Tracer';
const tracer = new Tracer();

// Then in your import code:
export class ImportOrchestrator {
  async importFiles(sourcePath: string, locationId: string) {
    const importSessionId = crypto.randomUUID();
    
    // Start trace
    await tracer.traceImport(importSessionId, async (span) => {
      // Log structured event
      logger.info('import.started', {
        importSessionId,
        locationId,
        sourcePath,
      });
      
      // Start metrics timer
      const importTimer = metrics.timer('import.duration', {
        location: locationId,
      });
      
      try {
        // Your import logic with instrumentation
        const files = await this.scanFiles(sourcePath, span);
        
        metrics.gauge('import.files.scanned', files.length, {
          location: locationId,
        });
        
        await this.hashFiles(files, span);
        await this.copyFiles(files, span);
        await this.validateFiles(files, span);
        
        importTimer.end();
        
        logger.info('import.completed', {
          importSessionId,
          filesImported: files.length,
        });
        
        metrics.incrementCounter('import.completed', 1, {
          location: locationId,
        });
        
      } catch (error) {
        importTimer.end();
        
        logger.error('import.failed', error, {
          importSessionId,
          locationId,
        });
        
        metrics.incrementCounter('import.failed', 1, {
          location: locationId,
          error: error.message,
        });
        
        throw error;
      }
    });
  }
  
  private async copyFiles(files: File[], parentSpan: Span) {
    const copySpan = tracer.startSpan('import.copy', parentSpan);
    
    for (const file of files) {
      const fileSpan = tracer.startSpan('file.copy', copySpan);
      fileSpan.tags.path = file.sourcePath;
      
      const timer = metrics.timer('file.copy.duration');
      
      try {
        // Determine strategy
        const strategy = await this.determineCopyStrategy(
          file.sourcePath,
          file.archivePath
        );
        
        fileSpan.tags.strategy = strategy;
        
        // Execute copy
        if (strategy === 'hardlink') {
          await fs.link(file.sourcePath, file.archivePath);
        } else {
          await fs.copyFile(file.sourcePath, file.archivePath);
        }
        
        timer.end();
        
        metrics.incrementCounter('file.copy.success', 1, {
          strategy,
          extension: path.extname(file.sourcePath),
        });
        
        tracer.endSpan(fileSpan, { status: 'success' });
        
      } catch (error) {
        timer.end();
        
        tracer.logToSpan(fileSpan, 'Copy failed', {
          error: error.message,
        });
        
        tracer.endSpan(fileSpan, { status: 'error' });
        
        metrics.incrementCounter('file.copy.error', 1, {
          error: error.code,
        });
        
        throw error;
      }
    }
    
    tracer.endSpan(copySpan);
  }
}
```

---

## 🎯 DEBUGGING SPECIFIC ISSUES

### Issue: "Are my files being hardlinked or copied?"

**Quick Check:**
```bash
# After import, check any two files
node scripts/file-ops-monitor.js check \
  /Volumes/Camera/IMG_1234.jpg \
  /archive/locations/.../abc123.jpg

# Output tells you immediately:
# ✅ Hardlinked (same inode)
# OR
# ❌ Separate copies (different inodes)
```

**Detailed Analysis:**
```bash
# Compare file stats side-by-side
node scripts/file-ops-monitor.js compare \
  /Volumes/Camera/IMG_1234.jpg \
  /archive/locations/.../abc123.jpg

# Output shows:
# ┌─────────────────────────────────────────┐
# │ Attribute  │ File 1    │ File 2    │ ✅  │
# ├─────────────────────────────────────────┤
# │ Inode      │ 12345     │ 12345     │ ✅  │  ← SAME = hardlinked
# │ Device     │ 16777220  │ 16777220  │ ✅  │
# └─────────────────────────────────────────┘
```

### Issue: "Import is slow, which operation is the bottleneck?"

**Add timing to every step:**
```typescript
import { ImportTracer } from './utils/import-tracer';

const tracer = new ImportTracer(sessionId);

// Measure each phase
tracer.startPhase('scan');
// ... scan files
tracer.endPhase(); // Shows: "scan: 2.3s"

tracer.startPhase('hash');
// ... hash files
tracer.endPhase(); // Shows: "hash: 15.7s"

tracer.startPhase('copy');
// ... copy files
tracer.endPhase(); // Shows: "copy: 45.2s" ← BOTTLENECK!

// Print detailed report
tracer.printReport();
// Shows slowest files, throughput, etc.
```

### Issue: "Some files failing to copy"

**Capture detailed error context:**
```typescript
tracer.on('file:error', (error) => {
  console.log('File failed:', {
    path: error.filePath,
    error: error.error,
    stack: error.stack,
    size: error.size,
    duration: error.duration,
  });
  
  // Log to database for analysis
  db.execute(`
    INSERT INTO import_errors (session_id, file_path, error, timestamp)
    VALUES (?, ?, ?, ?)
  `, [sessionId, error.filePath, error.error, Date.now()]);
});
```

### Issue: "Need to verify hardlinks worked"

**Automatic verification:**
```typescript
// After each copy operation
if (copyStrategy === 'hardlink') {
  const verified = await tracer.verifyHardlink(sourcePath, destPath);
  
  if (!verified) {
    logger.error('Hardlink verification failed', {
      source: sourcePath,
      dest: destPath,
      expectedStrategy: 'hardlink',
      actualResult: 'copy',
    });
    
    // Could indicate:
    // - Different devices (shouldn't happen if strategy check worked)
    // - Permissions issue
    // - Filesystem doesn't support hardlinks
  }
}
```

---

## 📊 REAL-TIME MONITORING UI

### Add Live Progress to Your Renderer

```typescript
// In your React component
import { useEffect, useState } from 'react';

export function ImportProgress({ sessionId }: { sessionId: string }) {
  const [progress, setProgress] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  
  useEffect(() => {
    // Listen to progress events from tracer
    const unsubscribe = window.electron.on('import:progress', (data) => {
      setProgress(data);
    });
    
    const unsubscribeStats = window.electron.on('import:stats', (data) => {
      setStats(data);
    });
    
    return () => {
      unsubscribe();
      unsubscribeStats();
    };
  }, []);
  
  if (!progress) return null;
  
  return (
    <div className="import-progress">
      <h3>Importing to {progress.location}</h3>
      
      {/* Progress bar */}
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      
      {/* Current phase */}
      <div className="phase">
        {progress.phase === 'scan' && '🔍 Scanning files...'}
        {progress.phase === 'hash' && '🔐 Hashing files...'}
        {progress.phase === 'copy' && '📋 Copying files...'}
        {progress.phase === 'validate' && '✅ Validating...'}
      </div>
      
      {/* Stats */}
      <div className="stats">
        <div>Files: {progress.current} / {progress.total}</div>
        <div>Speed: {progress.rate} files/s</div>
        <div>ETA: {progress.eta}s</div>
      </div>
      
      {/* Strategy indicator */}
      {stats?.copyStrategy && (
        <div className="strategy">
          Using: {stats.copyStrategy}
          {stats.copyStrategy === 'hardlink' && ' ⚡ (instant)'}
          {stats.copyStrategy === 'copy' && ' 📦 (copying data)'}
        </div>
      )}
      
      {/* Real-time throughput */}
      {stats?.currentThroughput && (
        <div className="throughput">
          {stats.currentThroughput.toFixed(2)} MB/s
        </div>
      )}
    </div>
  );
}
```

---

## 🧪 TESTING CHECKLIST

Before deploying monitoring:

```bash
# 1. Test device detection
node scripts/file-ops-monitor.js device /source /dest

# 2. Test hardlink creation
node scripts/file-ops-monitor.js test-hardlink /source/test.jpg /dest/test.jpg

# 3. Test verification
node scripts/file-ops-monitor.js check /source/test.jpg /dest/test.jpg

# 4. Test all strategies together
node scripts/file-ops-monitor.js test-all /source/test.jpg /dest/test.jpg

# 5. Run import with tracer
# (Check logs for detailed timing and strategy info)

# 6. Verify logs are being written
tail -f ~/Library/Logs/au-archive/import-trace.log

# 7. Check metrics are recorded
# (Query your metrics table in DB)
```

---

## 📈 ANALYZING RESULTS

### Query Import Performance

```sql
-- Find slowest imports
SELECT 
  id,
  location_id,
  files_imported,
  copy_strategy,
  total_duration,
  (bytes_processed / total_duration * 1000 / 1024 / 1024) as mbps
FROM import_sessions
WHERE total_duration > 60000
ORDER BY total_duration DESC
LIMIT 10;

-- Compare hardlink vs copy performance
SELECT 
  copy_strategy,
  COUNT(*) as imports,
  AVG(total_duration) as avg_duration,
  AVG(files_imported) as avg_files,
  AVG(bytes_processed / total_duration * 1000 / 1024 / 1024) as avg_mbps
FROM import_sessions
GROUP BY copy_strategy;

-- Find files that failed verification
SELECT *
FROM asset_audit_log
WHERE action = 'verify.hardlink'
  AND status = 'error';
```

### Review Trace Logs

```bash
# Find all hardlink operations
cat import-trace.log | grep "copy.strategy" | grep "hardlink"

# Find verification failures
cat import-trace.log | grep "verify" | grep "hardlinked\":false"

# Get timing for specific phase
cat import-trace.log | grep "phase.end" | grep "hash"
```

### Generate Report from JSON

```javascript
const report = require('./import-abc123.json');

console.log('Import Summary:');
console.log('  Total ops:', report.stats.totalOperations);
console.log('  Successful:', report.stats.successful);
console.log('  Failed:', report.stats.failed);
console.log('  Throughput:', report.stats.overallThroughput, 'MB/s');

// Find slowest operations
const slowest = report.operations
  .sort((a, b) => b.duration - a.duration)
  .slice(0, 10);

console.log('\nSlowest operations:');
slowest.forEach((op, i) => {
  console.log(`  ${i+1}. ${op.filePath}: ${op.duration}ms`);
});
```

---

## 🚨 COMMON PITFALLS

### 1. **Forgetting to check device before hardlink**

```typescript
// ❌ BAD: Assumes hardlink will work
await fs.link(source, dest); // Might fail!

// ✅ GOOD: Check first, then decide
const strategy = await determineCopyStrategy(source, dest);
if (strategy === 'hardlink') {
  await fs.link(source, dest);
} else {
  await fs.copyFile(source, dest);
}
```

### 2. **Not verifying hardlinks actually worked**

```typescript
// ❌ BAD: Trust fs.link() succeeded
await fs.link(source, dest);
// Assume it's hardlinked now

// ✅ GOOD: Verify with stat
await fs.link(source, dest);
const sourceStats = await fs.stat(source);
const destStats = await fs.stat(dest);

if (sourceStats.ino !== destStats.ino) {
  throw new Error('Hardlink failed - inodes do not match');
}
```

### 3. **Logging too much in production**

```typescript
// ❌ BAD: Log every file at info level
logger.info('Processing file', { path }); // 1000s of logs!

// ✅ GOOD: Use debug level, aggregate at info
logger.debug('Processing file', { path });
// Then at end:
logger.info('Batch complete', { filesProcessed: 1000 });
```

---

## 🎓 NEXT STEPS

1. **Start simple**: Add the file-ops-monitor.js and test your paths
2. **Integrate tracer**: Wrap your import code with ImportTracer
3. **Add to UI**: Show real-time progress from tracer events
4. **Analyze**: Use reports to find bottlenecks
5. **Optimize**: Use insights to improve performance
6. **Scale up**: Add full observability stack when ready

---

## 📚 REFERENCES

- [Main Monitoring Strategy](./AU-ARCHIVE-MONITORING-STRATEGY.md)
- [File Operations Monitor](./file-ops-monitor.js)
- [Import Tracer](./import-tracer.js)
- [Implementation Checklist](./AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md)

---

**Need help? Drop into the code and add console.logs, then graduate to structured logging when you understand the flow.**
