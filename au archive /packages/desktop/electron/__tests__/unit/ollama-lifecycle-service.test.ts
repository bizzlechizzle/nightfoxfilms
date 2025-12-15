/**
 * Ollama Lifecycle Service Unit Tests
 *
 * Tests for seamless auto-start/stop of local Ollama.
 * OPT-125: Ollama Lifecycle Management
 *
 * @module __tests__/unit/ollama-lifecycle-service.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import { join } from 'path';

// Mock modules before importing the service
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

describe('OllamaLifecycleService', () => {
  let mockProcess: Partial<ChildProcess>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module state by re-importing
    vi.resetModules();

    // Setup default mocks
    (existsSync as any).mockReturnValue(false);
    (readFileSync as any).mockReturnValue('');
    (writeFileSync as any).mockImplementation(() => {});
    (unlinkSync as any).mockImplementation(() => {});
    (execSync as any).mockImplementation(() => {
      throw new Error('Command not found');
    });

    // Mock child process
    mockProcess = {
      pid: 12345,
      unref: vi.fn(),
      kill: vi.fn(),
      on: vi.fn().mockReturnThis(),
    } as unknown as Partial<ChildProcess>;
    (spawn as any).mockReturnValue(mockProcess);

    // Mock fetch
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findOllamaBinary', () => {
    it('should find Ollama at Homebrew Apple Silicon path', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );

      // Need to import after mocks are set up
      const { findOllamaBinary } = await import('../../services/ollama-lifecycle-service');

      const result = findOllamaBinary();
      expect(result).toBe('/opt/homebrew/bin/ollama');
    });

    it('should find Ollama at Homebrew Intel path', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/usr/local/bin/ollama'
      );

      const { findOllamaBinary } = await import('../../services/ollama-lifecycle-service');

      const result = findOllamaBinary();
      expect(result).toBe('/usr/local/bin/ollama');
    });

    it('should fall back to which command if not in common paths', async () => {
      (existsSync as any).mockReturnValue(false);
      (execSync as any).mockReturnValue('/custom/path/ollama\n');
      // Make the custom path exist
      (existsSync as any).mockImplementation((path: string) =>
        path === '/custom/path/ollama'
      );

      const { findOllamaBinary } = await import('../../services/ollama-lifecycle-service');

      const result = findOllamaBinary();
      // Result depends on caching - first call checks common paths
      expect(execSync).toHaveBeenCalled();
    });

    it('should return null if Ollama not found', async () => {
      (existsSync as any).mockReturnValue(false);
      (execSync as any).mockImplementation(() => {
        throw new Error('Command not found');
      });

      const { findOllamaBinary } = await import('../../services/ollama-lifecycle-service');

      const result = findOllamaBinary();
      expect(result).toBeNull();
    });

    it('should cache binary path after first call', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );

      const { findOllamaBinary } = await import('../../services/ollama-lifecycle-service');

      findOllamaBinary();
      findOllamaBinary();
      findOllamaBinary();

      // existsSync should only be called on first invocation
      // After caching, it won't check again
    });
  });

  describe('isOllamaInstalled', () => {
    it('should return true if binary is found', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );

      const { isOllamaInstalled } = await import('../../services/ollama-lifecycle-service');

      expect(isOllamaInstalled()).toBe(true);
    });

    it('should return false if binary is not found', async () => {
      (existsSync as any).mockReturnValue(false);
      (execSync as any).mockImplementation(() => {
        throw new Error('Command not found');
      });

      const { isOllamaInstalled } = await import('../../services/ollama-lifecycle-service');

      expect(isOllamaInstalled()).toBe(false);
    });
  });

  describe('isOllamaRunning', () => {
    it('should return true when Ollama API responds OK', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { isOllamaRunning } = await import('../../services/ollama-lifecycle-service');

      const result = await isOllamaRunning();
      expect(result).toBe(true);
    });

    it('should return false when Ollama API fails', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));

      const { isOllamaRunning } = await import('../../services/ollama-lifecycle-service');

      const result = await isOllamaRunning();
      expect(result).toBe(false);
    });

    it('should return false when Ollama returns non-OK status', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { isOllamaRunning } = await import('../../services/ollama-lifecycle-service');

      const result = await isOllamaRunning();
      expect(result).toBe(false);
    });
  });

  describe('cleanupOrphanOllama', () => {
    it('should do nothing if PID file does not exist', async () => {
      (existsSync as any).mockReturnValue(false);

      const { cleanupOrphanOllama } = await import('../../services/ollama-lifecycle-service');

      cleanupOrphanOllama();

      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('should kill orphan process if PID file exists and process is running', async () => {
      // Mock: Ollama binary exists but PID file also exists
      (existsSync as any).mockImplementation((path: string) => {
        if (path === '/mock/userData/ollama.pid') return true;
        if (path === '/opt/homebrew/bin/ollama') return true;
        return false;
      });
      (readFileSync as any).mockReturnValue('12345');

      // Mock process.kill to not throw (process exists)
      const originalKill = process.kill;
      process.kill = vi.fn();

      const { cleanupOrphanOllama } = await import('../../services/ollama-lifecycle-service');

      cleanupOrphanOllama();

      expect(process.kill).toHaveBeenCalledWith(12345, 0);
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(unlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });

    it('should just remove PID file if process is not running', async () => {
      (existsSync as any).mockImplementation((path: string) => {
        if (path === '/mock/userData/ollama.pid') return true;
        return false;
      });
      (readFileSync as any).mockReturnValue('12345');

      // Mock process.kill to throw (process doesn't exist)
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      const { cleanupOrphanOllama } = await import('../../services/ollama-lifecycle-service');

      cleanupOrphanOllama();

      expect(unlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });
  });

  describe('startOllama', () => {
    it('should return true if Ollama is already running', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { startOllama } = await import('../../services/ollama-lifecycle-service');

      const result = await startOllama();
      expect(result).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should return false if binary not found', async () => {
      // Mock: Ollama not running
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));
      // Mock: Binary not found
      (existsSync as any).mockReturnValue(false);
      (execSync as any).mockImplementation(() => {
        throw new Error('Command not found');
      });

      const { startOllama } = await import('../../services/ollama-lifecycle-service');

      const result = await startOllama();
      expect(result).toBe(false);
    });

    it('should spawn Ollama process with correct options', async () => {
      // Mock: Ollama not running initially, then running after spawn
      let callCount = 0;
      (global.fetch as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [] }),
        });
      });

      // Mock: Binary found
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );

      const { startOllama } = await import('../../services/ollama-lifecycle-service');

      const result = await startOllama();

      expect(spawn).toHaveBeenCalledWith(
        '/opt/homebrew/bin/ollama',
        ['serve'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
          env: expect.objectContaining({
            OLLAMA_HOST: '127.0.0.1:11434',
          }),
        })
      );
      expect(mockProcess.unref).toHaveBeenCalled();
    });
  });

  describe('stopOllama', () => {
    it('should not kill process if we did not start it', async () => {
      const { stopOllama } = await import('../../services/ollama-lifecycle-service');

      // Call stop without having started
      stopOllama();

      expect(mockProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe('resetIdleTimer', () => {
    it('should be callable without throwing', async () => {
      const { resetIdleTimer } = await import('../../services/ollama-lifecycle-service');

      expect(() => resetIdleTimer()).not.toThrow();
    });
  });

  describe('getOllamaLifecycleStatus', () => {
    it('should return correct status structure', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { getOllamaLifecycleStatus } = await import('../../services/ollama-lifecycle-service');

      const status = await getOllamaLifecycleStatus();

      expect(status).toHaveProperty('installed');
      expect(status).toHaveProperty('binaryPath');
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('managedByApp');
      expect(status).toHaveProperty('idleTimeoutMs');
      expect(status).toHaveProperty('idleTimeRemainingMs');
      expect(status).toHaveProperty('lastError');
    });

    it('should report installed: true when binary exists', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { getOllamaLifecycleStatus } = await import('../../services/ollama-lifecycle-service');

      const status = await getOllamaLifecycleStatus();

      expect(status.installed).toBe(true);
      expect(status.binaryPath).toBe('/opt/homebrew/bin/ollama');
    });

    it('should report running: true when Ollama API responds', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { getOllamaLifecycleStatus } = await import('../../services/ollama-lifecycle-service');

      const status = await getOllamaLifecycleStatus();

      expect(status.running).toBe(true);
    });

    it('should report managedByApp: false initially', async () => {
      (existsSync as any).mockImplementation((path: string) =>
        path === '/opt/homebrew/bin/ollama'
      );
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { getOllamaLifecycleStatus } = await import('../../services/ollama-lifecycle-service');

      const status = await getOllamaLifecycleStatus();

      expect(status.managedByApp).toBe(false);
    });
  });
});
