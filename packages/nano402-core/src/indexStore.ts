import { promises as fs } from "fs";
import { join } from "path";
import type { Invoice } from "./types";

/**
 * Minimal invoice data stored in index file for payment recovery
 */
export interface StoredInvoiceData {
  id: string;
  index: number;
  nano_account: string;
  amount_xno: string;
  amount_raw: string;
  created_at: string;
  expires_at: string;
  status: Invoice["status"];
  tx_hash?: string;
  paid_at?: string;
  sender_account?: string;
  resource?: string;
}

/**
 * Lightweight index storage interface
 * Tracks used indexes to prevent reuse after restarts
 * Can optionally store invoice data for payment recovery
 */
export interface IndexStore {
  /**
   * Get the next available index atomically
   */
  getNextIndex(): Promise<number>;

  /**
   * Get the highest used index
   */
  getHighestIndex(): Promise<number>;

  /**
   * Check if an index has been used
   */
  isIndexUsed(index: number): Promise<boolean>;

  /**
   * Mark an index as used
   */
  markIndexUsed(index: number): Promise<void>;

  /**
   * Get all used indexes (for verification/debugging)
   */
  getAllUsedIndexes(): Promise<number[]>;

  /**
   * Store invoice data for payment recovery (optional)
   */
  storeInvoice?(invoice: StoredInvoiceData): Promise<void>;

  /**
   * Get invoice data by ID (optional)
   */
  getInvoice?(id: string): Promise<StoredInvoiceData | null>;

  /**
   * Get invoice data by index (optional)
   */
  getInvoiceByIndex?(index: number): Promise<StoredInvoiceData | null>;

  /**
   * Get all stored invoices (optional)
   */
  getAllInvoices?(): Promise<StoredInvoiceData[]>;
}

/**
 * File-based index store using JSON
 * Lightweight, no external dependencies
 */
export class FileIndexStore implements IndexStore {
  private filePath: string;
  private indexes: Set<number>;
  private highestIndex: number;
  private initialized: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath || join(process.cwd(), ".nano402-db.json");
    this.indexes = new Set();
    this.highestIndex = -1;
  }

  private invoices: Map<string, StoredInvoiceData> = new Map();
  private indexToInvoice: Map<number, string> = new Map();

  /**
   * Initialize by loading from file
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(data) as {
        indexes: number[];
        highestIndex: number;
        invoices?: StoredInvoiceData[];
      };
      this.indexes = new Set(parsed.indexes || []);
      this.highestIndex = parsed.highestIndex ?? -1;
      
      // Load invoice data if present
      if (parsed.invoices && Array.isArray(parsed.invoices)) {
        for (const invoice of parsed.invoices) {
          this.invoices.set(invoice.id, invoice);
          this.indexToInvoice.set(invoice.index, invoice.id);
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      // Silently handle ENOENT (file doesn't exist) errors
      this.indexes = new Set();
      this.highestIndex = -1;
      this.invoices.clear();
      this.indexToInvoice.clear();
    }

    this.initialized = true;
  }

  /**
   * Persist indexes and invoices to file
   */
  private async persist(): Promise<void> {
    // Chain writes to prevent race conditions
    this.writeLock = this.writeLock.then(async () => {
      const data = {
        indexes: Array.from(this.indexes),
        highestIndex: this.highestIndex,
        invoices: Array.from(this.invoices.values()),
        updatedAt: new Date().toISOString(),
      };

      // Write to temp file first, then rename (atomic on most filesystems)
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.rename(tempPath, this.filePath);
    });

    await this.writeLock;
  }

  async getNextIndex(): Promise<number> {
    await this.initialize();

    // Find next unused index
    let nextIndex = this.highestIndex + 1;
    while (this.indexes.has(nextIndex)) {
      nextIndex++;
    }

    await this.markIndexUsed(nextIndex);
    return nextIndex;
  }

  async getHighestIndex(): Promise<number> {
    await this.initialize();
    return this.highestIndex;
  }

  async isIndexUsed(index: number): Promise<boolean> {
    await this.initialize();
    return this.indexes.has(index);
  }

  async markIndexUsed(index: number): Promise<void> {
    await this.initialize();

    if (!this.indexes.has(index)) {
      this.indexes.add(index);
      if (index > this.highestIndex) {
        this.highestIndex = index;
      }
      await this.persist();
    }
  }

  async getAllUsedIndexes(): Promise<number[]> {
    await this.initialize();
    return Array.from(this.indexes).sort((a, b) => a - b);
  }

  /**
   * Store invoice data for payment recovery
   */
  async storeInvoice(invoice: StoredInvoiceData): Promise<void> {
    await this.initialize();
    this.invoices.set(invoice.id, invoice);
    this.indexToInvoice.set(invoice.index, invoice.id);
    await this.persist();
  }

  /**
   * Get invoice data by ID
   */
  async getInvoice(id: string): Promise<StoredInvoiceData | null> {
    await this.initialize();
    return this.invoices.get(id) || null;
  }

  /**
   * Get invoice data by index
   */
  async getInvoiceByIndex(index: number): Promise<StoredInvoiceData | null> {
    await this.initialize();
    const invoiceId = this.indexToInvoice.get(index);
    if (!invoiceId) return null;
    return this.invoices.get(invoiceId) || null;
  }

  /**
   * Get all stored invoices
   */
  async getAllInvoices(): Promise<StoredInvoiceData[]> {
    await this.initialize();
    return Array.from(this.invoices.values());
  }
}

// Type for better-sqlite3 Database (loaded dynamically)
type Database = {
  prepare(sql: string): any;
  exec(sql: string): void;
  pragma(sql: string, options?: any): any;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
};

/**
 * SQLite-based index store
 * More robust, supports concurrent access better
 * Requires 'better-sqlite3' or 'sql.js' package
 */
export class SqliteIndexStore implements IndexStore {
  private db!: Database; // Initialized in initialize()
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || join(process.cwd(), ".nano402-db.db");
    this.initialize();
  }

  private initialize(): void {
    try {
      // Try to use better-sqlite3 if available
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath);

      // Create table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS indexes (
          index_number INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_indexes_number ON indexes(index_number);
      `);
    } catch (error) {
      throw new Error(
        `SQLite not available. Install 'better-sqlite3': npm install better-sqlite3\n${error}`
      );
    }
  }

  async getNextIndex(): Promise<number> {
    // Use a transaction to ensure atomicity
    const transaction = this.db.transaction(() => {
      const maxStmt = this.db.prepare("SELECT MAX(index_number) as max FROM indexes");
      const maxResult = maxStmt.get() as { max: number | null };
      const nextIndex = (maxResult.max ?? -1) + 1;
      
      const insertStmt = this.db.prepare("INSERT INTO indexes (index_number) VALUES (?)");
      insertStmt.run(nextIndex);
      
      return nextIndex;
    });
    
    return transaction();
  }

  async getHighestIndex(): Promise<number> {
    const stmt = this.db.prepare("SELECT MAX(index_number) as max FROM indexes");
    const result = stmt.get() as { max: number | null };
    return result.max ?? -1;
  }

  async isIndexUsed(index: number): Promise<boolean> {
    const stmt = this.db.prepare(
      "SELECT 1 FROM indexes WHERE index_number = ?"
    );
    const result = stmt.get(index);
    return !!result;
  }

  async markIndexUsed(index: number): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO indexes (index_number) VALUES (?)"
    );
    stmt.run(index);
  }

  async getAllUsedIndexes(): Promise<number[]> {
    const stmt = this.db.prepare(
      "SELECT index_number FROM indexes ORDER BY index_number"
    );
    const results = stmt.all() as { index_number: number }[];
    return results.map((r) => r.index_number);
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

/**
 * In-memory index store (for testing)
 */
export class MemoryIndexStore implements IndexStore {
  private indexes: Set<number> = new Set();
  private highestIndex: number = -1;

  async getNextIndex(): Promise<number> {
    const nextIndex = this.highestIndex + 1;
    await this.markIndexUsed(nextIndex);
    return nextIndex;
  }

  async getHighestIndex(): Promise<number> {
    return this.highestIndex;
  }

  async isIndexUsed(index: number): Promise<boolean> {
    return this.indexes.has(index);
  }

  async markIndexUsed(index: number): Promise<void> {
    if (!this.indexes.has(index)) {
      this.indexes.add(index);
      if (index > this.highestIndex) {
        this.highestIndex = index;
      }
    }
  }

  async getAllUsedIndexes(): Promise<number[]> {
    return Array.from(this.indexes).sort((a, b) => a - b);
  }
}

