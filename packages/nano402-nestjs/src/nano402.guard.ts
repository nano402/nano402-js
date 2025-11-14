import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  HttpException,
} from "@nestjs/common";
import { Request, Response } from "express";
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
 */
function isSessionValid(
  invoice: { paid_at?: string; expires_at?: string },
  sessionDuration?: number
): boolean {
  if (!invoice.paid_at) {
    return false;
  }

  if (sessionDuration === undefined) {
    if (!invoice.expires_at) {
      return true;
    }
    const expiresAt = new Date(invoice.expires_at).getTime();
    const now = Date.now();
    return now < expiresAt;
  }

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
    return false;
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

  if (options.maxUsage !== undefined) {
    accessDetails.push(
      `Maximum ${options.maxUsage} access${
        options.maxUsage > 1 ? "es" : ""
      } allowed`
    );
  } else {
    accessDetails.push("Unlimited access until expiration");
  }

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
  const forwarded = req.headers["x-forwarded-for"] as string;
  if (forwarded) {
    const ip = forwarded.split(",")[0].trim();
    if (ip) return ip;
  }

  const realIp = req.headers["x-real-ip"] as string;
  if (realIp) {
    return realIp;
  }

  if (req.socket) {
    const remoteAddress = req.socket.remoteAddress;
    if (remoteAddress) {
      if (remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1") {
        return "127.0.0.1";
      }
      return remoteAddress;
    }
  }

  if (req.ip && req.ip !== "::1") {
    return req.ip;
  }

  return "127.0.0.1";
}

/**
 * NestJS Guard for HTTP 402 payments with Nano
 * 
 * @example
 * ```typescript
 * import { Controller, Get, UseGuards } from '@nestjs/common';
 * import { Nano402Guard } from 'nano402-nestjs';
 * import { Nano402 } from 'nano402-core';
 * 
 * @Controller('api')
 * export class AppController {
 *   constructor(private readonly nano402: Nano402) {}
 * 
 *   @Get('protected')
 *   @UseGuards(new Nano402Guard(this.nano402, {
 *     amount_xno: '0.00001',
 *     description: 'Access to protected content'
 *   }))
 *   getProtected() {
 *     return { secret: 'This data requires payment!' };
 *   }
 * }
 * ```
 */
@Injectable()
export class Nano402Guard implements CanActivate {
  constructor(
    private readonly nano402: Nano402,
    private readonly options: Nano402GuardOptions
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const requestId = request.headers["x-402-request-id"] as string;
    const proofTxHash = request.headers["x-402-proof"] as string;
    const resource = request.path;
    const trackByIp = this.options.trackByIp ?? false;
    const sessionDuration = this.options.sessionDuration;
    const maxUsage = this.options.maxUsage;
    const makeItPublic = this.options.makeItPublic ?? false;
    const clientIp = getClientIp(request);

    // Helper function to grant access and increment usage
    const grantAccess = async (invoiceId: string) => {
      try {
        await this.nano402.incrementInvoiceAccess(invoiceId);
      } catch (error) {
        // Ignore errors
      }
      try {
        await this.nano402.markUsed(invoiceId);
      } catch (error) {
        // Ignore errors
      }
      return true;
    };

    try {
      // 1. Check if makeItPublic is enabled
      if (makeItPublic) {
        const publicInvoice = await this.nano402.getInvoiceByResource(resource);
        if (publicInvoice && publicInvoice.resource === resource) {
          if (
            publicInvoice.status === "paid" ||
            publicInvoice.status === "used"
          ) {
            const sessionValid = isSessionValid(
              publicInvoice,
              sessionDuration
            );
            const usageExceeded = isUsageExceeded(publicInvoice, maxUsage);

            if (sessionValid && !usageExceeded) {
              return grantAccess(publicInvoice.id);
            }
          } else if (publicInvoice.status === "pending") {
            await this.nano402.clearRpcCache(publicInvoice.nano_account);
            const isPaid = await this.nano402.verifyPayment(publicInvoice.id);
            if (isPaid) {
              const updatedInvoice = await this.nano402.getInvoice(
                publicInvoice.id
              );
              if (
                updatedInvoice &&
                updatedInvoice.resource === resource &&
                isSessionValid(updatedInvoice, sessionDuration) &&
                !isUsageExceeded(updatedInvoice, maxUsage)
              ) {
                return grantAccess(publicInvoice.id);
              }
            }
          }
        }
      }

      // 2. IP-based verification
      if (trackByIp && !requestId && !proofTxHash) {
        const ipInvoice = await this.nano402.getInvoiceByClientIp(
          clientIp,
          resource
        );

        if (ipInvoice && ipInvoice.resource === resource) {
          if (ipInvoice.status === "paid" || ipInvoice.status === "used") {
            if (
              isSessionValid(ipInvoice, sessionDuration) &&
              !isUsageExceeded(ipInvoice, maxUsage)
            ) {
              return grantAccess(ipInvoice.id);
            }
          } else if (ipInvoice.status === "pending") {
            await this.nano402.clearRpcCache(ipInvoice.nano_account);
            const isPaid = await this.nano402.verifyPayment(ipInvoice.id);
            if (isPaid) {
              const updatedInvoice = await this.nano402.getInvoice(
                ipInvoice.id
              );
              if (
                updatedInvoice &&
                updatedInvoice.resource === resource &&
                isSessionValid(updatedInvoice, sessionDuration) &&
                !isUsageExceeded(updatedInvoice, maxUsage)
              ) {
                return grantAccess(ipInvoice.id);
              }
            }
          }
        }
      }

      // 3. Proof-based verification
      if (requestId && proofTxHash) {
        const isValid = await this.nano402.verifyPayment(
          requestId,
          proofTxHash
        );
        if (isValid) {
          const invoice = await this.nano402.getInvoice(requestId);
          if (
            invoice &&
            invoice.resource === resource &&
            isSessionValid(invoice, sessionDuration) &&
            !isUsageExceeded(invoice, maxUsage)
          ) {
            return grantAccess(requestId);
          }
        } else {
          const invoice = await this.nano402.getInvoice(requestId);
          if (invoice) {
            this.send402Response(response, invoice);
            return false;
          }
        }
      }

      // 4. No valid access found - create or return invoice
      let invoice = await this.nano402.getInvoiceByResource(resource);

      if (invoice) {
        if (invoice.resource !== resource) {
          invoice = null;
        } else {
          const isInvoiceExpired =
            invoice.status === "expired" ||
            new Date(invoice.expires_at) < new Date();

          const isSessionExpired =
            (invoice.status === "paid" || invoice.status === "used") &&
            !isSessionValid(invoice, sessionDuration);

          const isPaidAndSessionValid =
            (invoice.status === "paid" || invoice.status === "used") &&
            isSessionValid(invoice, sessionDuration) &&
            !isUsageExceeded(invoice, maxUsage);

          if (isPaidAndSessionValid) {
            return grantAccess(invoice.id);
          } else if (isInvoiceExpired || isSessionExpired) {
            invoice = null;
          } else if (invoice.status === "pending") {
            const status = await this.nano402.getStatus(invoice.id);
            if (status === "expired") {
              invoice = null;
            } else {
              if (trackByIp && !invoice.client_ip) {
                await this.nano402.updateInvoiceClientIp(invoice.id, clientIp);
              }
              this.send402Response(response, invoice);
              return false;
            }
          } else {
            invoice = null;
          }
        }
      }

      // Create new invoice if none exists
      if (!invoice) {
        invoice = await this.nano402.createInvoice({
          resource,
          amount_xno: this.options.amount_xno,
          ttlSeconds: this.options.ttlSeconds,
        });
        if (trackByIp) {
          await this.nano402.updateInvoiceClientIp(invoice.id, clientIp);
        }
      }

      this.send402Response(response, invoice);
      return false;
    } catch (error) {
      if (error instanceof InvoiceNotFoundError) {
        throw new HttpException(
          {
            error: "Invoice not found",
            message: error.message,
          },
          HttpStatus.NOT_FOUND
        );
      }

      if (error instanceof InvoiceExpiredError) {
        throw new HttpException(
          {
            error: "Invoice expired",
            message: error.message,
          },
          HttpStatus.GONE
        );
      }

      if (error instanceof InvalidAmountError) {
        throw new HttpException(
          {
            error: "Invalid amount",
            message: error.message,
          },
          HttpStatus.BAD_REQUEST
        );
      }

      if (error instanceof RpcTimeoutError) {
        throw new HttpException(
          {
            error: "Payment service temporarily unavailable",
            message: "RPC timeout",
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      if (error instanceof RpcError) {
        throw new HttpException(
          {
            error: "Payment service temporarily unavailable",
            message: error.message,
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      throw new HttpException(
        {
          error: "Internal server error",
          message:
            process.env.NODE_ENV === "development"
              ? error instanceof Error
                ? error.message
                : "Internal server error"
              : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private send402Response(response: Response, invoice: any): void {
    const retryAfter = calculateRetryAfter(invoice.expires_at);
    const nanoUri = this.nano402.generateNanoUri(invoice);
    const paymentInfo = getPaymentInfo({
      makeItPublic: this.options.makeItPublic,
      trackByIp: this.options.trackByIp,
      sessionDuration: this.options.sessionDuration,
      maxUsage: this.options.maxUsage,
    });

    response.status(HttpStatus.PAYMENT_REQUIRED);
    response.set({
      "Pay-Using": "nano",
      "X-402-Request-Id": invoice.id,
      "Retry-After": retryAfter.toString(),
      Link: `<${nanoUri}>; rel="payment"`,
    });
    response.json({
      request_id: invoice.id,
      nano_account: invoice.nano_account,
      amount_raw: invoice.amount_raw,
      amount_xno: invoice.amount_xno,
      expires_at: invoice.expires_at,
      resource: invoice.resource,
      nano_uri: nanoUri,
      description: this.options.description,
      payment_info: paymentInfo,
    });
  }
}

