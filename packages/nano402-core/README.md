# nano402

Framework-agnostic core library for HTTP 402 payments with Nano cryptocurrency.

## Installation

```bash
npm install nano402
# or
pnpm add nano402
# or
yarn add nano402
```

## Overview

`nano402` provides the core functionality for implementing HTTP 402 payment systems using Nano cryptocurrency. It's framework-agnostic and can be used with any Node.js backend framework.

## Features

- ✅ **Deterministic Address Derivation** - Generate unique payment addresses from a seed
- ✅ **Invoice Management** - Create, track, and manage payment invoices
- ✅ **Payment Verification** - Verify payments via Nano RPC (supports pending and confirmed blocks)
- ✅ **Multiple Storage Backends** - In-memory (dev) or SQLite (production) storage
- ✅ **Webhook Support** - Trigger webhooks on invoice events
- ✅ **RPC Caching** - Built-in caching for better performance
- ✅ **TypeScript Support** - Full TypeScript definitions included

## Quick Start

```typescript
import { Nano402 } from "nano402";

// Initialize Nano402
const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL || "https://node.somenano.com/proxy",
});

// Create an invoice
const invoice = await nano402.createInvoice({
  resource: "/api/protected",
  amount_xno: "0.00001",
  ttlSeconds: 3600,
});

// Verify payment
const isValid = await nano402.verifyPayment(invoice.id, txHash);
```

## API Reference

### Classes

#### `Nano402`

Main class for invoice management and payment verification.

```typescript
const nano402 = new Nano402({
  walletSeed: string; // 64-character hex seed
  nanoRpcUrl: string; // Nano RPC node URL
  invoiceStore?: InvoiceStore; // Optional custom store
  indexStore?: IndexStore; // Optional custom index store
  // ... see full config in types
});
```

**Methods:**

- `createInvoice(params: CreateInvoiceParams): Promise<Invoice>` - Create a new invoice
- `verifyPayment(id: string, proofTxHash?: string): Promise<boolean>` - Verify payment
- `getStatus(id: string): Promise<InvoiceStatus>` - Get invoice status
- `markUsed(id: string): Promise<void>` - Mark invoice as used
- `getInvoice(id: string): Promise<Invoice | null>` - Get invoice by ID
- `getInvoiceByResource(resource: string): Promise<Invoice | null>` - Get invoice by resource
- `getInvoiceByClientIp(ip: string, resource?: string): Promise<Invoice | null>` - Get invoice by IP
- `generateNanoUri(invoice: Invoice): string` - Generate Nano payment URI
- `registerWebhook(config: WebhookConfig): void` - Register webhook

#### Invoice Stores

- `MemoryInvoiceStore` - In-memory storage (development)
- `SqliteInvoiceStore` - SQLite storage (production)

#### Index Stores

- `FileIndexStore` - File-based index storage (default)
- `SqliteIndexStore` - SQLite-based index storage
- `MemoryIndexStore` - In-memory index storage

### Utilities

- `deriveNanoAccount(seed: string, index: number): string` - Derive Nano account from seed
- `xnoToRaw(amount: string): string` - Convert XNO to raw units
- `rawToXno(amount: string): string` - Convert raw units to XNO

### Verification Utilities

Shared verification helpers used by framework packages:

- `calculateRetryAfter(expiresAt: string): number` - Calculate Retry-After header value in seconds
- `isSessionValid(invoice: Invoice, sessionDuration?: number): boolean` - Check if session is still valid
- `isUsageExceeded(invoice: Invoice, maxUsage?: number): boolean` - Check if invoice has exceeded max usage
- `getPaymentInfo(options: GuardOptions): PaymentInfo` - Generate helpful payment information
- `getClientIp(req: RequestLike): string` - Extract client IP from request (framework-agnostic)

### Guard Logic

Framework-agnostic guard handler for implementing payment protection:

- `handleGuardRequest(nano402: Nano402, request: GuardRequest, options: GuardOptions): Promise<GuardResult>` - Main guard handler that performs all verification logic
- `generate402Response(invoice: Invoice, options: GuardOptions, nano402: Nano402): ResponseData` - Generate standardized 402 response data

These utilities are used internally by `@nano402/express` and `@nano402/nestjs` packages, but can also be used directly when building custom framework integrations.

### Types

All TypeScript types are exported for use in your projects:

- `Invoice`, `InvoiceStatus`, `Nano402Config`, `CreateInvoiceParams`
- `InvoiceStore`, `IndexStore`, `PaymentVerificationOptions`
- `InvoiceStatistics`, `WebhookConfig`
- And more...

### Errors

Custom error classes for better error handling:

- `InvoiceNotFoundError`
- `InvoiceNotPaidError`
- `InvoiceExpiredError`
- `InvalidSeedError`
- `InvalidAmountError`
- `RpcError`
- `RpcTimeoutError`
- `ConcurrentModificationError`

## Examples

### Basic Usage

```typescript
import { Nano402 } from "nano402";

const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
});

// Create invoice
const invoice = await nano402.createInvoice({
  resource: "/api/premium-content",
  amount_xno: "0.01",
  ttlSeconds: 3600,
});

// Check status
const status = await nano402.getStatus(invoice.id);
console.log(status); // "pending" | "paid" | "used" | "expired" | "cancelled" | "refunded"

// Verify payment
const isValid = await nano402.verifyPayment(invoice.id, txHash);
if (isValid) {
  await nano402.markUsed(invoice.id);
}
```

### Using SQLite Storage

```typescript
import { Nano402, SqliteInvoiceStore } from "nano402";

const invoiceStore = new SqliteInvoiceStore({
  dbPath: "./data/invoices.db",
});

const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
  invoiceStore,
});
```

**Note:** Install `better-sqlite3` for SQLite support:

```bash
npm install better-sqlite3
```

### Webhook Integration

```typescript
nano402.registerWebhook({
  url: "https://api.example.com/webhooks/nano402",
  secret: process.env.WEBHOOK_SECRET!,
  events: [
    "invoice.created",
    "invoice.paid",
    "invoice.expired",
    "invoice.cancelled",
    "invoice.refunded",
  ],
});
```

## Framework Integrations

For easier integration with popular frameworks, check out:

- **[@nano402/express](../nano402-express/)** - Express.js middleware
- **[@nano402/nestjs](../nano402-nestjs/)** - NestJS guard

## Requirements

- Node.js >= 18.0.0
- Nano wallet seed (64-character hexadecimal string)
- Nano RPC node (public or self-hosted)

## Documentation

For complete documentation, examples, and guides, visit the [main repository](https://github.com/nano402/nano402-js).

## License

MIT

## Repository

- **GitHub**: [https://github.com/nano402/nano402-js](https://github.com/nano402/nano402-js)
- **Issues**: [https://github.com/nano402/nano402-js/issues](https://github.com/nano402/nano402-js/issues)
