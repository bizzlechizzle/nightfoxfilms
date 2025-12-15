/**
 * Location Lock Service - Prevent concurrent imports to same location
 *
 * Per Import Spec v2.0:
 * - Prevents race conditions when multiple imports target same location
 * - Serializes imports to same location (subsequent imports wait in queue)
 * - Cleans up locks when imports complete/fail/cancel
 *
 * Why this matters:
 * - Concurrent imports can cause hero image race conditions
 * - Media counts become incorrect if multiple imports update simultaneously
 * - BagIt manifests can become corrupted with parallel writes
 *
 * @module services/import/location-lock
 */

import { getLogger } from '../logger-service';

const logger = getLogger();

/**
 * Lock entry with metadata
 */
interface LockEntry {
  locid: string;
  sessionId: string;
  acquiredAt: Date;
  user?: string;
}

/**
 * Pending import waiting for lock
 */
interface PendingEntry {
  locid: string;
  sessionId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Location Lock Service
 *
 * In-memory locking with queue for waiting imports.
 * All locks are automatically released on process exit.
 */
class LocationLockService {
  // Active locks by location ID
  private locks = new Map<string, LockEntry>();

  // Pending imports waiting for locks (FIFO queue per location)
  private pendingQueues = new Map<string, PendingEntry[]>();

  /**
   * Acquire lock for a location.
   *
   * If location is already locked:
   * - waitIfLocked=true: Wait in queue until lock is released
   * - waitIfLocked=false: Throw error immediately
   *
   * @param locid - Location ID to lock
   * @param sessionId - Import session ID (for tracking)
   * @param options - Lock options
   * @returns true if lock acquired, throws if not
   */
  async acquire(
    locid: string,
    sessionId: string,
    options?: { waitIfLocked?: boolean; user?: string }
  ): Promise<boolean> {
    const { waitIfLocked = false, user } = options ?? {};

    // Check if already locked
    const existingLock = this.locks.get(locid);

    if (!existingLock) {
      // Not locked, acquire immediately
      this.locks.set(locid, {
        locid,
        sessionId,
        acquiredAt: new Date(),
        user,
      });
      logger.info('LocationLock', 'Lock acquired', { locid, sessionId });
      return true;
    }

    // Already locked
    if (!waitIfLocked) {
      logger.warn('LocationLock', 'Location already locked', {
        locid,
        sessionId,
        lockedBy: existingLock.sessionId,
      });
      throw new Error(
        `Location is currently being imported to. Please wait for the current import to complete.`
      );
    }

    // Wait in queue
    logger.info('LocationLock', 'Waiting for lock', {
      locid,
      sessionId,
      lockedBy: existingLock.sessionId,
    });

    return new Promise((resolve, reject) => {
      // Get or create queue for this location
      let queue = this.pendingQueues.get(locid);
      if (!queue) {
        queue = [];
        this.pendingQueues.set(locid, queue);
      }

      // Add to queue
      queue.push({
        locid,
        sessionId,
        resolve: () => {
          // When resolved, acquire the lock
          this.locks.set(locid, {
            locid,
            sessionId,
            acquiredAt: new Date(),
            user,
          });
          logger.info('LocationLock', 'Lock acquired after wait', { locid, sessionId });
          resolve(true);
        },
        reject,
      });
    });
  }

  /**
   * Release lock for a location.
   *
   * If there are pending imports waiting, the next one is activated.
   *
   * @param locid - Location ID to unlock
   * @param sessionId - Import session ID (must match lock holder)
   */
  release(locid: string, sessionId: string): void {
    const lock = this.locks.get(locid);

    if (!lock) {
      logger.warn('LocationLock', 'Attempted to release non-existent lock', { locid, sessionId });
      return;
    }

    if (lock.sessionId !== sessionId) {
      logger.warn('LocationLock', 'Attempted to release lock owned by different session', {
        locid,
        sessionId,
        lockedBy: lock.sessionId,
      });
      return;
    }

    // Remove lock
    this.locks.delete(locid);
    logger.info('LocationLock', 'Lock released', { locid, sessionId });

    // Check for pending imports
    const queue = this.pendingQueues.get(locid);
    if (queue && queue.length > 0) {
      // Activate next in queue
      const next = queue.shift()!;
      if (queue.length === 0) {
        this.pendingQueues.delete(locid);
      }
      logger.info('LocationLock', 'Activating next waiting import', {
        locid,
        nextSessionId: next.sessionId,
      });
      next.resolve();
    }
  }

  /**
   * Check if a location is currently locked.
   *
   * @param locid - Location ID to check
   * @returns Lock info if locked, null if not
   */
  isLocked(locid: string): LockEntry | null {
    return this.locks.get(locid) ?? null;
  }

  /**
   * Get queue position for a session waiting on a location.
   *
   * @param locid - Location ID
   * @param sessionId - Session ID to find
   * @returns Queue position (0 = next up), -1 if not in queue
   */
  getQueuePosition(locid: string, sessionId: string): number {
    const queue = this.pendingQueues.get(locid);
    if (!queue) return -1;
    return queue.findIndex(p => p.sessionId === sessionId);
  }

  /**
   * Cancel a pending import (remove from queue).
   *
   * @param sessionId - Session ID to cancel
   */
  cancelPending(sessionId: string): void {
    for (const [locid, queue] of this.pendingQueues) {
      const index = queue.findIndex(p => p.sessionId === sessionId);
      if (index !== -1) {
        const pending = queue.splice(index, 1)[0];
        pending.reject(new Error('Import cancelled while waiting for lock'));
        logger.info('LocationLock', 'Cancelled pending import', { locid, sessionId });
        if (queue.length === 0) {
          this.pendingQueues.delete(locid);
        }
        return;
      }
    }
  }

  /**
   * Force release all locks (for cleanup/shutdown).
   * Rejects all pending imports.
   */
  releaseAll(): void {
    // Clear all locks
    this.locks.clear();

    // Reject all pending
    for (const [locid, queue] of this.pendingQueues) {
      for (const pending of queue) {
        pending.reject(new Error('Import system shutting down'));
      }
    }
    this.pendingQueues.clear();

    logger.info('LocationLock', 'All locks released');
  }

  /**
   * Get current lock status (for debugging/monitoring).
   */
  getStatus(): {
    activeLocks: LockEntry[];
    pendingCounts: Record<string, number>;
  } {
    return {
      activeLocks: Array.from(this.locks.values()),
      pendingCounts: Object.fromEntries(
        Array.from(this.pendingQueues.entries()).map(([k, v]) => [k, v.length])
      ),
    };
  }
}

// Singleton instance
const locationLockService = new LocationLockService();

/**
 * Get the location lock service singleton.
 */
export function getLocationLockService(): LocationLockService {
  return locationLockService;
}

/**
 * Acquire a lock for a location (convenience function).
 */
export async function acquireLocationLock(
  locid: string,
  sessionId: string,
  options?: { waitIfLocked?: boolean; user?: string }
): Promise<boolean> {
  return locationLockService.acquire(locid, sessionId, options);
}

/**
 * Release a lock for a location (convenience function).
 */
export function releaseLocationLock(locid: string, sessionId: string): void {
  locationLockService.release(locid, sessionId);
}

/**
 * Check if a location is locked (convenience function).
 */
export function isLocationLocked(locid: string): boolean {
  return locationLockService.isLocked(locid) !== null;
}
