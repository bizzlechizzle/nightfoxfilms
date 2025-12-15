# Ollama Lifecycle Service - Implementation Guide

**OPT-125: Seamless Local LLM Management**

This guide explains how the Ollama Lifecycle Service works for developers who need to understand, maintain, or extend it.

---

## Overview

The Ollama Lifecycle Service automatically manages a local Ollama installation so that:
- Users never see Ollama in their dock/taskbar
- Ollama starts automatically when the app needs it
- Ollama stops after 5 minutes of inactivity (to free RAM)
- The app cleans up orphan processes if it crashed previously

**Key principle:** Zero user interaction required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          App Startup                            │
│                               │                                 │
│                    cleanupOrphanOllama()                        │
│                     (kill leftover from crash)                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Extraction Request                          │
│                               │                                 │
│                    ensureOllamaRunning()                        │
│                               │                                 │
│              ┌────────────────┴────────────────┐                │
│              │                                 │                │
│         Already running?                  Not running?          │
│              │                                 │                │
│           Return                         startOllama()          │
│                                                │                │
│                                    Spawn headless process       │
│                                    Save PID to file             │
│                                    Wait for API ready           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     After Each Request                          │
│                               │                                 │
│                      resetIdleTimer()                           │
│                               │                                 │
│                    ┌──────────┴──────────┐                      │
│                    │                     │                      │
│              New request              5 min idle                │
│              within 5 min?                 │                    │
│                    │                 stopOllama()               │
│              Timer reset            (if we started it)          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         App Shutdown                            │
│                               │                                 │
│                         stopOllama()                            │
│                   (only if we started it)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
packages/desktop/electron/
├── services/
│   └── ollama-lifecycle-service.ts    ◄── Main service (278 lines)
├── main/
│   ├── ipc-handlers/
│   │   ├── ollama-lifecycle.ts        ◄── IPC handlers (50 lines)
│   │   └── index.ts                   ◄── Handler registration
│   └── index.ts                       ◄── App lifecycle hooks
└── preload/
    └── preload.cjs                    ◄── Renderer API exposure
```

---

## Key Functions

### 1. `findOllamaBinary(): string | null`

Locates the Ollama executable on the system.

**How it works:**
1. Checks common installation paths first (fast):
   - `/opt/homebrew/bin/ollama` (macOS Apple Silicon)
   - `/usr/local/bin/ollama` (macOS Intel / Linux)
   - `~/.ollama/bin/ollama` (manual install)
2. Falls back to `which ollama` if not found
3. Caches result after first call

**Why caching matters:** Binary location doesn't change during app runtime, and filesystem checks are slow.

```typescript
// Usage
const binaryPath = findOllamaBinary();
if (!binaryPath) {
  console.log('Ollama not installed');
}
```

### 2. `isOllamaRunning(): Promise<boolean>`

Checks if any Ollama instance is responding to API calls.

**How it works:**
1. Makes HTTP GET to `http://127.0.0.1:11434/api/tags`
2. Uses 2-second timeout (fast health check)
3. Returns `true` if response is OK, `false` otherwise

**Important:** This doesn't distinguish between OUR instance and a user-started instance.

```typescript
// Usage
if (await isOllamaRunning()) {
  // Safe to make API calls
}
```

### 3. `startOllama(): Promise<boolean>`

Starts Ollama as a headless background process.

**How it works:**
1. Returns `true` immediately if already running
2. Finds binary path (fails if not installed)
3. Spawns process with `detached: true` and `stdio: 'ignore'`
4. Binds to `127.0.0.1:11434` only (security)
5. Calls `unref()` so process doesn't block app exit
6. Saves PID to file for orphan cleanup
7. Polls API every second until ready (max 30s)

**Key spawn options:**
```typescript
spawn(binaryPath, ['serve'], {
  detached: true,       // Run independently of parent
  stdio: 'ignore',      // No console output (headless)
  env: {
    OLLAMA_HOST: '127.0.0.1:11434',  // Localhost only
  },
});
```

### 4. `stopOllama(): void`

Stops Ollama - but only if WE started it.

**How it works:**
1. Checks `weStartedIt` flag
2. If false, does nothing (don't kill user's instance)
3. Sends `SIGTERM` to process
4. Removes PID file
5. Clears idle timer

**Why SIGTERM:** Allows Ollama to shut down gracefully, saving any model state.

### 5. `cleanupOrphanOllama(): void`

Cleans up orphan processes from previous app crashes.

**How it works:**
1. Checks for PID file at `userData/ollama.pid`
2. Reads PID from file
3. Checks if process exists with `kill(pid, 0)`
4. If exists, kills with `SIGTERM`
5. Removes PID file

**When called:** During app startup, before IPC handlers are registered.

### 6. `resetIdleTimer(): void`

Resets the 5-minute idle shutdown timer.

**How it works:**
1. Clears existing timer
2. Starts new 5-minute timer
3. When timer fires, calls `stopOllama()`

**When called:** After every extraction request (success or failure).

---

## State Management

The service uses module-level state (singleton pattern):

```typescript
let ollamaProcess: ChildProcess | null = null;  // Current process handle
let weStartedIt = false;                        // Did WE start it?
let idleTimer: NodeJS.Timeout | null = null;    // Idle shutdown timer
let idleTimerStartedAt: number | null = null;   // For remaining time calc
let lastError: string | null = null;            // Last error message
let cachedBinaryPath: string | null | undefined = undefined;  // Binary path cache
```

**Why module-level?** Only one Ollama instance should run at a time. Class instances would complicate lifecycle management.

---

## Integration Points

### 1. OllamaProvider (Extraction)

```typescript
// packages/desktop/electron/services/extraction/providers/ollama-provider.ts

async extract(input: ExtractionInput): Promise<ExtractionResult> {
  // For localhost, ensure Ollama is running
  if (this.isLocalhostHost) {
    const started = await ensureOllamaRunning();
    if (!started) {
      throw new Error('Could not start Ollama');
    }
  }

  try {
    // ... extraction logic ...
    return result;
  } finally {
    // Reset idle timer after each request
    if (this.isLocalhostHost) {
      resetIdleTimer();
    }
  }
}
```

### 2. App Startup (IPC Registration)

```typescript
// packages/desktop/electron/main/ipc-handlers/index.ts

import { cleanupOrphanOllama } from '../../services/ollama-lifecycle-service';
import { registerOllamaLifecycleHandlers } from './ollama-lifecycle';

export function registerIpcHandlers() {
  // ... other handlers ...

  // OPT-125: Ollama Lifecycle Management
  cleanupOrphanOllama();
  registerOllamaLifecycleHandlers();
}
```

### 3. App Shutdown

```typescript
// packages/desktop/electron/main/index.ts

import { stopOllama } from '../services/ollama-lifecycle-service';

app.on('before-quit', async () => {
  // ... other cleanup ...

  // OPT-125: Stop Ollama if we started it
  try {
    stopOllama();
    console.log('Ollama stopped successfully');
  } catch (error) {
    console.error('Failed to stop Ollama:', error);
  }
});
```

---

## IPC API

### Channels

| Channel | Purpose | Returns |
|---------|---------|---------|
| `ollama:getStatus` | Get lifecycle status | `OllamaLifecycleStatus` |
| `ollama:ensureRunning` | Start Ollama if needed | `{ success: boolean; error?: string }` |
| `ollama:stop` | Stop Ollama (admin only) | `{ success: boolean; error?: string }` |
| `ollama:checkInstalled` | Check if installed | `{ installed: boolean; path?: string }` |

### Renderer Usage

```typescript
// Check if Ollama is installed
const { installed, path } = await window.electronAPI.ollama.checkInstalled();

// Get current status
const status = await window.electronAPI.ollama.getStatus();
console.log(`Running: ${status.running}, Managed by app: ${status.managedByApp}`);

// Manually ensure running (usually automatic)
const { success, error } = await window.electronAPI.ollama.ensureRunning();
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Ollama not installed" | Binary not found | Install from https://ollama.ai |
| "Failed to start within 30s" | Startup timeout | Check Ollama logs, try manual `ollama serve` |
| "Port 11434 already in use" | Another process | Kill conflicting process |
| "Model not found" | Missing model | Run `ollama pull <model>` |

### Graceful Degradation

The service never throws errors that would crash the app:
- Missing binary → returns `false` from `startOllama()`
- API timeout → returns `false` from `isOllamaRunning()`
- Kill failure → logged but doesn't throw

---

## Testing

Run unit tests:
```bash
cd packages/desktop
pnpm test electron/__tests__/unit/ollama-lifecycle-service.test.ts
```

### Manual Testing Checklist

1. **Auto-start test:**
   - Close Ollama if running
   - Trigger extraction in app
   - Verify Ollama starts automatically
   - Verify no dock icon appears

2. **Idle shutdown test:**
   - Trigger extraction
   - Wait 5+ minutes
   - Verify Ollama stops (check `ps aux | grep ollama`)

3. **External instance test:**
   - Start Ollama manually: `ollama serve`
   - Trigger extraction in app
   - Close app
   - Verify Ollama still running (we didn't start it)

4. **Orphan cleanup test:**
   - Start app and trigger extraction
   - Force-kill app: `kill -9 <app-pid>`
   - Restart app
   - Verify orphan Ollama was killed

---

## Configuration

Currently hardcoded (no user settings):

| Setting | Value | Why |
|---------|-------|-----|
| Idle timeout | 5 minutes | Balance between responsiveness and RAM usage |
| Startup timeout | 30 seconds | First load of large model can be slow |
| Bind address | 127.0.0.1 | Security - localhost only |
| Port | 11434 | Ollama default |

Future: Could expose idle timeout in Settings if users request it.

---

## Troubleshooting

### Ollama won't start

1. **Check if installed:** `which ollama`
2. **Try manual start:** `ollama serve`
3. **Check port:** `lsof -i :11434`
4. **Check logs:** Look for errors in console

### Ollama keeps running after app closes

1. **Check PID file:** `cat ~/Library/Application Support/au-archive/ollama.pid`
2. **Kill manually:** `pkill ollama`
3. **Check `weStartedIt` flag:** If app connected to existing instance, it won't stop it

### High RAM usage

Ollama loads models into RAM. Large models (32B+) can use 20-40GB.

1. **Stop Ollama manually:** `ollama stop`
2. **Use smaller model:** Configure provider to use `qwen2.5:7b` instead of `qwen2.5:32b`
3. **Reduce idle timeout:** (requires code change)

---

## Future Improvements

1. **Configurable idle timeout:** User setting in preferences
2. **Model preloading:** Warm up model during app startup
3. **Memory monitoring:** Stop Ollama if system memory is low
4. **Multiple model support:** Different models for different tasks
5. **Progress notifications:** Show status when Ollama is starting

---

*Document Version: 1.0*
*Last Updated: 2025-12-13*
*Author: OPT-125 Implementation*
