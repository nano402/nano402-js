import {
  NanoRpcAccountHistoryResponse,
  NanoRpcAccountInfoResponse,
  NanoRpcWorkGenerateResponse,
  NanoRpcAccountsPendingResponse,
} from "./types";
import { RpcError, RpcTimeoutError } from "./errors";
import { RpcCache } from "./rpcCache";

export interface NanoRpcClientConfig {
  rpcUrl: string;
  timeout?: number; // milliseconds, default 10000
  retries?: number; // default 3
  retryDelay?: number; // milliseconds, default 1000
  auth?: {
    username?: string;
    password?: string;
  };
  cacheEnabled?: boolean; // default true
  cacheTtl?: number; // milliseconds, default 5000
}

export class NanoRpcClient {
  private rpcUrl: string;
  private timeout: number;
  private retries: number;
  private retryDelay: number;
  private auth?: { username?: string; password?: string };
  private cache?: RpcCache;

  constructor(config: NanoRpcClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.timeout = config.timeout ?? 10000;
    this.retries = config.retries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.auth = config.auth;
    if (config.cacheEnabled !== false) {
      this.cache = new RpcCache(config.cacheTtl);
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async rpcCall<T>(
    action: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          // Prepare headers
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };

          // Add authentication if provided
          if (this.auth?.username && this.auth?.password) {
            const credentials = Buffer.from(
              `${this.auth.username}:${this.auth.password}`
            ).toString("base64");
            headers["Authorization"] = `Basic ${credentials}`;
          }

          const response = await fetch(this.rpcUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              action,
              ...params,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new RpcError(
              `HTTP ${response.status}: ${response.statusText}`,
              response.status
            );
          }

          const data = (await response.json()) as { error?: string } & T;

          if (data.error) {
            throw new RpcError(data.error);
          }

          return data as T;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === "AbortError") {
            throw new RpcTimeoutError(this.timeout);
          }
          throw error;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on certain errors
        if (
          lastError instanceof RpcError &&
          lastError.statusCode &&
          lastError.statusCode >= 400 &&
          lastError.statusCode < 500
        ) {
          // Client errors (4xx) shouldn't be retried
          throw lastError;
        }

        // If this is the last attempt, throw the error
        if (attempt === this.retries) {
          throw lastError;
        }

        // Wait before retrying with exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError || new Error("Unknown RPC error");
  }

  async accountHistory(
    account: string,
    count: number = 10
  ): Promise<NanoRpcAccountHistoryResponse> {
    const cacheKey = RpcCache.accountHistoryKey(account, count);
    
    // Check cache
    if (this.cache) {
      const cached = this.cache.get<NanoRpcAccountHistoryResponse>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const result = await this.rpcCall<NanoRpcAccountHistoryResponse>(
      "account_history",
      {
        account,
        count,
      }
    );

    // Store in cache
    if (this.cache) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Clear cache for an account (useful after payment verification)
   */
  clearCache(account: string): void {
    if (this.cache) {
      // Clear cache entries for this account
      this.cache.delete(RpcCache.accountHistoryKey(account, 10));
      this.cache.delete(RpcCache.accountHistoryKey(account, 50));
      this.cache.delete(RpcCache.accountInfoKey(account));
      this.cache.delete(RpcCache.accountsPendingKey(account));
    }
  }

  async accountsPending(account: string, count: number = 10): Promise<NanoRpcAccountsPendingResponse> {
    const cacheKey = RpcCache.accountsPendingKey(account);
    
    // Check cache
    if (this.cache) {
      const cached = this.cache.get<NanoRpcAccountsPendingResponse>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const result = await this.rpcCall<NanoRpcAccountsPendingResponse>(
      "accounts_pending",
      {
        accounts: [account],
        count,
        source: "true", // Include source account
        include_only_confirmed: "false", // Include unconfirmed blocks
      }
    );

    // Store in cache
    if (this.cache) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  async accountInfo(account: string): Promise<NanoRpcAccountInfoResponse> {
    const cacheKey = RpcCache.accountInfoKey(account);
    
    // Check cache
    if (this.cache) {
      const cached = this.cache.get<NanoRpcAccountInfoResponse>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const result = await this.rpcCall<NanoRpcAccountInfoResponse>(
      "account_info",
      {
        account,
        representative: "true",
        pending: "true",
      }
    );

    // Store in cache
    if (this.cache) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  async workGenerate(hash: string): Promise<NanoRpcWorkGenerateResponse> {
    return this.rpcCall<NanoRpcWorkGenerateResponse>("work_generate", {
      hash,
    });
  }
}

