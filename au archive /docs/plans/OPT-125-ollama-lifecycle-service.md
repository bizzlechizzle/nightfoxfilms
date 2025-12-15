# OPT-125: Ollama Lifecycle Service

**Purpose:** Seamlessly start/stop Ollama in the background, controlled by the app.

**User Experience Goal:** Zero prompts, zero dock icons, zero manual intervention.

---

## SCOPE: WHAT WE'RE BUILDING

### YES (In Scope)
- Auto-detect Ollama binary location
- Start Ollama headlessly when extraction queue needs it
- Track whether WE started it (don't kill user's existing instance)
- Idle timeout - stop Ollama after 5 minutes of no requests
- Clean shutdown on app quit
- Orphan process cleanup on startup (if app crashed previously)
- Integration with existing ExtractionService/OllamaProvider
- Capability detection (is Ollama installed?)

### NO (Out of Scope)
- ~~Model management/pulling~~ (OllamaProvider already handles this)
- ~~Remote Ollama instances~~ (already works via host config)
- ~~UI for Ollama settings~~ (use existing extraction provider settings)
- ~~Bundling Ollama binary~~ (user installs separately)

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           APP LIFECYCLE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   app.on('ready')                                                           │
│        │                                                                    │
│        └──► cleanupOrphanOllama()     // Kill orphan from crash            │
│                                                                             │
│   app.on('before-quit')                                                     │
│        │                                                                    │
│        └──► stopOllama()              // Only if we started it             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      OLLAMA LIFECYCLE SERVICE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   findOllamaBinary()        → string | null                                 │
│   isOllamaRunning()         → Promise<boolean>                              │
│   startOllama()             → Promise<boolean>                              │
│   stopOllama()              → void                                          │
│   ensureOllamaRunning()     → Promise<boolean>    ◄── Main entry point     │
│   resetIdleTimer()          → void                                          │
│   cleanupOrphan()           → void                                          │
│   getStatus()               → OllamaLifecycleStatus                         │
│                                                                             │
│   Private State:                                                            │
│   - ollamaProcess: ChildProcess | null                                      │
│   - weStartedIt: boolean                                                    │
│   - idleTimer: NodeJS.Timeout | null                                        │
│   - pidFile: string (userData/ollama.pid)                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OLLAMA PROVIDER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Modified extract() method:                                                │
│   1. Check if host is localhost                                             │
│   2. If localhost → call ensureOllamaRunning()                              │
│   3. Proceed with extraction                                                │
│   4. Call resetIdleTimer() after completion                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## FILE STRUCTURE

```
packages/desktop/electron/services/
├── ollama-lifecycle-service.ts   ◄── NEW (primary deliverable)
├── extraction/
│   └── providers/
│       └── ollama-provider.ts    ◄── MODIFIED (integrate lifecycle)
```

---

## DETAILED DESIGN

### 1. Binary Detection

```typescript
const OLLAMA_BINARY_PATHS = [
  '/usr/local/bin/ollama',           // Homebrew Intel
  '/opt/homebrew/bin/ollama',        // Homebrew Apple Silicon
  `${process.env.HOME}/.ollama/bin/ollama`,  // Manual install
  '/usr/bin/ollama',                 // Linux system
  'C:\\Program Files\\Ollama\\ollama.exe',   // Windows
];

function findOllamaBinary(): string | null {
  // Check common paths first (fast)
  for (const path of OLLAMA_BINARY_PATHS) {
    if (existsSync(path)) return path;
  }

  // Fall back to which/where command
  try {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
```

### 2. Process Management

```typescript
async function startOllama(): Promise<boolean> {
  const binaryPath = findOllamaBinary();
  if (!binaryPath) {
    console.warn('[OllamaLifecycle] Binary not found');
    return false;
  }

  // Already running? (user instance or our instance)
  if (await isOllamaRunning()) {
    return true;
  }

  // Spawn headless - no dock icon, no console
  ollamaProcess = spawn(binaryPath, ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      OLLAMA_HOST: '127.0.0.1:11434',  // Bind to localhost only
    },
  });

  ollamaProcess.unref();  // Don't block app exit
  weStartedIt = true;
  savePid(ollamaProcess.pid);

  // Wait for startup (poll /api/tags)
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await isOllamaRunning()) {
      console.log('[OllamaLifecycle] Started successfully');
      return true;
    }
  }

  console.error('[OllamaLifecycle] Failed to start within 30s');
  return false;
}
```

### 3. Idle Timeout

```typescript
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes
let idleTimer: NodeJS.Timeout | null = null;

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);

  idleTimer = setTimeout(() => {
    if (weStartedIt) {
      console.log('[OllamaLifecycle] Idle timeout - stopping');
      stopOllama();
    }
  }, IDLE_TIMEOUT_MS);
}
```

### 4. Orphan Cleanup

```typescript
const PID_FILE = join(app.getPath('userData'), 'ollama.pid');

function cleanupOrphan(): void {
  if (!existsSync(PID_FILE)) return;

  const pid = parseInt(readFileSync(PID_FILE, 'utf8'), 10);
  if (isNaN(pid)) {
    unlinkSync(PID_FILE);
    return;
  }

  try {
    // Check if process exists
    process.kill(pid, 0);  // Signal 0 = check existence

    // Process exists - kill it
    process.kill(pid, 'SIGTERM');
    console.log(`[OllamaLifecycle] Killed orphan process ${pid}`);
  } catch {
    // Process doesn't exist - clean up PID file
  }

  unlinkSync(PID_FILE);
}
```

### 5. Graceful Shutdown

```typescript
function stopOllama(): void {
  // Only kill if WE started it
  if (!weStartedIt) {
    console.log('[OllamaLifecycle] Not our instance - skipping shutdown');
    return;
  }

  if (ollamaProcess) {
    ollamaProcess.kill('SIGTERM');
    ollamaProcess = null;
  }

  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }

  weStartedIt = false;

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  console.log('[OllamaLifecycle] Stopped');
}
```

---

## INTEGRATION POINTS

### 1. App Startup (index.ts)

```typescript
// In startupOrchestrator() - early in sequence
import { cleanupOrphanOllama } from '../services/ollama-lifecycle-service';

// Step 1.5: Clean up orphan Ollama
logger.info('Main', 'Step 1.5/6: Checking for orphan Ollama');
cleanupOrphanOllama();
```

### 2. App Shutdown (index.ts)

```typescript
// In app.on('before-quit')
import { stopOllama } from '../services/ollama-lifecycle-service';

app.on('before-quit', async () => {
  // ... existing cleanup ...

  // Stop Ollama if we started it
  try {
    stopOllama();
    console.log('Ollama stopped successfully');
  } catch (error) {
    console.error('Failed to stop Ollama:', error);
  }
});
```

### 3. OllamaProvider Modification

```typescript
// In extract() method
async extract(input: ExtractionInput): Promise<ExtractionResult> {
  // NEW: Ensure Ollama is running for localhost
  if (this.isLocalhost()) {
    const { ensureOllamaRunning, resetIdleTimer } = await import('../ollama-lifecycle-service');

    const started = await ensureOllamaRunning();
    if (!started) {
      throw new Error('Could not start Ollama. Is it installed?');
    }
  }

  try {
    // ... existing extraction logic ...

    return result;
  } finally {
    // Reset idle timer after each request
    if (this.isLocalhost()) {
      const { resetIdleTimer } = await import('../ollama-lifecycle-service');
      resetIdleTimer();
    }
  }
}

private isLocalhost(): boolean {
  const host = this.config.settings.host || 'localhost';
  return host === 'localhost' || host === '127.0.0.1';
}
```

### 4. Capability Detection

```typescript
// In capabilities.ts or similar
export async function detectCapabilities(): Promise<Capabilities> {
  const ollamaPath = findOllamaBinary();

  return {
    // ... existing capabilities ...
    localOllama: ollamaPath !== null,
    ollamaPath,
  };
}
```

---

## IPC HANDLERS

| Channel | Parameters | Returns | Purpose |
|---------|------------|---------|---------|
| `ollama:getStatus` | none | `OllamaLifecycleStatus` | UI can show status |
| `ollama:ensureRunning` | none | `{ success: boolean; error?: string }` | Manual trigger |
| `ollama:stop` | none | `void` | Manual stop (admin) |

```typescript
// ollama-handlers.ts
export function registerOllamaLifecycleHandlers(): void {
  ipcMain.handle('ollama:getStatus', async () => {
    return getOllamaLifecycleStatus();
  });

  ipcMain.handle('ollama:ensureRunning', async () => {
    try {
      const success = await ensureOllamaRunning();
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
```

---

## ERROR HANDLING

| Error | User Impact | Recovery |
|-------|-------------|----------|
| Binary not found | Extraction fails | Show "Install Ollama" message in status |
| Port conflict (11434 in use) | Can't start | Use existing instance if compatible |
| Startup timeout | Extraction fails | Retry with backoff |
| Process crash | Extraction fails | Restart on next request |
| Permission denied | Can't start | Log error, surface in health check |

---

## TESTING STRATEGY

### Unit Tests
1. `findOllamaBinary()` - Mock filesystem, verify path detection
2. `isOllamaRunning()` - Mock fetch, verify API check
3. `cleanupOrphan()` - Mock filesystem and process.kill
4. Idle timer behavior

### Integration Tests
1. Start → Wait → Stop cycle
2. Orphan cleanup on startup
3. Concurrent requests reset idle timer
4. `weStartedIt` flag prevents killing user instance

### Manual Tests
1. Start app with Ollama NOT running → verify auto-start
2. Start app with Ollama already running → verify no restart
3. Close app → verify Ollama stops (only if we started)
4. Crash app → restart → verify orphan killed
5. Leave idle 5+ minutes → verify auto-stop

---

## DATABASE CHANGES

None. This is a runtime service only.

---

## IMPLEMENTATION PHASES

### Phase 1: Core Service (This PR)
- [x] `ollama-lifecycle-service.ts` with all lifecycle methods
- [x] PID file management
- [x] Binary detection
- [x] Idle timeout

### Phase 2: Integration
- [x] Modify `OllamaProvider` to call lifecycle service
- [x] Add cleanup to `app.on('before-quit')`
- [x] Add orphan cleanup to startup

### Phase 3: IPC & Visibility
- [x] IPC handlers for status
- [x] Update health check to include lifecycle status

### Phase 4: Testing
- [x] Unit tests
- [x] Integration tests
- [x] Manual verification

---

## SUCCESS CRITERIA

| Criteria | Measurement |
|----------|-------------|
| Seamless startup | Ollama starts within 30s on first extraction |
| No dock icon | Verify no Ollama in Dock (macOS) |
| No orphans | After crash, orphan killed on next start |
| Correct shutdown | Only kills OUR instance |
| Idle cleanup | RAM freed after 5min idle |
| No user prompts | Zero dialogs/modals for Ollama management |

---

## ROLLBACK PLAN

If issues arise:
1. Set `capabilities.localOllama = false` in detection
2. User must run `ollama serve` manually
3. OllamaProvider continues to work with remote hosts

---

*Document Version: 1.0*
*Created: 2025-12-13*
*Status: Ready for Implementation*
