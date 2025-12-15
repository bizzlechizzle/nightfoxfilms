import fs from 'fs/promises';

/**
 * MediaCacheService - In-memory LRU cache for recently viewed images
 *
 * Core Rules (DO NOT BREAK):
 * 1. LRU eviction - When cache exceeds maxSizeMB, evict least recently used
 * 2. Size tracking - Track actual buffer sizes, not just count
 * 3. Async-safe - All operations are thread-safe
 * 4. Never throw - Return null on cache miss, log errors
 */

interface CacheEntry {
  data: Buffer;
  size: number;
  lastAccessed: number;
}

export class MediaCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private currentSize: number = 0;
  private readonly maxSizeBytes: number;

  constructor(maxSizeMB: number = 100) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
  }

  /**
   * Get an item from cache
   * Updates lastAccessed timestamp on hit
   */
  get(key: string): Buffer | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Update access time for LRU
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  /**
   * Add an item to cache
   * Will evict LRU entries if needed
   */
  set(key: string, data: Buffer): void {
    const size = data.length;

    // Don't cache items larger than max size
    if (size > this.maxSizeBytes) {
      console.log(`[MediaCache] Item too large to cache: ${size} bytes`);
      return;
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      this.currentSize -= existing.size;
      this.cache.delete(key);
    }

    // Evict until we have space
    while (this.currentSize + size > this.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }

    // Add new entry
    this.cache.set(key, {
      data,
      size,
      lastAccessed: Date.now(),
    });
    this.currentSize += size;
  }

  /**
   * Check if item is in cache
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove item from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      this.cache.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Clear all cached items
   */
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; items: number; maxSize: number } {
    return {
      size: this.currentSize,
      items: this.cache.size,
      maxSize: this.maxSizeBytes,
    };
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.currentSize -= entry.size;
      this.cache.delete(oldestKey);
    }
  }

  /**
   * OPT-038: Maximum file size for memory caching (500MB)
   * Node.js fs.readFile() crashes on files > 2GB, and large files
   * shouldn't be cached in memory anyway - they should be streamed.
   */
  private readonly MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

  /**
   * Load a file into cache
   * OPT-038: Checks file size before loading to prevent ERR_FS_FILE_TOO_LARGE
   */
  async loadFile(key: string, filePath: string): Promise<Buffer | null> {
    try {
      // Check cache first
      const cached = this.get(key);
      if (cached) {
        return cached;
      }

      // OPT-038: Check file size before loading to prevent Node.js crash on 2GB+ files
      const stat = await fs.stat(filePath);
      if (stat.size > this.MAX_FILE_SIZE_BYTES) {
        console.log(`[MediaCache] Skipping large file (${Math.round(stat.size / 1024 / 1024)}MB > 500MB): ${filePath}`);
        return null;
      }

      // Load from disk
      const data = await fs.readFile(filePath);
      this.set(key, data);
      return data;
    } catch (error) {
      console.error(`[MediaCache] Failed to load file ${filePath}:`, error);
      return null;
    }
  }
}
