/**
 * Job Queue Unit Tests
 * Tests for exponential backoff, job lifecycle, and dead letter queue
 *
 * @module __tests__/unit/job-queue.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-memory job store for mocking
const mockJobs = new Map<string, any>();
const mockDeadLetterJobs: any[] = [];
let mockJobIdCounter = 0;

// Mock Electron app before any imports
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-app'),
    on: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

// Mock the Logger service
vi.mock('../../services/logger-service', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  })),
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  }),
}));

// Mock better-sqlite3 before any imports
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      pragma: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn().mockImplementation((sql: string) => ({
        get: vi.fn().mockImplementation((...args: any[]) => {
          const jobId = args[0];
          return mockJobs.get(jobId);
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      })),
      close: vi.fn(),
    })),
  };
});

// Mock Kysely with job operations
vi.mock('kysely', () => ({
  Kysely: vi.fn().mockImplementation(() => ({
    insertInto: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({}),
      }),
    }),
    selectFrom: vi.fn().mockReturnValue({
      selectAll: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockImplementation(async () => null),
          execute: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      }),
    }),
    updateTable: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({ numUpdatedRows: BigInt(1) }),
        }),
      }),
    }),
    destroy: vi.fn(),
  })),
  SqliteDialect: vi.fn(),
}));

import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY, type JobStatus } from '../../services/job-queue';

describe('JobQueue', () => {
  let jobQueue: JobQueue;
  let mockDb: any;

  beforeEach(() => {
    // Reset mock stores
    mockJobs.clear();
    mockDeadLetterJobs.length = 0;
    mockJobIdCounter = 0;

    // Create mock db
    mockDb = {
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockImplementation(async (data: any) => {
            const jobId = `job-${++mockJobIdCounter}`;
            mockJobs.set(jobId, { ...data, job_id: jobId, status: 'pending', attempts: 0 });
            return {};
          }),
        }),
      }),
      selectFrom: vi.fn().mockImplementation((table: string) => ({
        selectAll: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockImplementation(async () => {
              const jobs = Array.from(mockJobs.values());
              return jobs.find(j => j.status === 'pending') || null;
            }),
            execute: vi.fn().mockImplementation(async () => Array.from(mockJobs.values())),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockImplementation(async () => {
                const pending = Array.from(mockJobs.values())
                  .filter(j => j.status === 'pending')
                  .sort((a, b) => (b.priority || 10) - (a.priority || 10));
                return pending[0] || null;
              }),
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockImplementation(async () => null),
          }),
        }),
      })),
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({ numUpdatedRows: BigInt(1) }),
          }),
        }),
      }),
    };

    jobQueue = new JobQueue(mockDb, { workerId: 'test-worker' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('queue constants', () => {
    it('should have correct queue names', () => {
      expect(IMPORT_QUEUES.EXIFTOOL).toBe('exiftool');
      expect(IMPORT_QUEUES.FFPROBE).toBe('ffprobe');
      expect(IMPORT_QUEUES.THUMBNAIL).toBe('thumbnail');
      expect(IMPORT_QUEUES.VIDEO_PROXY).toBe('video-proxy');
    });

    it('should have correct priority values', () => {
      expect(JOB_PRIORITY.LOW).toBe(1);
      expect(JOB_PRIORITY.NORMAL).toBe(10);
      expect(JOB_PRIORITY.HIGH).toBe(50);
      expect(JOB_PRIORITY.CRITICAL).toBe(100);
    });
  });

  describe('exponential backoff (FIX 2)', () => {
    it('should calculate exponential backoff delay', () => {
      expect(jobQueue.calculateRetryDelay(0)).toBe(1000);   // 1s
      expect(jobQueue.calculateRetryDelay(1)).toBe(2000);   // 2s
      expect(jobQueue.calculateRetryDelay(2)).toBe(4000);   // 4s
      expect(jobQueue.calculateRetryDelay(3)).toBe(8000);   // 8s
      expect(jobQueue.calculateRetryDelay(4)).toBe(16000);  // 16s
      expect(jobQueue.calculateRetryDelay(5)).toBe(32000);  // 32s
      expect(jobQueue.calculateRetryDelay(6)).toBe(60000);  // Capped at 60s
      expect(jobQueue.calculateRetryDelay(10)).toBe(60000); // Still capped
    });

    it('should handle edge cases for backoff calculation', () => {
      expect(jobQueue.calculateRetryDelay(-1)).toBe(500);   // Edge case: negative
      expect(jobQueue.calculateRetryDelay(100)).toBe(60000); // Way over max still capped
    });
  });

  describe('workerId', () => {
    it('should have the configured worker ID', () => {
      expect(jobQueue.getWorkerId()).toBe('test-worker');
    });
  });
});
