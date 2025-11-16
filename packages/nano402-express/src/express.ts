import { Request, Response, NextFunction } from "express";
import {
  Nano402,
  handleGuardRequest,
  generate402Response,
  getClientIp,
  type GuardOptions,
  type GuardRequest,
} from "nano402";
import {
  InvoiceNotFoundError,
  InvoiceExpiredError,
  InvalidAmountError,
  RpcError,
  RpcTimeoutError,
} from "nano402";

export interface Nano402GuardOptions extends GuardOptions {}

/**
 * Express middleware for HTTP 402 payments with Nano
 */
export function nano402Guard(nano402: Nano402, options: Nano402GuardOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Create framework-agnostic request adapter
    const guardRequest: GuardRequest = {
      path: req.path,
      headers: req.headers,
      getClientIp: () => getClientIp(req),
    };

    try {
      // Use shared guard logic
      const result = await handleGuardRequest(nano402, guardRequest, options);

      // Handle grant access
      if (result.type === "grant") {
        // Increment access count
        try {
          await nano402.incrementInvoiceAccess(result.invoiceId);
        } catch (error) {
          // Ignore errors, continue anyway
        }
        // Always mark as used
        try {
          await nano402.markUsed(result.invoiceId);
        } catch (error) {
          // Ignore if already used or other errors
        }
        return next();
      }

      // Handle deny (402 response)
      if (result.type === "deny") {
        const responseData = generate402Response(
          result.invoice,
          options,
          nano402
        );

        // Add error message if present
        const body = result.error
          ? { ...responseData.body, error: result.error }
          : responseData.body;

        return res.status(responseData.status).set(responseData.headers).json(body);
      }

      // Handle error responses
      if (result.type === "error") {
        return res.status(result.status).json({
          error: result.error,
          message: result.message,
        });
      }
    } catch (error) {
      // Handle specific error types (fallback for errors not caught by handleGuardRequest)
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
