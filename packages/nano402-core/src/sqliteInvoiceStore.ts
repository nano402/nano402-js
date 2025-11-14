import { Invoice, InvoiceStore, InvoiceStatistics } from "./types";
import { InvoiceNotFoundError } from "./errors";
import type { IndexStore } from "./indexStore";
import { FileIndexStore } from "./indexStore";
import { join } from "path";

// Type for better-sqlite3 Database (loaded dynamically)
type Database = {
  prepare(sql: string): any;
  exec(sql: string): void;
  pragma(sql: string, options?: any): any;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
};

/**
 * SQLite-based invoice store
 *
 * Provides persistent storage for invoices using SQLite database.
 * Requires 'better-sqlite3' package to be installed.
 *
 * @example
 * ```typescript
 * import { SqliteInvoiceStore } from "nano402";
 *
 * const store = new SqliteInvoiceStore({
 *   dbPath: "./data/invoices.db"
 * });
 * ```
 */
export interface SqliteInvoiceStoreOptions {
  dbPath?: string; // Path to SQLite database file (defaults to .nano402-invoices.db)
  indexStore?: IndexStore; // Optional index store (defaults to FileIndexStore)
  indexStorePath?: string; // Path for file-based index store
}

export class SqliteInvoiceStore implements InvoiceStore {
  private db!: Database; // Initialized in initialize()
  private dbPath: string;
  private indexStore!: IndexStore; // Initialized in constructor
  private indexInitialized: boolean = false;

  constructor(options?: SqliteInvoiceStoreOptions) {
    this.dbPath =
      options?.dbPath || join(process.cwd(), ".nano402-invoices.db");
    this.initialize();

    // Use provided index store, or create a file-based one, or fall back to memory
    if (options?.indexStore) {
      this.indexStore = options.indexStore;
    } else if (options?.indexStorePath !== undefined) {
      this.indexStore = new FileIndexStore(options.indexStorePath);
    } else {
      // Default: use file-based store in current directory
      this.indexStore = new FileIndexStore();
    }
  }

  private initialize(): void {
    try {
      // Try to use better-sqlite3 if available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrency
      this.db.pragma("journal_mode = WAL");

      // Create invoices table with comprehensive schema
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS invoices (
          id TEXT PRIMARY KEY,
          index_number INTEGER NOT NULL,
          resource TEXT NOT NULL,
          nano_account TEXT NOT NULL,
          amount_xno TEXT NOT NULL,
          amount_raw TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'used', 'expired', 'cancelled', 'refunded')),
          tx_hash TEXT,
          paid_at TEXT,
          sender_account TEXT,
          proof_expires_at TEXT,
          client_ip TEXT,
          access_count INTEGER DEFAULT 0,
          last_accessed_at TEXT,
          user_agent TEXT,
          referer TEXT,
          metadata TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- Indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_invoices_resource ON invoices(resource);
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
        CREATE INDEX IF NOT EXISTS idx_invoices_nano_account ON invoices(nano_account);
        CREATE INDEX IF NOT EXISTS idx_invoices_client_ip ON invoices(client_ip);
        CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
        CREATE INDEX IF NOT EXISTS idx_invoices_paid_at ON invoices(paid_at);
        CREATE INDEX IF NOT EXISTS idx_invoices_index_number ON invoices(index_number);
        
        -- Composite index for IP + resource lookups
        CREATE INDEX IF NOT EXISTS idx_invoices_ip_resource ON invoices(client_ip, resource) WHERE client_ip IS NOT NULL;
        
        -- Index for pending invoices by resource (common query)
        CREATE INDEX IF NOT EXISTS idx_invoices_pending_resource ON invoices(resource, status) WHERE status = 'pending';
      `);
    } catch (error) {
      throw new Error(
        `SQLite not available. Install 'better-sqlite3': npm install better-sqlite3\n${error}`
      );
    }
  }

  async save(invoice: Invoice): Promise<void> {
    // Mark index as used in persistent store
    await this.indexStore.markIndexUsed(invoice.index);

    const stmt = this.db.prepare(`
      INSERT INTO invoices (
        id, index_number, resource, nano_account, amount_xno, amount_raw,
        created_at, expires_at, status, tx_hash, paid_at, sender_account,
        proof_expires_at, client_ip, access_count, last_accessed_at,
        user_agent, referer, metadata, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        index_number = excluded.index_number,
        resource = excluded.resource,
        nano_account = excluded.nano_account,
        amount_xno = excluded.amount_xno,
        amount_raw = excluded.amount_raw,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        status = excluded.status,
        tx_hash = excluded.tx_hash,
        paid_at = excluded.paid_at,
        sender_account = excluded.sender_account,
        proof_expires_at = excluded.proof_expires_at,
        client_ip = excluded.client_ip,
        access_count = excluded.access_count,
        last_accessed_at = excluded.last_accessed_at,
        user_agent = excluded.user_agent,
        referer = excluded.referer,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `);

    const metadataJson = invoice.metadata
      ? JSON.stringify(invoice.metadata)
      : null;
    stmt.run(
      invoice.id,
      invoice.index,
      invoice.resource,
      invoice.nano_account,
      invoice.amount_xno,
      invoice.amount_raw,
      invoice.created_at,
      invoice.expires_at,
      invoice.status,
      invoice.tx_hash || null,
      invoice.paid_at || null,
      invoice.sender_account || null,
      invoice.proof_expires_at || null,
      invoice.client_ip || null,
      invoice.access_count || 0,
      invoice.last_accessed_at || null,
      invoice.user_agent || null,
      invoice.referer || null,
      metadataJson,
      new Date().toISOString()
    );
  }

  async findById(id: string): Promise<Invoice | null> {
    const stmt = this.db.prepare("SELECT * FROM invoices WHERE id = ?");
    const row = stmt.get(id);
    if (!row) return null;
    return this.rowToInvoice(row);
  }

  async findByResource(resource: string): Promise<Invoice | null> {
    // Prioritize paid/used invoices over pending ones
    // First try to find a paid or used invoice
    const paidStmt = this.db.prepare(`
      SELECT * FROM invoices 
      WHERE resource = ? AND status IN ('paid', 'used')
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    const paidRow = paidStmt.get(resource);
    if (paidRow) {
      return this.rowToInvoice(paidRow);
    }

    // If no paid/used invoice, return the most recent invoice (could be pending)
    const stmt = this.db.prepare(
      "SELECT * FROM invoices WHERE resource = ? ORDER BY created_at DESC LIMIT 1"
    );
    const row = stmt.get(resource);
    if (!row) return null;
    return this.rowToInvoice(row);
  }

  async findPendingByResource(resource: string): Promise<Invoice | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM invoices 
      WHERE resource = ? AND status = 'pending' AND expires_at > datetime('now')
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    const row = stmt.get(resource);
    if (!row) return null;
    return this.rowToInvoice(row);
  }

  async update(id: string, updates: Partial<Invoice>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new InvoiceNotFoundError(id);
    }

    // Build dynamic update query
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.tx_hash !== undefined) {
      fields.push("tx_hash = ?");
      values.push(updates.tx_hash || null);
    }
    if (updates.paid_at !== undefined) {
      fields.push("paid_at = ?");
      values.push(updates.paid_at || null);
    }
    if (updates.sender_account !== undefined) {
      fields.push("sender_account = ?");
      values.push(updates.sender_account || null);
    }
    if (updates.proof_expires_at !== undefined) {
      fields.push("proof_expires_at = ?");
      values.push(updates.proof_expires_at || null);
    }
    if (updates.client_ip !== undefined) {
      fields.push("client_ip = ?");
      values.push(updates.client_ip || null);
    }
    if (updates.access_count !== undefined) {
      fields.push("access_count = ?");
      values.push(updates.access_count);
    }
    if (updates.last_accessed_at !== undefined) {
      fields.push("last_accessed_at = ?");
      values.push(updates.last_accessed_at || null);
    }
    if (updates.user_agent !== undefined) {
      fields.push("user_agent = ?");
      values.push(updates.user_agent || null);
    }
    if (updates.referer !== undefined) {
      fields.push("referer = ?");
      values.push(updates.referer || null);
    }
    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    if (fields.length === 0) {
      return; // No updates
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const stmt = this.db.prepare(
      `UPDATE invoices SET ${fields.join(", ")} WHERE id = ?`
    );
    stmt.run(...values);
  }

  async getNextIndex(): Promise<number> {
    // Initialize: sync database invoices with persistent index store
    if (!this.indexInitialized) {
      const stmt = this.db.prepare("SELECT index_number FROM invoices");
      const rows = stmt.all() as { index_number: number }[];
      // Mark all existing invoice indexes as used in the persistent store
      for (const row of rows) {
        await this.indexStore.markIndexUsed(row.index_number);
      }
      this.indexInitialized = true;
    }

    // Get next index from persistent store (atomic)
    return await this.indexStore.getNextIndex();
  }

  async findAll(params?: {
    status?: Invoice["status"];
    limit?: number;
    offset?: number;
  }): Promise<Invoice[]> {
    let query = "SELECT * FROM invoices WHERE 1=1";
    const values: any[] = [];

    if (params?.status) {
      query += " AND status = ?";
      values.push(params.status);
    }

    query += " ORDER BY created_at DESC";

    if (params?.limit) {
      query += " LIMIT ?";
      values.push(params.limit);
    }
    if (params?.offset) {
      query += " OFFSET ?";
      values.push(params.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...values) as any[];
    return rows.map((row) => this.rowToInvoice(row));
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM invoices WHERE id = ?");
    const result = stmt.run(id);
    if (result.changes === 0) {
      throw new InvoiceNotFoundError(id);
    }
  }

  async findByClientIp(ip: string, resource?: string): Promise<Invoice | null> {
    let query = "SELECT * FROM invoices WHERE client_ip = ?";
    const values: any[] = [ip];

    if (resource) {
      query += " AND resource = ?";
      values.push(resource);
    }

    query += " ORDER BY created_at DESC LIMIT 1";

    const stmt = this.db.prepare(query);
    const row = stmt.get(...values);
    if (!row) return null;
    return this.rowToInvoice(row);
  }

  /**
   * Convert database row to Invoice object
   */
  private rowToInvoice(row: any): Invoice {
    return {
      id: row.id,
      index: row.index_number,
      resource: row.resource,
      nano_account: row.nano_account,
      amount_xno: row.amount_xno,
      amount_raw: row.amount_raw,
      created_at: row.created_at,
      expires_at: row.expires_at,
      status: row.status,
      tx_hash: row.tx_hash || undefined,
      paid_at: row.paid_at || undefined,
      sender_account: row.sender_account || undefined,
      proof_expires_at: row.proof_expires_at || undefined,
      client_ip: row.client_ip || undefined,
      access_count: row.access_count || undefined,
      last_accessed_at: row.last_accessed_at || undefined,
      user_agent: row.user_agent || undefined,
      referer: row.referer || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Increment access count and update last accessed timestamp
   */
  async incrementAccess(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE invoices 
      SET access_count = COALESCE(access_count, 0) + 1,
          last_accessed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(id);
    if (result.changes === 0) {
      throw new InvoiceNotFoundError(id);
    }
  }

  /**
   * Get invoice statistics
   */
  async getStatistics(): Promise<InvoiceStatistics> {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) as used,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) as refunded,
        SUM(CAST(amount_xno AS REAL)) as totalAmountXno,
        SUM(CAST(amount_raw AS INTEGER)) as totalAmountRaw
      FROM invoices
    `);
    const result = stmt.get() as any;
    return {
      total: result.total || 0,
      pending: result.pending || 0,
      paid: result.paid || 0,
      used: result.used || 0,
      expired: result.expired || 0,
      cancelled: result.cancelled || 0,
      refunded: result.refunded || 0,
      totalAmountXno: result.totalAmountXno?.toString() || "0",
      totalAmountRaw: result.totalAmountRaw?.toString() || "0",
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
