import { v4 as uuidv4 } from "uuid";
import { NanoRpcClient } from "./rpcClient";
import { MemoryInvoiceStore } from "./memoryInvoiceStore";
import { deriveNanoAccount } from "./nanoDerivation";
import { xnoToRaw } from "./xnoUtils";
import {
  Invoice,
  InvoiceStatus,
  Nano402Config,
  CreateInvoiceParams,
  InvoiceStore,
  PaymentVerificationOptions,
  InvoiceStatistics,
  WebhookConfig,
} from "./types";
import {
  InvoiceNotFoundError,
  InvoiceNotPaidError,
  InvoiceExpiredError,
  InvalidSeedError,
  ConcurrentModificationError,
} from "./errors";
import type { IndexStore } from "./indexStore";
import { FileIndexStore } from "./indexStore";

// Generate Nano URI
function generateNanoUri(account: string, amountRaw: string): string {
  return `nano:${account}?amount=${amountRaw}`;
}

/**
 * Validate seed format (64-character hex string)
 */
function validateSeed(seed: string): void {
  if (!seed || typeof seed !== "string") {
    throw new InvalidSeedError("Seed must be a non-empty string");
  }

  if (seed.length !== 64) {
    throw new InvalidSeedError(
      `Seed must be exactly 64 characters, got ${seed.length}`
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new InvalidSeedError("Seed must be a valid hexadecimal string");
  }
}

export class Nano402 {
  private seed: string;
  private rpcClient: NanoRpcClient;
  private invoiceStore: InvoiceStore;
  private verifySender: boolean;
  private allowedSenders?: string[];
  private proofExpirationSeconds: number;
  private acceptPending: boolean;
  private webhooks: WebhookConfig[] = [];

  constructor(config: Nano402Config) {
    // Validate seed
    validateSeed(config.walletSeed);
    this.seed = config.walletSeed;

    // Initialize RPC client with config
    this.rpcClient = new NanoRpcClient({
      rpcUrl: config.nanoRpcUrl,
      timeout: config.rpcTimeout,
      retries: config.rpcRetries,
      retryDelay: config.rpcRetryDelay,
      auth: config.rpcAuth,
      cacheEnabled: config.rpcCacheEnabled,
      cacheTtl: config.rpcCacheTtl,
    });

    // Initialize invoice store
    if (config.invoiceStore) {
      this.invoiceStore = config.invoiceStore;
    } else {
      // Try to use SQLite if available, otherwise fall back to MemoryInvoiceStore
      let invoiceStore: InvoiceStore;
      
      try {
        // Check if better-sqlite3 is available
        require("better-sqlite3");
        // SQLite is available, use SqliteInvoiceStore
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { SqliteInvoiceStore } = require("./sqliteInvoiceStore");
        let indexStore: IndexStore | undefined;

        if (config.indexStore) {
          indexStore = config.indexStore;
        } else if (config.indexStorePath !== undefined) {
          indexStore = new FileIndexStore(config.indexStorePath);
        } else {
          indexStore = new FileIndexStore();
        }

        invoiceStore = new SqliteInvoiceStore({
          dbPath: config.dbPath,
          indexStore,
          indexStorePath: config.indexStorePath,
        });
      } catch (error) {
        // SQLite not available, use MemoryInvoiceStore
        let indexStore: IndexStore | undefined;

        if (config.indexStore) {
          indexStore = config.indexStore;
        } else if (config.indexStorePath !== undefined) {
          // Use file-based index store at specified path
          indexStore = new FileIndexStore(config.indexStorePath);
        } else {
          // Default: use file-based index store in current directory
          indexStore = new FileIndexStore();
        }

        invoiceStore = new MemoryInvoiceStore({
          indexStore,
          indexStorePath: config.indexStorePath,
        });
      }

      this.invoiceStore = invoiceStore;
    }

    // Payment verification options
    this.verifySender = config.verifySender ?? false;
    this.allowedSenders = config.allowedSenders;
    this.proofExpirationSeconds = config.proofExpirationSeconds ?? 3600;
    this.acceptPending = config.acceptPending ?? true; // Default to true
  }

  /**
   * Register webhook configuration
   */
  registerWebhook(config: WebhookConfig): void {
    this.webhooks.push(config);
  }

  /**
   * Trigger webhook event
   */
  private async triggerWebhook(
    event: WebhookConfig["events"][number],
    invoice: Invoice
  ): Promise<void> {
    const relevantWebhooks = this.webhooks.filter((wh) =>
      wh.events.includes(event)
    );

    await Promise.allSettled(
      relevantWebhooks.map(async (webhook) => {
        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(webhook.secret && {
                "X-Webhook-Secret": webhook.secret,
              }),
            },
            body: JSON.stringify({
              event,
              invoice,
              timestamp: new Date().toISOString(),
            }),
          });

          if (!response.ok) {
            console.error(
              `Webhook failed for ${webhook.url}: ${response.statusText}`
            );
          }
        } catch (error) {
          console.error(`Webhook error for ${webhook.url}:`, error);
        }
      })
    );
  }

  /**
   * Derive a Nano account from the seed using an index
   */
  private deriveAccount(index: number): string {
    return deriveNanoAccount(this.seed, index);
  }

  /**
   * Create a new invoice with atomic operation to prevent race conditions
   */
  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const {
      resource,
      amount_xno,
      ttlSeconds = 3600,
      proofExpirationSeconds,
    } = params;

    // Validate amount
    const amount_raw = xnoToRaw(amount_xno);

    // Use atomic findPendingByResource to check for existing pending invoice
    let existing = await this.invoiceStore.findPendingByResource(resource);

    if (existing) {
      // Found a pending invoice that's not expired
      return existing;
    }

    // Get next index atomically
    const index = await this.invoiceStore.getNextIndex();
    const nano_account = this.deriveAccount(index);
    const now = new Date();
    const expires_at = new Date(now.getTime() + ttlSeconds * 1000);
    const proof_expires_at = proofExpirationSeconds
      ? new Date(now.getTime() + proofExpirationSeconds * 1000)
      : new Date(now.getTime() + this.proofExpirationSeconds * 1000);

    // Check if invoice is already expired at creation time
    const isExpired = expires_at < now;

    const invoice: Invoice = {
      id: uuidv4(),
      index,
      resource,
      nano_account,
      amount_xno,
      amount_raw,
      created_at: now.toISOString(),
      expires_at: expires_at.toISOString(),
      proof_expires_at: proof_expires_at.toISOString(),
      status: isExpired ? "expired" : "pending",
    };

    // Double-check for race condition before saving
    const doubleCheck = await this.invoiceStore.findPendingByResource(resource);
    if (doubleCheck) {
      // Another request created an invoice, return that one
      return doubleCheck;
    }

    await this.invoiceStore.save(invoice);
    if (isExpired) {
      await this.triggerWebhook("invoice.expired", invoice);
    } else {
      await this.triggerWebhook("invoice.created", invoice);
    }
    return invoice;
  }

  /**
   * Get invoice status
   */
  async getStatus(id: string): Promise<InvoiceStatus> {
    const invoice = await this.invoiceStore.findById(id);
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }

    // Check expiration
    if (
      invoice.status === "pending" &&
      new Date(invoice.expires_at) < new Date()
    ) {
      await this.invoiceStore.update(id, { status: "expired" });
      await this.triggerWebhook("invoice.expired", {
        ...invoice,
        status: "expired",
      });
      return "expired";
    }

    return invoice.status;
  }

  /**
   * Verify payment for an invoice with enhanced validation
   */
  async verifyPayment(
    id: string,
    proofTxHash?: string,
    options?: PaymentVerificationOptions
  ): Promise<boolean> {
    const invoice = await this.invoiceStore.findById(id);
    if (!invoice) {
      return false;
    }

    // Check expiration
    if (new Date(invoice.expires_at) < new Date()) {
      await this.invoiceStore.update(id, { status: "expired" });
      await this.triggerWebhook("invoice.expired", {
        ...invoice,
        status: "expired",
      });
      return false;
    }

    // Check proof expiration if set
    if (
      invoice.proof_expires_at &&
      new Date(invoice.proof_expires_at) < new Date()
    ) {
      return false;
    }

    // If already paid or used, return true
    if (invoice.status === "paid" || invoice.status === "used") {
      return true;
    }

    try {
      const acceptPendingBlocks =
        options?.acceptPending ?? this.acceptPending ?? true;
      const requiredAmount = BigInt(invoice.amount_raw);
      const invoiceCreatedAt = new Date(invoice.created_at).getTime();

      // OPTIMIZED: Check pending blocks first (works for both new and existing accounts)
      if (acceptPendingBlocks) {
        try {
          const pendingResponse = await this.rpcClient.accountsPending(
            invoice.nano_account,
            10
          );

          const accountBlocks = pendingResponse.blocks?.[invoice.nano_account];

          if (accountBlocks && typeof accountBlocks === "object") {
            const blocks = Object.entries(accountBlocks);

            for (const [hash, amountOrObj] of blocks) {
              // If proofTxHash is provided, it must match this hash exactly
              if (proofTxHash && hash !== proofTxHash) {
                continue; // Skip this block, hash doesn't match
              }

              // Extract amount and sender
              let amountStr: string;
              let senderAccount: string | undefined;
              
              if (typeof amountOrObj === "string") {
                amountStr = amountOrObj;
              } else if (typeof amountOrObj === "object" && amountOrObj !== null) {
                amountStr = (amountOrObj as any).amount;
                senderAccount = (amountOrObj as any).source;
              } else {
                continue;
              }

              const pendingAmount = BigInt(amountStr);

              // Verify amount is sufficient
              if (pendingAmount < requiredAmount) {
                continue;
              }

              // Verify timestamp if requested
              const verifyTimestamp = options?.verifyTimestamp !== false; // Default to true
              if (verifyTimestamp) {
                // Pending blocks don't have timestamps, but we can check if invoice was created before now
                // This is a basic check - pending blocks are recent by nature
              }

              // Verify sender if requested
              const verifySender =
                options?.verifySender ?? this.verifySender ?? false;
              if (verifySender && senderAccount) {
                const allowedSenders =
                  options?.allowedSenders ?? this.allowedSenders;
                if (allowedSenders && allowedSenders.length > 0) {
                  if (!allowedSenders.includes(senderAccount)) {
                    continue; // Sender not allowed
                  }
                }
              }

              // If we get here, the pending block is valid
              // If proofTxHash was provided, we've already verified it matches
              const paidAt = new Date().toISOString();
              await this.invoiceStore.update(id, {
                status: "paid",
                tx_hash: hash,
                paid_at: paidAt,
                sender_account: senderAccount,
              });

              const updatedInvoice = await this.invoiceStore.findById(id);
              if (updatedInvoice) {
                await this.triggerWebhook("invoice.paid", updatedInvoice);
              }

              return true;
            }
          }

          // If proofTxHash was provided but no matching pending block found, continue to check history
        } catch (error) {
          // Pending check failed, will check history below
        }
      }

      // Check account history for confirmed transactions
      const history = await this.rpcClient.accountHistory(
        invoice.nano_account,
        50
      );

      // Handle case where history might be empty string or not an array
      let historyArray: Array<{
        type: string;
        account: string;
        amount: string;
        hash: string;
        confirmed: string;
        local_timestamp: string;
      }> = [];

      if ("history" in history && Array.isArray(history.history)) {
        historyArray = history.history;
      } else if ("history" in history && typeof history.history === "string") {
        const historyStr = history.history;
        if (historyStr.length > 0) {
          try {
            const parsed = JSON.parse(historyStr);
            historyArray = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            // If parsing fails, treat as empty
            historyArray = [];
          }
        }
      }

      // Look for matching transaction
      const matchingTx = historyArray.find((tx) => {
        // If proofTxHash is provided, must match by hash AND be a valid payment
        if (proofTxHash) {
          // Hash must match exactly
          if (tx.hash !== proofTxHash) {
            return false;
          }
          // Continue to validate it's a valid payment transaction below
        }

        // Check if transaction is a receive
        if (tx.type !== "receive") {
          return false;
        }

        // Accept confirmed transactions, or pending if acceptPendingBlocks is true
        const isConfirmed = tx.confirmed === "true";
        const isPending =
          tx.confirmed === "false" || tx.confirmed === undefined;

        if (!isConfirmed && !(acceptPendingBlocks && isPending)) {
          return false;
        }

        const txAmount = BigInt(tx.amount);
        if (txAmount < requiredAmount) {
          return false;
        }

        // Verify timestamp if requested
        const verifyTimestamp = options?.verifyTimestamp !== false; // Default to true
        if (verifyTimestamp && tx.local_timestamp) {
          const txTimestamp = parseInt(tx.local_timestamp, 10) * 1000; // Convert to milliseconds
          if (txTimestamp < invoiceCreatedAt) {
            // Transaction happened before invoice creation
            return false;
          }
        }

        // Verify sender if requested
        const verifySender =
          options?.verifySender ?? this.verifySender ?? false;
        if (verifySender) {
          const allowedSenders =
            options?.allowedSenders ?? this.allowedSenders;
          if (allowedSenders && allowedSenders.length > 0) {
            if (!allowedSenders.includes(tx.account)) {
              return false;
            }
          }
        }

        // If proofTxHash was provided, we've validated it matches and is valid
        // If no proofTxHash, accept any valid receive transaction
        return true;
      });

      if (matchingTx) {
        // Verify amount
        const txAmount = BigInt(matchingTx.amount);
        const isConfirmed = matchingTx.confirmed === "true";
        const isPending =
          matchingTx.confirmed === "false" ||
          matchingTx.confirmed === undefined;

        // Accept if amount matches and (confirmed OR pending with acceptPendingBlocks)
        if (
          txAmount >= requiredAmount &&
          (isConfirmed || (acceptPendingBlocks && isPending))
        ) {
          const paidAt = new Date().toISOString();
          await this.invoiceStore.update(id, {
            status: "paid",
            tx_hash: matchingTx.hash,
            paid_at: paidAt,
            sender_account: matchingTx.account,
          });

          const updatedInvoice = await this.invoiceStore.findById(id);
          if (updatedInvoice) {
            await this.triggerWebhook("invoice.paid", updatedInvoice);
          }

          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("Error verifying payment:", error);
      return false;
    }
  }

  /**
   * Mark invoice as used
   */
  async markUsed(id: string): Promise<void> {
    const invoice = await this.invoiceStore.findById(id);
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }

    if (invoice.status !== "paid") {
      throw new InvoiceNotPaidError(id);
    }

    await this.invoiceStore.update(id, { status: "used" });
  }

  /**
   * Cancel a pending invoice
   */
  async cancelInvoice(id: string): Promise<void> {
    const invoice = await this.invoiceStore.findById(id);
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }

    if (invoice.status !== "pending") {
      throw new Error(
        `Cannot cancel invoice ${id} with status ${invoice.status}`
      );
    }

    await this.invoiceStore.update(id, { status: "cancelled" });
    await this.triggerWebhook("invoice.cancelled", {
      ...invoice,
      status: "cancelled",
    });
  }

  /**
   * Refund a paid invoice
   */
  async refundInvoice(id: string): Promise<void> {
    const invoice = await this.invoiceStore.findById(id);
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }

    if (invoice.status !== "paid" && invoice.status !== "used") {
      throw new Error(
        `Cannot refund invoice ${id} with status ${invoice.status}`
      );
    }

    await this.invoiceStore.update(id, { status: "refunded" });
    await this.triggerWebhook("invoice.refunded", {
      ...invoice,
      status: "refunded",
    });
  }

  /**
   * Get invoice by ID
   */
  async getInvoice(id: string): Promise<Invoice | null> {
    return this.invoiceStore.findById(id);
  }

  /**
   * Get invoice by resource
   */
  async getInvoiceByResource(resource: string): Promise<Invoice | null> {
    return this.invoiceStore.findByResource(resource);
  }

  /**
   * Get invoice by client IP address
   */
  async getInvoiceByClientIp(
    ip: string,
    resource?: string
  ): Promise<Invoice | null> {
    return this.invoiceStore.findByClientIp(ip, resource);
  }

  /**
   * Update invoice with client IP
   */
  async updateInvoiceClientIp(invoiceId: string, ip: string): Promise<void> {
    await this.invoiceStore.update(invoiceId, { client_ip: ip });
  }

  /**
   * Increment access count for an invoice
   */
  async incrementInvoiceAccess(invoiceId: string): Promise<void> {
    const invoice = await this.invoiceStore.findById(invoiceId);
    if (!invoice) {
      throw new InvoiceNotFoundError(invoiceId);
    }
    const currentCount = (invoice.access_count || 0) + 1;
    await this.invoiceStore.update(invoiceId, {
      access_count: currentCount,
      last_accessed_at: new Date().toISOString(),
    });
  }

  /**
   * Clear RPC cache for an account (useful after payment)
   */
  async clearRpcCache(account: string): Promise<void> {
    // Access the cache through the RPC client
    if (this.rpcClient && "clearCache" in this.rpcClient) {
      (this.rpcClient as any).clearCache(account);
    }
  }

  /**
   * List all invoices with optional filtering
   */
  async listInvoices(params?: {
    status?: InvoiceStatus;
    limit?: number;
    offset?: number;
  }): Promise<Invoice[]> {
    return this.invoiceStore.findAll(params);
  }

  /**
   * Get invoice statistics
   */
  async getStatistics(): Promise<InvoiceStatistics> {
    const allInvoices = await this.invoiceStore.findAll();
    const stats: InvoiceStatistics = {
      total: allInvoices.length,
      pending: 0,
      paid: 0,
      used: 0,
      expired: 0,
      cancelled: 0,
      refunded: 0,
      totalAmountXno: "0",
      totalAmountRaw: "0",
    };

    let totalRaw = BigInt(0);

    for (const invoice of allInvoices) {
      stats[invoice.status as keyof InvoiceStatistics]++;
      if (
        invoice.status === "paid" ||
        invoice.status === "used" ||
        invoice.status === "refunded"
      ) {
        totalRaw += BigInt(invoice.amount_raw);
      }
    }

    stats.totalAmountRaw = totalRaw.toString();
    // Convert raw to XNO (simplified, could use rawToXno utility)
    stats.totalAmountXno = (Number(totalRaw) / 1e30).toFixed(30);

    return stats;
  }

  /**
   * Generate Nano URI for an invoice
   */
  generateNanoUri(invoice: Invoice): string {
    return generateNanoUri(invoice.nano_account, invoice.amount_raw);
  }

  /**
   * Get index management methods (if using MemoryInvoiceStore)
   */
  async getHighestUsedIndex(): Promise<number | null> {
    if (this.invoiceStore instanceof MemoryInvoiceStore) {
      return await this.invoiceStore.getHighestIndex();
    }
    return null;
  }

  async getAllUsedIndexes(): Promise<number[] | null> {
    if (this.invoiceStore instanceof MemoryInvoiceStore) {
      return await this.invoiceStore.getAllUsedIndexes();
    }
    return null;
  }

  async isIndexUsed(index: number): Promise<boolean | null> {
    if (this.invoiceStore instanceof MemoryInvoiceStore) {
      return await this.invoiceStore.isIndexUsed(index);
    }
    return null;
  }
}
