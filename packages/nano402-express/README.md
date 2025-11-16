# @nano402/express

Express.js middleware for HTTP 402 payments with Nano cryptocurrency.

## Installation

```bash
npm install @nano402/express
# or
pnpm add @nano402/express
# or
yarn add @nano402/express
```

**Peer Dependencies:**

```bash
npm install express
```

## Overview

`@nano402/express` provides Express.js middleware that makes it easy to protect routes with HTTP 402 payments. It includes all functionality from `nano402` plus Express-specific middleware.

## Quick Start

```typescript
import express from "express";
import { Nano402, nano402Guard } from "@nano402/express";

const app = express();
app.use(express.json());

// Initialize Nano402
const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL || "https://node.somenano.com/proxy",
});

// Protect a route with 402 payment
app.get(
  "/api/protected",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    ttlSeconds: 3600,
    description: "Access to premium content",
  }),
  (req, res) => {
    res.json({ data: "Protected content" });
  }
);

app.listen(3000);
```

## Usage

### Basic Middleware

```typescript
import { nano402Guard } from "@nano402/express";

app.get(
  "/api/premium",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
  }),
  (req, res) => {
    res.json({ secret: "Premium data" });
  }
);
```

### Middleware Options

```typescript
interface Nano402GuardOptions {
  amount_xno: string; // Required: Payment amount in XNO
  ttlSeconds?: number; // Optional: Invoice TTL in seconds (default: 3600)
  description?: string; // Optional: Human-readable description
  trackByIp?: boolean; // Optional: Track by IP for seamless access (default: false)
  sessionDuration?: number; // Optional: Access duration in seconds
  maxUsage?: number; // Optional: Maximum accesses per invoice
  makeItPublic?: boolean; // Optional: Make content public after payment (default: false)
}
```

### IP-Based Tracking

Enable seamless access by tracking payments by IP address:

```typescript
app.get(
  "/api/content",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    trackByIp: true, // Enable IP-based tracking
    sessionDuration: 3600, // 1 hour access
  }),
  (req, res) => {
    res.json({ data: "Content" });
  }
);
```

After payment, users can access from the same IP without providing payment proof headers.

### Session Management

Control access duration and usage limits:

```typescript
app.get(
  "/api/limited",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    sessionDuration: 3600, // Access valid for 1 hour
    maxUsage: 5, // Maximum 5 accesses
  }),
  (req, res) => {
    res.json({ data: "Limited access content" });
  }
);
```

### Public Access After Payment

Make content publicly accessible after first payment:

```typescript
app.get(
  "/api/public-after-payment",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    makeItPublic: true, // Content becomes public after payment
    sessionDuration: 86400, // Public for 24 hours
  }),
  (req, res) => {
    res.json({ data: "Public content after payment" });
  }
);
```

### Manual Payment Verification

For more control, you can implement the payment flow manually:

```typescript
import { Nano402 } from "@nano402/express";

app.get("/api/manual", async (req, res) => {
  const invoice = await nano402.createInvoice({
    resource: "/api/manual",
    amount_xno: "0.00001",
    ttlSeconds: 3600,
  });

  // Check for payment proof headers
  const requestId = req.headers["x-402-request-id"] as string;
  const proof = req.headers["x-402-proof"] as string;

  if (requestId && proof) {
    const isValid = await nano402.verifyPayment(requestId, proof);
    if (isValid) {
      return res.json({ data: "Content" });
    }
  }

  // Return 402 Payment Required
  const nanoUri = nano402.generateNanoUri(invoice);
  return res.status(402).json({
    request_id: invoice.id,
    nano_account: invoice.nano_account,
    amount_xno: invoice.amount_xno,
    amount_raw: invoice.amount_raw,
    nano_uri: nanoUri,
    expires_at: invoice.expires_at,
  });
});
```

## How It Works

1. **First Request** - Client requests protected route without payment proof
   - Middleware returns `402 Payment Required` with invoice details
   - Response includes payment address, amount, and Nano URI

2. **Payment** - Client pays the invoice using a Nano wallet

3. **Second Request** - Client retries with payment proof headers:
   ```
   X-402-Request-Id: <invoice_id>
   X-402-Proof: <transaction_hash>
   ```
   - Middleware verifies payment via Nano RPC
   - If valid, request proceeds to route handler
   - If invalid, returns 402 again

## Response Format

### 402 Payment Required Response

```json
{
  "request_id": "invoice-id",
  "nano_account": "nano_...",
  "amount_xno": "0.00001",
  "amount_raw": "1000000000000000000000000",
  "nano_uri": "nano:nano_...?amount=1000000000000000000000000",
  "expires_at": "2024-01-01T00:00:00Z",
  "description": "Access to premium content"
}
```

## Core Library Access

This package re-exports everything from `nano402`, so you can use all core functionality:

```typescript
import {
  Nano402,
  SqliteInvoiceStore,
  MemoryInvoiceStore,
  // ... all core exports
} from "@nano402/express";
```

## Examples

See the [examples directory](https://github.com/nano402/nano402-js/tree/main/examples) in the main repository for complete examples.

## Requirements

- Node.js >= 18.0.0
- Express >= 4.18.0
- Nano wallet seed (64-character hexadecimal string)
- Nano RPC node (public or self-hosted)

## Documentation

For complete documentation, see the [main repository](https://github.com/nano402/nano402-js).

## License

MIT

## Repository

- **GitHub**: [https://github.com/nano402/nano402-js](https://github.com/nano402/nano402-js)
- **Issues**: [https://github.com/nano402/nano402-js/issues](https://github.com/nano402/nano402-js/issues)

