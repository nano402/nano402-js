import { Invoice, InvoiceStore } from "./types";
import { InvoiceNotFoundError } from "./errors";
import type { IndexStore, StoredInvoiceData } from "./indexStore";
import { FileIndexStore, MemoryIndexStore } from "./indexStore";

/**
 * MemoryInvoiceStore - Thread-safe in-memory implementation
 * 
 * ⚠️ WARNING: This implementation is for development/testing only.
 * For production, use a database-backed store with proper transaction support.
 * 
 * This implementation uses a simple mutex pattern to prevent race conditions
 * in single-threaded Node.js environments. For true multi-instance deployments,
 * use a database-backed store.
 */
export interface MemoryInvoiceStoreOptions {
  indexStore?: IndexStore; // Optional persistent index store
  indexStorePath?: string; // Path for file-based index store
}

export class MemoryInvoiceStore implements InvoiceStore {
  private invoices: Map<string, Invoice> = new Map();
  private resourceIndex: Map<string, string> = new Map();
  private ipResourceIndex: Map<string, Map<string, string>> = new Map(); // IP -> (resource -> invoice ID)
  private pendingLocks: Map<string, Promise<void>> = new Map();
  private indexStore: IndexStore;
  private indexInitialized: boolean = false;

  constructor(options?: MemoryInvoiceStoreOptions) {
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

  /**
   * Acquire a lock for a resource to prevent concurrent modifications
   */
  private async acquireLock(key: string): Promise<() => void> {
    // Wait for any existing lock to release
    while (this.pendingLocks.has(key)) {
      await this.pendingLocks.get(key);
    }

    // Create a new lock
    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.pendingLocks.set(key, lockPromise);

    return releaseLock;
  }

  async save(invoice: Invoice): Promise<void> {
    const releaseLock = await this.acquireLock(`save:${invoice.id}`);
    try {
      // Mark index as used in persistent store
      await this.indexStore.markIndexUsed(invoice.index);
      
      // Store invoice data in index store for recovery
      if (this.indexStore.storeInvoice) {
        const storedData: StoredInvoiceData = {
          id: invoice.id,
          index: invoice.index,
          nano_account: invoice.nano_account,
          amount_xno: invoice.amount_xno,
          amount_raw: invoice.amount_raw,
          created_at: invoice.created_at,
          expires_at: invoice.expires_at,
          status: invoice.status,
          tx_hash: invoice.tx_hash,
          paid_at: invoice.paid_at,
          sender_account: invoice.sender_account,
          resource: invoice.resource,
        };
        await this.indexStore.storeInvoice(storedData);
      }
      
      this.invoices.set(invoice.id, { ...invoice });
      this.resourceIndex.set(invoice.resource, invoice.id);
      
      // Track IP + resource combination if provided
      if (invoice.client_ip) {
        if (!this.ipResourceIndex.has(invoice.client_ip)) {
          this.ipResourceIndex.set(invoice.client_ip, new Map());
        }
        this.ipResourceIndex.get(invoice.client_ip)!.set(invoice.resource, invoice.id);
      }
    } finally {
      releaseLock();
      this.pendingLocks.delete(`save:${invoice.id}`);
    }
  }

  /**
   * Ensure invoices are recovered from index store before querying
   */
  private async ensureRecovered(): Promise<void> {
    if (this.indexInitialized) {
      return;
    }

    // Use a lock to prevent concurrent recovery attempts
    const recoveryKey = "recovery";
    const existingLock = this.pendingLocks.get(recoveryKey);
    if (existingLock) {
      // Another recovery is in progress, wait for it
      await existingLock;
      return;
    }

    // Create a new lock for recovery
    const recoveryPromise = (async () => {
      try {
        // Double-check after acquiring lock
        if (this.indexInitialized) {
          return;
        }

        // Try to recover invoices from index store if available
        if (this.indexStore.getAllInvoices) {
          const storedInvoices = await this.indexStore.getAllInvoices();
          for (const stored of storedInvoices) {
            // Mark index as used
            await this.indexStore.markIndexUsed(stored.index);
            
            // Reconstruct invoice in memory if not already present
            if (!this.invoices.has(stored.id)) {
              const invoice: Invoice = {
                id: stored.id,
                index: stored.index,
                resource: stored.resource || "",
                nano_account: stored.nano_account,
                amount_xno: stored.amount_xno,
                amount_raw: stored.amount_raw,
                created_at: stored.created_at,
                expires_at: stored.expires_at,
                status: stored.status,
                tx_hash: stored.tx_hash,
                paid_at: stored.paid_at,
                sender_account: stored.sender_account,
              };
              this.invoices.set(invoice.id, invoice);
              if (invoice.resource) {
                this.resourceIndex.set(invoice.resource, invoice.id);
              }
            }
          }
        }
        this.indexInitialized = true;
      } finally {
        this.pendingLocks.delete(recoveryKey);
      }
    })();

    this.pendingLocks.set(recoveryKey, recoveryPromise);
    await recoveryPromise;
  }

  async findById(id: string): Promise<Invoice | null> {
    await this.ensureRecovered();
    const invoice = this.invoices.get(id);
    return invoice ? { ...invoice } : null;
  }

  async findByResource(resource: string): Promise<Invoice | null> {
    await this.ensureRecovered();
    const id = this.resourceIndex.get(resource);
    if (!id) return null;
    const invoice = this.invoices.get(id);
    return invoice ? { ...invoice } : null;
  }

  async findPendingByResource(resource: string): Promise<Invoice | null> {
    await this.ensureRecovered();
    const id = this.resourceIndex.get(resource);
    if (!id) return null;
    const invoice = this.invoices.get(id);
    if (!invoice) return null;
    if (invoice.status === "pending") {
      // Check expiration
      if (new Date(invoice.expires_at) < new Date()) {
        return null; // Expired, treat as not found
      }
      return { ...invoice };
    }
    return null;
  }

  async update(id: string, updates: Partial<Invoice>): Promise<void> {
    const releaseLock = await this.acquireLock(`update:${id}`);
    try {
      const invoice = this.invoices.get(id);
      if (!invoice) {
        throw new InvoiceNotFoundError(id);
      }
      const updated = { ...invoice, ...updates };
      this.invoices.set(id, updated);
      this.resourceIndex.set(invoice.resource, id);
      
      // Update invoice data in index store if it supports it
      if (this.indexStore.storeInvoice) {
        const storedData: StoredInvoiceData = {
          id: updated.id,
          index: updated.index,
          nano_account: updated.nano_account,
          amount_xno: updated.amount_xno,
          amount_raw: updated.amount_raw,
          created_at: updated.created_at,
          expires_at: updated.expires_at,
          status: updated.status,
          tx_hash: updated.tx_hash,
          paid_at: updated.paid_at,
          sender_account: updated.sender_account,
          resource: updated.resource,
        };
        await this.indexStore.storeInvoice(storedData);
      }
      
      // Update IP tracking if IP changed
      if (updates.client_ip !== undefined) {
        // Remove old IP mapping if it exists
        if (invoice.client_ip) {
          const resourceMap = this.ipResourceIndex.get(invoice.client_ip);
          if (resourceMap) {
            resourceMap.delete(invoice.resource);
            if (resourceMap.size === 0) {
              this.ipResourceIndex.delete(invoice.client_ip);
            }
          }
        }
        // Add new IP mapping
        if (updates.client_ip) {
          if (!this.ipResourceIndex.has(updates.client_ip)) {
            this.ipResourceIndex.set(updates.client_ip, new Map());
          }
          this.ipResourceIndex.get(updates.client_ip)!.set(invoice.resource, id);
        }
      }
    } finally {
      releaseLock();
      this.pendingLocks.delete(`update:${id}`);
    }
  }

  async getNextIndex(): Promise<number> {
    // Ensure invoices are recovered first
    await this.ensureRecovered();

    // Get next index from persistent store (atomic)
    return await this.indexStore.getNextIndex();
  }

  /**
   * Get the highest used index
   */
  async getHighestIndex(): Promise<number> {
    return await this.indexStore.getHighestIndex();
  }

  /**
   * Check if an index has been used
   */
  async isIndexUsed(index: number): Promise<boolean> {
    return await this.indexStore.isIndexUsed(index);
  }

  /**
   * Get all used indexes
   */
  async getAllUsedIndexes(): Promise<number[]> {
    return await this.indexStore.getAllUsedIndexes();
  }

  async findAll(params?: { status?: Invoice["status"]; limit?: number; offset?: number }): Promise<Invoice[]> {
    await this.ensureRecovered();
    let invoices = Array.from(this.invoices.values());
    
    if (params?.status) {
      invoices = invoices.filter(inv => inv.status === params.status);
    }
    
    // Sort by created_at descending
    invoices.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    const offset = params?.offset || 0;
    const limit = params?.limit || invoices.length;
    
    return invoices.slice(offset, offset + limit).map(inv => ({ ...inv }));
  }

  async delete(id: string): Promise<void> {
    const releaseLock = await this.acquireLock(`delete:${id}`);
    try {
      const invoice = this.invoices.get(id);
      if (!invoice) {
        throw new InvoiceNotFoundError(id);
      }
      this.invoices.delete(id);
      // Only remove from resource index if this invoice is still mapped to this resource
      if (this.resourceIndex.get(invoice.resource) === id) {
        this.resourceIndex.delete(invoice.resource);
      }
      // Remove IP + resource mapping
      if (invoice.client_ip) {
        const resourceMap = this.ipResourceIndex.get(invoice.client_ip);
        if (resourceMap) {
          if (resourceMap.get(invoice.resource) === id) {
            resourceMap.delete(invoice.resource);
          }
          if (resourceMap.size === 0) {
            this.ipResourceIndex.delete(invoice.client_ip);
          }
        }
      }
    } finally {
      releaseLock();
      this.pendingLocks.delete(`delete:${id}`);
    }
  }

  async findByClientIp(ip: string, resource?: string): Promise<Invoice | null> {
    await this.ensureRecovered();
    const resourceMap = this.ipResourceIndex.get(ip);
    if (!resourceMap) return null;
    
    // If resource is specified, look up the specific resource
    if (resource) {
      const invoiceId = resourceMap.get(resource);
      if (!invoiceId) return null;
      
      const invoice = this.invoices.get(invoiceId);
      return invoice ? { ...invoice } : null;
    }
    
    // If no resource specified, return the first invoice for this IP
    // (This maintains backward compatibility but may need refinement)
    const firstInvoiceId = resourceMap.values().next().value;
    if (!firstInvoiceId) return null;
    
    const invoice = this.invoices.get(firstInvoiceId);
    return invoice ? { ...invoice } : null;
  }

  async incrementAccess(id: string): Promise<void> {
    const releaseLock = await this.acquireLock(`increment:${id}`);
    try {
      const invoice = this.invoices.get(id);
      if (!invoice) {
        throw new InvoiceNotFoundError(id);
      }
      const accessCount = (invoice.access_count || 0) + 1;
      await this.update(id, {
        access_count: accessCount,
        last_accessed_at: new Date().toISOString(),
      });
    } finally {
      releaseLock();
      this.pendingLocks.delete(`increment:${id}`);
    }
  }
}

