export interface Invoice {
  id: string;
  index: number;
  resource: string;
  nano_account: string;
  amount_xno: string;
  amount_raw: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "paid" | "used" | "expired" | "cancelled" | "refunded";
  tx_hash?: string;
  paid_at?: string;
  sender_account?: string;
  proof_expires_at?: string;
  client_ip?: string; // Track client IP for IP-based verification
  access_count?: number; // Track how many times invoice was accessed
  last_accessed_at?: string; // Last access timestamp
  user_agent?: string; // User agent from request
  referer?: string; // Referer header
  metadata?: Record<string, any>; // Additional metadata as JSON
}

export type InvoiceStatus = Invoice["status"];

// Forward reference to avoid circular dependency
export type IndexStore = import("./indexStore").IndexStore;

export interface Nano402Config {
  walletSeed: string;
  nanoRpcUrl: string;
  invoiceStore?: InvoiceStore;
  // SQLite options (used when SQLite is default)
  dbPath?: string; // Path to SQLite database file (defaults to .nano402-invoices.db)
  // Security options
  rpcTimeout?: number; // milliseconds, default 10000
  rpcRetries?: number; // default 3
  rpcRetryDelay?: number; // milliseconds, default 1000
  rpcAuth?: {
    username?: string;
    password?: string;
  };
  rpcCacheEnabled?: boolean; // default true
  rpcCacheTtl?: number; // milliseconds, default 5000
  // Payment verification options
  verifySender?: boolean; // Verify payment came from expected sender
  allowedSenders?: string[]; // Whitelist of allowed sender accounts
  proofExpirationSeconds?: number; // How long payment proofs are valid, default 3600
  acceptPending?: boolean; // Accept pending (unconfirmed) blocks as valid payment. Default: true
  // Index management
  indexStart?: number; // Starting index, default 0
  indexStore?: IndexStore; // Optional persistent index store
  indexStorePath?: string; // Path for file-based index store (defaults to .nano402-db.json)
}

export interface CreateInvoiceParams {
  resource: string;
  amount_xno: string;
  ttlSeconds?: number;
  proofExpirationSeconds?: number;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  events: ("invoice.created" | "invoice.paid" | "invoice.expired" | "invoice.cancelled" | "invoice.refunded")[];
}

export interface PaymentVerificationOptions {
  verifyTimestamp?: boolean; // Verify payment happened after invoice creation
  verifySender?: boolean; // Verify payment came from expected sender
  allowedSenders?: string[]; // Whitelist of allowed sender accounts
  acceptPending?: boolean; // Accept pending (unconfirmed) blocks as valid payment. Default: true
}

export interface InvoiceStore {
  save(invoice: Invoice): Promise<void>;
  findById(id: string): Promise<Invoice | null>;
  findByResource(resource: string): Promise<Invoice | null>;
  update(id: string, updates: Partial<Invoice>): Promise<void>;
  // New methods for atomic operations and index management
  findPendingByResource(resource: string): Promise<Invoice | null>;
  getNextIndex(): Promise<number>;
  findAll(params?: { status?: Invoice["status"]; limit?: number; offset?: number }): Promise<Invoice[]>;
  delete(id: string): Promise<void>;
  // IP-based lookup
  findByClientIp(ip: string, resource?: string): Promise<Invoice | null>;
  // Increment access count (optional - stores that support it should implement)
  incrementAccess?(id: string): Promise<void>;
}

// Use discriminated union for better type safety
export type NanoRpcAccountHistoryResponse =
  | {
      account: string;
      history: Array<{
        type: string;
        account: string;
        amount: string;
        hash: string;
        confirmed: string;
        local_timestamp: string;
      }>;
    }
  | {
      account: string;
      history: string; // Empty string "" when there's no history
    };

export interface NanoRpcAccountInfoResponse {
  account: string;
  balance: string;
  confirmed_balance: string;
  pending: string;
  block_count: string;
}

export interface NanoRpcWorkGenerateResponse {
  work: string;
}

export interface NanoRpcAccountsPendingResponse {
  blocks: {
    [account: string]: {
      [hash: string]: string; // hash -> amount
    } | string; // Can be empty string "" when no pending blocks
  };
}

export interface InvoiceStatistics {
  total: number;
  pending: number;
  paid: number;
  used: number;
  expired: number;
  cancelled: number;
  refunded: number;
  totalAmountXno: string;
  totalAmountRaw: string;
}

