import { Request, Response, NextFunction } from "express";
import {
  Nano402,
  InvoiceNotFoundError,
  InvoiceNotPaidError,
  InvoiceExpiredError,
  InvalidAmountError,
  RpcError,
  RpcTimeoutError,
} from "@nano402/core";

export interface Nano402GuardOptions {
  amount_xno: string;
  ttlSeconds?: number;
  /**
   * Human-readable description of the content/payment.
   * This will be included in the 402 response to help users understand what they're paying for.
   */
  description?: string;
  /**
   * Session duration in seconds. After a payment is verified, access is granted
   * for this duration. Once expired, a new payment is required.
   * When undefined, access remains valid until the invoice expires or maxUsage is reached.
   * Applies to both IP-based and proof-based verification methods.
   */
  sessionDuration?: number;
  /**
   * If true, track invoices by client IP address and allow access
   * if payment is verified for that IP. Enables parameter-free unlocking.
   * Default: false
   */
  trackByIp?: boolean;
  /**
   * Maximum number of times an invoice can be used before access is locked.
   * When undefined, unlimited usage until invoice expires.
   * Each access increments the invoice access_count.
   */
  maxUsage?: number;
  /**
   * If true, after payment is verified, the content becomes publicly accessible
   * (no headers required) until sessionDuration expires.
   * When sessionDuration is undefined, public access lasts until invoice expires.
   * Default: false
   */
  makeItPublic?: boolean;
}

/**
 * Calculate Retry-After header value in seconds
 */
function calculateRetryAfter(expiresAt: string): number {
  const expires = new Date(expiresAt).getTime();
  const now = Date.now();
  const seconds = Math.ceil((expires - now) / 1000);
  return Math.max(0, seconds);
}

/**
 * Check if a session is still valid based on paid_at timestamp and session duration
 * When sessionDuration is undefined, session is valid as long as invoice hasn't expired
 */
function isSessionValid(
  invoice: { paid_at?: string; expires_at?: string },
  sessionDuration?: number
): boolean {
  if (!invoice.paid_at) {
    // No payment timestamp means session hasn't started yet
    return false;
  }

  // If sessionDuration is undefined, check invoice expiration instead
  if (sessionDuration === undefined) {
    if (!invoice.expires_at) {
      return true; // No expiration, always valid
    }
    const expiresAt = new Date(invoice.expires_at).getTime();
    const now = Date.now();
    return now < expiresAt;
  }

  // Check session duration
  const paidAt = new Date(invoice.paid_at).getTime();
  const now = Date.now();
  const sessionExpiresAt = paidAt + sessionDuration * 1000;

  return now < sessionExpiresAt;
}

/**
 * Check if invoice has exceeded max usage
 */
function isUsageExceeded(
  invoice: { access_count?: number },
  maxUsage?: number
): boolean {
  if (maxUsage === undefined) {
    return false; // Unlimited usage
  }
  const accessCount = invoice.access_count || 0;
  return accessCount >= maxUsage;
}

/**
 * Generate helpful payment information based on configuration
 */
function getPaymentInfo(options: {
  makeItPublic?: boolean;
  trackByIp?: boolean;
  sessionDuration?: number;
  maxUsage?: number;
}): {
  access_type: string;
  access_details: string[];
  verification_methods: string[];
} {
  const accessDetails: string[] = [];
  const verificationMethods: string[] = [];

  // Determine access type
  let accessType = "personal";
  if (options.makeItPublic) {
    accessType = "public";
    accessDetails.push(
      "After payment, this content will be publicly accessible to everyone"
    );
  } else if (options.trackByIp) {
    accessType = "ip-based";
    accessDetails.push(
      "After payment, this content will be unlocked for your IP address"
    );
  } else {
    accessDetails.push(
      "After payment, use X-402-Request-Id and X-402-Proof (transaction hash) headers to access"
    );
  }

  // Session duration information
  if (options.sessionDuration !== undefined) {
    const minutes = Math.floor(options.sessionDuration / 60);
    const seconds = options.sessionDuration % 60;
    let durationText = "";
    if (minutes > 0 && seconds > 0) {
      durationText = `${minutes} minute${
        minutes > 1 ? "s" : ""
      } and ${seconds} second${seconds > 1 ? "s" : ""}`;
    } else if (minutes > 0) {
      durationText = `${minutes} minute${minutes > 1 ? "s" : ""}`;
    } else {
      durationText = `${seconds} second${seconds > 1 ? "s" : ""}`;
    }
    accessDetails.push(`Access duration: ${durationText} from payment time`);
  } else {
    accessDetails.push("Access duration: Until invoice expires");
  }

  // Max usage information
  if (options.maxUsage !== undefined) {
    accessDetails.push(
      `Maximum ${options.maxUsage} access${
        options.maxUsage > 1 ? "es" : ""
      } allowed`
    );
  } else {
    accessDetails.push("Unlimited access until expiration");
  }

  // Verification methods
  if (options.makeItPublic) {
    verificationMethods.push("No verification needed - content becomes public");
  } else if (options.trackByIp) {
    verificationMethods.push(
      "IP-based: Access automatically from same IP address"
    );
    verificationMethods.push(
      "Proof-based: use X-402-Request-Id and X-402-Proof (transaction hash) headers"
    );
  } else {
    verificationMethods.push(
      "Proof-based: use X-402-Request-Id and X-402-Proof (transaction hash) headers"
    );
  }

  return {
    access_type: accessType,
    access_details: accessDetails,
    verification_methods: verificationMethods,
  };
}

/**
 * Get client IP address from request
 */
function getClientIp(req: Request): string {
  // Check various headers for IP (handles proxies, load balancers, etc.)
  const forwarded = req.headers["x-forwarded-for"] as string;
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    const ip = forwarded.split(",")[0].trim();
    if (ip) return ip;
  }

  const realIp = req.headers["x-real-ip"] as string;
  if (realIp) {
    return realIp;
  }

  // Fallback to connection remote address (check if socket exists)
  if (req.socket) {
    const remoteAddress = req.socket.remoteAddress;
    if (remoteAddress) {
      // Normalize IPv6 localhost
      if (remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1") {
        return "127.0.0.1";
      }
      return remoteAddress;
    }
  }

  // Last resort: use req.ip if Express trust proxy is configured
  if (req.ip && req.ip !== "::1") {
    return req.ip;
  }

  return "127.0.0.1"; // Default to localhost instead of "unknown"
}

export function nano402Guard(nano402: Nano402, options: Nano402GuardOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.headers["x-402-request-id"] as string;
    const proofTxHash = req.headers["x-402-proof"] as string;
    const resource = req.path;
    const trackByIp = options.trackByIp ?? false;
    const sessionDuration = options.sessionDuration; // undefined means no time limit
    const maxUsage = options.maxUsage;
    const makeItPublic = options.makeItPublic ?? false;
    const clientIp = getClientIp(req);

    // Helper function to grant access and increment usage
    const grantAccess = async (invoiceId: string) => {
      // Increment access count
      try {
        await nano402.incrementInvoiceAccess(invoiceId);
      } catch (error) {
        // Ignore errors, continue anyway
      }
      // Always mark as used
      try {
        await nano402.markUsed(invoiceId);
      } catch (error) {
        // Ignore if already used or other errors
      }
      return next();
    };

    try {
      // 1. Check if makeItPublic is enabled - allow public access if there's a paid invoice
      if (makeItPublic) {
        const publicInvoice = await nano402.getInvoiceByResource(resource);
        if (publicInvoice) {
          // CRITICAL: Verify invoice resource matches request resource
          if (publicInvoice.resource !== resource) {
            // Invoice exists but for different resource - skip public access
          } else {
            // If invoice is paid/used, check session validity and max usage
            if (
              publicInvoice.status === "paid" ||
              publicInvoice.status === "used"
            ) {
              // Check session validity and max usage
              const sessionValid = isSessionValid(
                publicInvoice,
                sessionDuration
              );
              const usageExceeded = isUsageExceeded(publicInvoice, maxUsage);

              if (sessionValid && !usageExceeded) {
                return grantAccess(publicInvoice.id);
              } else {
                // Session expired or max usage exceeded - will create new invoice below
              }
            } else if (publicInvoice.status === "pending") {
              // If invoice is pending, verify payment first
              await nano402.clearRpcCache(publicInvoice.nano_account);
              const isPaid = await nano402.verifyPayment(publicInvoice.id);
              if (isPaid) {
                // Refresh invoice to get updated paid_at timestamp
                const updatedInvoice = await nano402.getInvoice(
                  publicInvoice.id
                );
                if (updatedInvoice && updatedInvoice.resource === resource) {
                  const sessionValid = isSessionValid(
                    updatedInvoice,
                    sessionDuration
                  );
                  const usageExceeded = isUsageExceeded(
                    updatedInvoice,
                    maxUsage
                  );

                  if (sessionValid && !usageExceeded) {
                    return grantAccess(publicInvoice.id);
                  }
                  // Session expired or max usage exceeded - continue to create new invoice below
                }
                // Payment not verified, continue to return pending invoice below
              }
            }
            // If invoice exists but not paid/valid, continue to return it below
          }
        }
      }

      // 2. IP-based verification (if trackByIp is enabled and no headers provided)
      if (trackByIp && !requestId && !proofTxHash) {
        const ipInvoice = await nano402.getInvoiceByClientIp(
          clientIp,
          resource
        );

        if (ipInvoice) {
          // CRITICAL: Verify invoice resource matches request resource
          if (ipInvoice.resource !== resource) {
            // Invoice exists but for different resource - skip IP-based access
          } else {
            // Check if invoice is already paid/used
            if (ipInvoice.status === "paid" || ipInvoice.status === "used") {
              // Check session validity and max usage
              if (
                isSessionValid(ipInvoice, sessionDuration) &&
                !isUsageExceeded(ipInvoice, maxUsage)
              ) {
                return grantAccess(ipInvoice.id);
              }
              // Session expired or max usage exceeded - continue to create new invoice
            }

            // If pending, verify payment via RPC
            if (ipInvoice.status === "pending") {
              await nano402.clearRpcCache(ipInvoice.nano_account);

              const isPaid = await nano402.verifyPayment(ipInvoice.id);
              if (isPaid) {
                // Refresh invoice to get updated paid_at timestamp
                const updatedInvoice = await nano402.getInvoice(ipInvoice.id);
                if (
                  updatedInvoice &&
                  updatedInvoice.resource === resource &&
                  isSessionValid(updatedInvoice, sessionDuration) &&
                  !isUsageExceeded(updatedInvoice, maxUsage)
                ) {
                  return grantAccess(ipInvoice.id);
                }
                // Session expired or max usage exceeded - continue to create new invoice
              }
              // Payment not verified - continue to return 402 below
            }
          }
        }
      }

      // 3. Proof-based verification (X-402-Request-Id and X-402-Proof headers)
      if (requestId && proofTxHash) {
        const isValid = await nano402.verifyPayment(requestId, proofTxHash);
        if (isValid) {
          // Get updated invoice to check session validity and max usage
          const invoice = await nano402.getInvoice(requestId);
          if (
            invoice &&
            invoice.resource === resource &&
            isSessionValid(invoice, sessionDuration) &&
            !isUsageExceeded(invoice, maxUsage)
          ) {
            return grantAccess(requestId);
          }
          // Session expired, max usage exceeded, or resource mismatch - continue to create new invoice below
        } else {
          // Invalid proof, return 402 again
          const invoice = await nano402.getInvoice(requestId);
          if (invoice) {
            const retryAfter = calculateRetryAfter(invoice.expires_at);
            const nanoUri = nano402.generateNanoUri(invoice);
            const paymentInfo = getPaymentInfo({
              makeItPublic,
              trackByIp,
              sessionDuration,
              maxUsage,
            });
            return res
              .status(402)
              .set({
                "Pay-Using": "nano",
                "X-402-Request-Id": invoice.id,
                "Retry-After": retryAfter.toString(),
                Link: `<${nanoUri}>; rel="payment"`,
              })
              .json({
                request_id: invoice.id,
                nano_account: invoice.nano_account,
                amount_raw: invoice.amount_raw,
                amount_xno: invoice.amount_xno,
                expires_at: invoice.expires_at,
                resource: invoice.resource,
                nano_uri: nanoUri,
                description: options.description,
                payment_info: paymentInfo,
                error: "Payment proof verification failed",
              });
          }
        }
      }

      // 4. No valid access found - create or return invoice
      let invoice = await nano402.getInvoiceByResource(resource);

      // Check if invoice exists and handle different statuses
      if (invoice) {
        // CRITICAL: Verify invoice resource matches request resource
        // This prevents access to one resource using payment for another
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
            // Invoice is paid/used and session is valid - grant access
            return grantAccess(invoice.id);
          } else if (isInvoiceExpired || isSessionExpired) {
            // Invoice is expired or session expired, create a new one
            invoice = null;
          } else if (invoice.status === "pending") {
            // Keep the pending invoice to return below
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
      } else if (invoice.status === "pending") {
        // Check if pending invoice is actually expired
        const status = await nano402.getStatus(invoice.id);
        if (status === "expired") {
          // Create new invoice if expired
          invoice = await nano402.createInvoice({
            resource,
            amount_xno: options.amount_xno,
            ttlSeconds: options.ttlSeconds,
          });
          // Track IP if enabled
          if (trackByIp) {
            await nano402.updateInvoiceClientIp(invoice.id, clientIp);
          }
        } else {
          // Return existing pending invoice
          // Ensure IP is tracked if trackByIp is enabled and IP not already set
          if (trackByIp && !invoice.client_ip) {
            await nano402.updateInvoiceClientIp(invoice.id, clientIp);
          }
          const retryAfter = calculateRetryAfter(invoice.expires_at);
          const nanoUri = nano402.generateNanoUri(invoice);
          const paymentInfo = getPaymentInfo({
            makeItPublic,
            trackByIp,
            sessionDuration,
            maxUsage,
          });
          return res
            .status(402)
            .set({
              "Pay-Using": "nano",
              "X-402-Request-Id": invoice.id,
              "Retry-After": retryAfter.toString(),
              Link: `<${nanoUri}>; rel="payment"`,
            })
            .json({
              request_id: invoice.id,
              nano_account: invoice.nano_account,
              amount_raw: invoice.amount_raw,
              amount_xno: invoice.amount_xno,
              expires_at: invoice.expires_at,
              resource: invoice.resource,
              nano_uri: nanoUri,
              description: options.description,
              payment_info: paymentInfo,
            });
        }
      }

      // Return 402 with invoice
      const retryAfter = calculateRetryAfter(invoice.expires_at);
      const nanoUri = nano402.generateNanoUri(invoice);
      const paymentInfo = getPaymentInfo({
        makeItPublic,
        trackByIp,
        sessionDuration,
        maxUsage,
      });
      res
        .status(402)
        .set({
          "Pay-Using": "nano",
          "X-402-Request-Id": invoice.id,
          "Retry-After": retryAfter.toString(),
          Link: `<${nanoUri}>; rel="payment"`,
        })
        .json({
          request_id: invoice.id,
          nano_account: invoice.nano_account,
          amount_raw: invoice.amount_raw,
          amount_xno: invoice.amount_xno,
          expires_at: invoice.expires_at,
          resource: invoice.resource,
          nano_uri: nanoUri,
          description: options.description,
          payment_info: paymentInfo,
        });
    } catch (error) {
      // Handle specific error types
      if (error instanceof InvoiceNotFoundError) {
        return res.status(404).json({
          error: "Invoice not found",
          message: error.message,
        });
      }

      if (error instanceof InvoiceExpiredError) {
        return res.status(410).json({
          error: "Invoice expired",
          message: error.message,
        });
      }

      if (error instanceof InvalidAmountError) {
        return res.status(400).json({
          error: "Invalid amount",
          message: error.message,
        });
      }

      if (error instanceof RpcTimeoutError) {
        console.error("Nano402 middleware RPC timeout:", error);
        return res.status(503).json({
          error: "Payment service temporarily unavailable",
          message: "RPC timeout",
        });
      }

      if (error instanceof RpcError) {
        console.error("Nano402 middleware RPC error:", error);
        return res.status(503).json({
          error: "Payment service temporarily unavailable",
          message: error.message,
        });
      }

      // Generic error
      console.error("Nano402 middleware error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({
        error: "Internal server error",
        message:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      });
    }
  };
}

