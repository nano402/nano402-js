/**
 * Custom error types for nano-402
 */

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} not found`);
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceNotPaidError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} is not paid`);
    this.name = "InvoiceNotPaidError";
  }
}

export class InvoiceExpiredError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} has expired`);
    this.name = "InvoiceExpiredError";
  }
}

export class InvalidSeedError extends Error {
  constructor(message: string) {
    super(`Invalid seed: ${message}`);
    this.name = "InvalidSeedError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(`Invalid amount: ${message}`);
    this.name = "InvalidAmountError";
  }
}

export class RpcError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(`Nano RPC error: ${message}`);
    this.name = "RpcError";
  }
}

export class RpcTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Nano RPC request timed out after ${timeoutMs}ms`);
    this.name = "RpcTimeoutError";
  }
}

export class ConcurrentModificationError extends Error {
  constructor(message: string) {
    super(`Concurrent modification: ${message}`);
    this.name = "ConcurrentModificationError";
  }
}

