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
 * NestJS Guard for HTTP 402 payments with Nano
 *
 * @example
 * ```typescript
 * import { Controller, Get, UseGuards } from '@nestjs/common';
 * import { Nano402Guard } from '@nano402/nestjs';
 * import { Nano402 } from 'nano402';
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

    // Create framework-agnostic request adapter
    const guardRequest: GuardRequest = {
      path: request.path,
      headers: request.headers,
      getClientIp: () => getClientIp(request),
    };

    try {
      // Use shared guard logic
      const result = await handleGuardRequest(
        this.nano402,
        guardRequest,
        this.options
      );

      // Handle grant access
      if (result.type === "grant") {
        // Increment access count
        try {
          await this.nano402.incrementInvoiceAccess(result.invoiceId);
        } catch (error) {
          // Ignore errors
        }
        // Always mark as used
        try {
          await this.nano402.markUsed(result.invoiceId);
        } catch (error) {
          // Ignore errors
        }
        return true;
      }

      // Handle deny (402 response)
      if (result.type === "deny") {
        const responseData = generate402Response(
          result.invoice,
          this.options,
          this.nano402
        );

        // Add error message if present
        const body = result.error
          ? { ...responseData.body, error: result.error }
          : responseData.body;

        response.status(HttpStatus.PAYMENT_REQUIRED);
        Object.entries(responseData.headers).forEach(([key, value]) => {
          response.set(key, value);
        });
        response.json(body);
        return false;
      }

      // Handle error responses
      if (result.type === "error") {
        throw new HttpException(
          {
            error: result.error,
            message: result.message,
          },
          result.status
        );
      }

      // Should never reach here, but TypeScript needs it
      return false;
    } catch (error) {
      // Handle specific error types (fallback for errors not caught by handleGuardRequest)
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

      // Re-throw HttpException (from handleGuardRequest error handling)
      if (error instanceof HttpException) {
        throw error;
      }

      // Generic error
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
}
