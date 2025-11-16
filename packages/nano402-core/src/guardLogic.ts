import type { Invoice } from "./types";
import { Nano402 } from "./nano402";
import {
  calculateRetryAfter,
  isSessionValid,
  isUsageExceeded,
  getPaymentInfo,
} from "./verification";
import {
  InvoiceNotFoundError,
  InvoiceExpiredError,
  InvalidAmountError,
  RpcError,
  RpcTimeoutError,
} from "./errors";

/**
 * Options for guard behavior
 */
export interface GuardOptions {
  amount_xno: string;
  ttlSeconds?: number;
  description?: string;
  sessionDuration?: number;
  trackByIp?: boolean;
  maxUsage?: number;
  makeItPublic?: boolean;
}

/**
 * Framework-agnostic request interface
 */
export interface GuardRequest {
  path: string;
  headers: {
    [key: string]: string | string[] | undefined;
  };
  getClientIp(): string;
}

/**
 * Result of guard verification
 */
export type GuardResult =
  | { type: "grant"; invoiceId: string }
  | { type: "deny"; invoice: Invoice; error?: string }
  | { type: "error"; status: number; error: string; message?: string };

/**
 * Framework-agnostic guard handler that contains all verification logic
 */
export async function handleGuardRequest(
  nano402: Nano402,
  request: GuardRequest,
  options: GuardOptions
): Promise<GuardResult> {
  const requestId = request.headers["x-402-request-id"] as string | undefined;
  const proofTxHash = request.headers["x-402-proof"] as string | undefined;
  const resource = request.path;
  const trackByIp = options.trackByIp ?? false;
  const sessionDuration = options.sessionDuration;
  const maxUsage = options.maxUsage;
  const makeItPublic = options.makeItPublic ?? false;
  const clientIp = request.getClientIp();

  // Helper function to check if access should be granted
  const shouldGrantAccess = (
    invoice: Invoice | null,
    resourcePath: string
  ): boolean => {
    if (!invoice) return false;
    if (invoice.resource !== resourcePath) return false;
    if (invoice.status !== "paid" && invoice.status !== "used") return false;

    const sessionValid = isSessionValid(invoice, sessionDuration);
    const usageExceeded = isUsageExceeded(invoice, maxUsage);

    return sessionValid && !usageExceeded;
  };

  try {
    // 1. Check if makeItPublic is enabled - allow public access if there's a paid invoice
    if (makeItPublic) {
      const publicInvoice = await nano402.getInvoiceByResource(resource);
      if (publicInvoice && publicInvoice.resource === resource) {
        if (
          publicInvoice.status === "paid" ||
          publicInvoice.status === "used"
        ) {
          if (shouldGrantAccess(publicInvoice, resource)) {
            return { type: "grant", invoiceId: publicInvoice.id };
          }
        } else if (publicInvoice.status === "pending") {
          // If invoice is pending, verify payment first
          await nano402.clearRpcCache(publicInvoice.nano_account);
          const isPaid = await nano402.verifyPayment(publicInvoice.id);
          if (isPaid) {
            // Refresh invoice to get updated paid_at timestamp
            const updatedInvoice = await nano402.getInvoice(publicInvoice.id);
            if (updatedInvoice && shouldGrantAccess(updatedInvoice, resource)) {
              return { type: "grant", invoiceId: publicInvoice.id };
            }
          }
        }
      }
    }

    // 2. IP-based verification (if trackByIp is enabled and no headers provided)
    if (trackByIp && !requestId && !proofTxHash) {
      const ipInvoice = await nano402.getInvoiceByClientIp(
        clientIp,
        resource
      );

      if (ipInvoice && ipInvoice.resource === resource) {
        if (ipInvoice.status === "paid" || ipInvoice.status === "used") {
          if (shouldGrantAccess(ipInvoice, resource)) {
            return { type: "grant", invoiceId: ipInvoice.id };
          }
        } else if (ipInvoice.status === "pending") {
          // If pending, verify payment via RPC
          await nano402.clearRpcCache(ipInvoice.nano_account);
          const isPaid = await nano402.verifyPayment(ipInvoice.id);
          if (isPaid) {
            const updatedInvoice = await nano402.getInvoice(ipInvoice.id);
            if (updatedInvoice && shouldGrantAccess(updatedInvoice, resource)) {
              return { type: "grant", invoiceId: ipInvoice.id };
            }
          }
        }
      }
    }

    // 3. Proof-based verification (X-402-Request-Id and X-402-Proof headers)
    if (requestId && proofTxHash) {
      const isValid = await nano402.verifyPayment(requestId, proofTxHash);
      if (isValid) {
        const invoice = await nano402.getInvoice(requestId);
        if (invoice && shouldGrantAccess(invoice, resource)) {
          return { type: "grant", invoiceId: requestId };
        }
      } else {
        // Invalid proof, return 402 again
        const invoice = await nano402.getInvoice(requestId);
        if (invoice) {
          return {
            type: "deny",
            invoice,
            error: "Payment proof verification failed",
          };
        }
      }
    }

    // 4. No valid access found - create or return invoice
    let invoice = await nano402.getInvoiceByResource(resource);

    // Check if invoice exists and handle different statuses
    if (invoice) {
      // CRITICAL: Verify invoice resource matches request resource
      if (invoice.resource !== resource) {
        // Invoice exists but for different resource - create new invoice
        invoice = null;
      } else {
        // Check if invoice is expired (status = "expired" OR invoice expired)
        const isInvoiceExpired =
          invoice.status === "expired" ||
          new Date(invoice.expires_at) < new Date();

        // Check if invoice is paid/used but session expired
        const isSessionExpired =
          (invoice.status === "paid" || invoice.status === "used") &&
          !isSessionValid(invoice, sessionDuration);

        // Check if invoice is paid/used and session is still valid
        const isPaidAndSessionValid =
          (invoice.status === "paid" || invoice.status === "used") &&
          isSessionValid(invoice, sessionDuration) &&
          !isUsageExceeded(invoice, maxUsage);

        if (isPaidAndSessionValid) {
          return { type: "grant", invoiceId: invoice.id };
        } else if (isInvoiceExpired || isSessionExpired) {
          // Invoice is expired or session expired, create a new one
          invoice = null;
        } else if (invoice.status === "pending") {
          // Check if pending invoice is actually expired
          const status = await nano402.getStatus(invoice.id);
          if (status === "expired") {
            // Create new invoice if expired
            invoice = null;
          } else {
            // Return existing pending invoice
            // Ensure IP is tracked if trackByIp is enabled and IP not already set
            if (trackByIp && !invoice.client_ip) {
              await nano402.updateInvoiceClientIp(invoice.id, clientIp);
            }
            return { type: "deny", invoice };
          }
        } else {
          // Invoice is in an unexpected state - create new invoice
          invoice = null;
        }
      }
    }

    // Create new invoice if none exists or if we need to replace existing one
    if (!invoice) {
      invoice = await nano402.createInvoice({
        resource,
        amount_xno: options.amount_xno,
        ttlSeconds: options.ttlSeconds,
      });
      // Track IP if enabled
      if (trackByIp) {
        await nano402.updateInvoiceClientIp(invoice.id, clientIp);
      }
    }

    return { type: "deny", invoice };
  } catch (error) {
    // Handle specific error types
    if (error instanceof InvoiceNotFoundError) {
      return {
        type: "error",
        status: 404,
        error: "Invoice not found",
        message: error.message,
      };
    }

    if (error instanceof InvoiceExpiredError) {
      return {
        type: "error",
        status: 410,
        error: "Invoice expired",
        message: error.message,
      };
    }

    if (error instanceof InvalidAmountError) {
      return {
        type: "error",
        status: 400,
        error: "Invalid amount",
        message: error.message,
      };
    }

    if (error instanceof RpcTimeoutError) {
      return {
        type: "error",
        status: 503,
        error: "Payment service temporarily unavailable",
        message: "RPC timeout",
      };
    }

    if (error instanceof RpcError) {
      return {
        type: "error",
        status: 503,
        error: "Payment service temporarily unavailable",
        message: error.message,
      };
    }

    // Generic error
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return {
      type: "error",
      status: 500,
      error: "Internal server error",
      message: process.env.NODE_ENV === "development" ? errorMessage : undefined,
    };
  }
}

/**
 * Generate 402 response data
 */
export function generate402Response(
  invoice: Invoice,
  options: GuardOptions,
  nano402: Nano402
): {
  status: number;
  headers: Record<string, string>;
  body: Record<string, any>;
} {
  const retryAfter = calculateRetryAfter(invoice.expires_at);
  const nanoUri = nano402.generateNanoUri(invoice);
  const paymentInfo = getPaymentInfo({
    makeItPublic: options.makeItPublic,
    trackByIp: options.trackByIp,
    sessionDuration: options.sessionDuration,
    maxUsage: options.maxUsage,
  });

  return {
    status: 402,
    headers: {
      "Pay-Using": "nano",
      "X-402-Request-Id": invoice.id,
      "Retry-After": retryAfter.toString(),
      Link: `<${nanoUri}>; rel="payment"`,
    },
    body: {
      request_id: invoice.id,
      nano_account: invoice.nano_account,
      amount_raw: invoice.amount_raw,
      amount_xno: invoice.amount_xno,
      expires_at: invoice.expires_at,
      resource: invoice.resource,
      nano_uri: nanoUri,
      description: options.description,
      payment_info: paymentInfo,
    },
  };
}

