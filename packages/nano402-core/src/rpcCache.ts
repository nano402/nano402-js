/**
 * Simple in-memory cache for RPC responses
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class RpcCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTtl: number;

  constructor(defaultTtlMs: number = 5000) {
    this.defaultTtl = defaultTtlMs;
  }

  /**
   * Get cached value if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cached value
   */
  set<T>(key: string, data: T, ttlMs?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs ?? this.defaultTtl,
    });
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Delete specific cache entry
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Generate cache key for account history
   */
  static accountHistoryKey(account: string, count: number): string {
    return `account_history:${account}:${count}`;
  }

  /**
   * Generate cache key for account info
   */
  static accountInfoKey(account: string): string {
    return `account_info:${account}`;
  }

  /**
   * Generate cache key for accounts pending
   */
  static accountsPendingKey(account: string): string {
    return `accounts_pending:${account}`;
  }
}

