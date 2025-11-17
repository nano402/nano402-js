# nano402

A complete Node.js + TypeScript implementation of HTTP 402 payments using Nano cryptocurrency. This library enables any backend to implement paywalls using Nano with deterministic address derivation, invoice creation, payment validation, and access unlocking.

## ⚠️ Early Project Disclaimer

**This project is in early development and should be used with caution.**

- 🐛 **May contain bugs** - The codebase is actively being developed and tested
- 🔄 **API may change** - Breaking changes may occur between versions
- ⚠️ **Not production-ready** - Thoroughly test before using in production environments
- 💰 **Use at your own risk** - The authors are not responsible for any financial losses
- 📝 **Feedback welcome** - Please report issues and contribute improvements

We recommend:

- Testing thoroughly in development/staging environments first
- Starting with small amounts for testing
- Monitoring your implementation closely
- Reviewing the code before integrating
- Keeping backups of important data

## Project Structure

This is a **monorepo** containing:

- **`nano402`** (`packages/nano402-core`) - Framework-agnostic core library
- **`@nano402/express`** (`packages/nano402-express`) - Express.js middleware
- **`@nano402/nestjs`** (`packages/nano402-nestjs`) - NestJS guard
- **`examples/basic-server`** - Example Express server implementation

**Note:** The project has been split into separate packages for better maintainability and framework support. All verification logic is centralized in `nano402`, making framework packages thin wrappers (~126 lines for Express, ~200 lines for NestJS). See [PACKAGE_STRUCTURE.md](./docs/PACKAGE_STRUCTURE.md) for details.

## What is HTTP 402?

HTTP 402 is a reserved status code in the HTTP specification that indicates "Payment Required". While it's not widely used in traditional web applications, it's perfect for cryptocurrency-based payment systems where you need to gate access to resources behind a payment.

## Why Nano?

Nano is an ideal cryptocurrency for HTTP 402 payments because:

- **Instant transactions** - No waiting for confirmations
- **Zero fees** - Perfect for micropayments
- **Lightweight** - Simple RPC interface
- **Deterministic addresses** - Easy to generate unique payment addresses
- **Eco-friendly** - Low energy consumption

## Installation

### For Express Apps

```bash
pnpm add @nano402/express
# or
npm install @nano402/express
```

### For NestJS Apps

```bash
pnpm add @nano402/nestjs
# or
npm install @nano402/nestjs
```

### For Custom Frameworks

```bash
pnpm add nano402
# or
npm install nano402
```

**Note:** See [PACKAGE_STRUCTURE.md](./docs/PACKAGE_STRUCTURE.md) for more details on the package structure.

## Requirements

- **Node.js** >= 18.0.0
- **TypeScript** (for TypeScript projects)
- **Nano wallet seed** (64-character hexadecimal string)
- **Nano RPC node** (public or self-hosted)

## Quick Start

### Using Express Middleware (Recommended)

The easiest way to get started is using the Express middleware:

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
    description: "Access to protected content",
  }),
  (req, res) => {
    res.json({ secret: "This data requires payment!" });
  }
);

app.listen(3000);
```

### Manual Implementation

For more control, you can implement the payment flow manually:

```typescript
import express from "express";
import { Nano402 } from "nano402";

const app = express();

// Initialize Nano402
const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL || "https://node.somenano.com/proxy",
});

// Protect a route with 402 payment
app.get("/api/protected", async (req, res) => {
  const invoice = await nano402.createInvoice({
    resource: "/api/protected",
    amount_xno: "0.00001",
    ttlSeconds: 3600,
  });

  // Check if payment proof is provided
  const requestId = req.headers["x-402-request-id"] as string;
  const proof = req.headers["x-402-proof"] as string;

  if (requestId && proof) {
    const isValid = await nano402.verifyPayment(requestId, proof);
    if (isValid) {
      return res.json({ secret: "This data requires payment!" });
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

app.listen(3000);
```

### How It Works

1. **First Request** - Client requests `/api/protected` without payment proof

   - Server returns `402 Payment Required` with invoice details
   - Response includes:
     - `request_id`: Invoice ID
     - `nano_account`: Payment address
     - `amount_xno`: Amount in XNO
     - `amount_raw`: Amount in raw units
     - `nano_uri`: Payment URI for wallet apps
     - `expires_at`: Invoice expiration time

2. **Payment** - Client pays the invoice using a Nano wallet

3. **Second Request** - Client retries with payment proof headers:
   ```
   X-402-Request-Id: <invoice_id>
   X-402-Proof: <transaction_hash>
   ```
   - Server verifies payment via Nano RPC
   - If valid, request proceeds to route handler
   - If invalid, returns 402 again

## Features

### 🎯 Core Features

- ✅ **Deterministic Address Derivation** - Generate unique payment addresses from a seed
- ✅ **Invoice Management** - Create, track, and manage payment invoices
- ✅ **Payment Verification** - Verify payments via Nano RPC (supports pending and confirmed blocks)
- ✅ **Express Middleware** - Easy-to-use middleware for protecting routes
- ✅ **Multiple Verification Methods** - Headers, IP-based tracking, or public access
- ✅ **Session Management** - Configurable session duration and max usage limits
- ✅ **Invoice Stores** - In-memory (dev) or SQLite (production) storage
- ✅ **Webhook Support** - Trigger webhooks on invoice events
- ✅ **RPC Caching** - Built-in caching for better performance

### 🔐 Verification Methods

#### 1. Explicit Proof (Most Secure)

Require payment proof headers:

```typescript
// Check for payment proof headers
const requestId = req.headers["x-402-request-id"] as string;
const proof = req.headers["x-402-proof"] as string;
if (requestId && proof) {
  const isValid = await nano402.verifyPayment(requestId, proof);
  // Headers required: X-402-Request-Id and X-402-Proof
}
```

#### 2. IP-Based Tracking (Seamless UX)

Track payments by client IP address:

```typescript
// Enable IP-based tracking
const invoice = await nano402.getInvoiceByClientIp(req.ip, "/api/protected");
if (invoice && invoice.status === "paid") {
  // Allow access
}
```

After payment, users can access from the same IP without headers.

#### 3. Public Access (One Payment, Everyone Benefits)

Make content publicly accessible after first payment:

```typescript
// Make content publicly accessible after first payment
const publicInvoice = await nano402.getInvoiceByResource("/api/protected");
if (publicInvoice && publicInvoice.status === "paid") {
  // Content becomes public after payment
  // Check sessionDuration for expiration
}
```

## API Reference

### Core Library (`nano402`)

The core library exports:

**Classes:**

- `Nano402` - Main class for invoice management and payment verification
- `NanoRpcClient` - Low-level Nano RPC client
- `MemoryInvoiceStore` - In-memory invoice storage
- `SqliteInvoiceStore` - SQLite-based invoice storage
- `FileIndexStore` - File-based index storage
- `SqliteIndexStore` - SQLite-based index storage
- `MemoryIndexStore` - In-memory index storage

**Functions:**

- `deriveNanoAccount(seed: string, index: number): string` - Derive Nano account from seed and index
- `xnoToRaw(amount: string): string` - Convert XNO to raw units
- `rawToXno(amount: string): string` - Convert raw units to XNO

**Verification Utilities:**

- `calculateRetryAfter(expiresAt: string): number` - Calculate Retry-After header value
- `isSessionValid(invoice: Invoice, sessionDuration?: number): boolean` - Check if session is valid
- `isUsageExceeded(invoice: Invoice, maxUsage?: number): boolean` - Check if usage limit exceeded
- `getPaymentInfo(options: GuardOptions): PaymentInfo` - Generate payment information
- `getClientIp(req: RequestLike): string` - Extract client IP from request (framework-agnostic)

**Guard Logic:**

- `handleGuardRequest(nano402: Nano402, request: GuardRequest, options: GuardOptions): Promise<GuardResult>` - Framework-agnostic guard handler
- `generate402Response(invoice: Invoice, options: GuardOptions, nano402: Nano402): ResponseData` - Generate standardized 402 response

**Types:**

- `Invoice`, `InvoiceStatus`, `Nano402Config`, `CreateInvoiceParams`
- `InvoiceStore`, `IndexStore`, `PaymentVerificationOptions`
- `InvoiceStatistics`, `WebhookConfig`
- And more...

**Errors:**

- `InvoiceNotFoundError`, `InvoiceNotPaidError`, `InvoiceExpiredError`
- `InvalidSeedError`, `InvalidAmountError`, `RpcError`, `RpcTimeoutError`
- `ConcurrentModificationError`

### Main API

#### `Nano402` Class

```typescript
import { Nano402 } from "nano402";

const nano402 = new Nano402({
  walletSeed: string; // 64-character hex seed
  nanoRpcUrl: string; // Nano RPC node URL
  invoiceStore?: InvoiceStore; // Optional custom store
  indexStore?: IndexStore; // Optional custom index store
  indexStorePath?: string; // Path for file-based index store
  dbPath?: string; // Path for SQLite database
  verifySender?: boolean; // Verify sender account
  allowedSenders?: string[]; // Allowed sender accounts
  proofExpirationSeconds?: number; // Proof expiration time
  acceptPending?: boolean; // Accept pending blocks (default: true)
  rpcTimeout?: number; // RPC timeout in ms
  rpcRetries?: number; // RPC retry count
  rpcRetryDelay?: number; // RPC retry delay in ms
  rpcAuth?: { username: string; password: string }; // RPC auth
  rpcCacheEnabled?: boolean; // Enable RPC caching (default: true)
  rpcCacheTtl?: number; // RPC cache TTL in ms (default: 5000)
});
```

#### Methods

##### `createInvoice(params: CreateInvoiceParams): Promise<Invoice>`

Creates a new payment invoice.

```typescript
const invoice = await nano402.createInvoice({
  resource: "/api/secret-data",
  amount_xno: "0.01",
  ttlSeconds: 3600, // Optional, defaults to 3600
  proofExpirationSeconds: 7200, // Optional
});
```

##### `verifyPayment(id: string, proofTxHash?: string): Promise<boolean>`

Verifies payment for an invoice.

```typescript
const isValid = await nano402.verifyPayment(invoice.id, txHash);
```

##### `getStatus(id: string): Promise<InvoiceStatus>`

Gets the current status of an invoice.

```typescript
const status = await nano402.getStatus(invoice.id);
// Returns: "pending" | "paid" | "used" | "expired" | "cancelled" | "refunded"
```

##### `markUsed(id: string): Promise<void>`

Marks a paid invoice as used (prevents reuse).

```typescript
await nano402.markUsed(invoice.id);
```

##### `getInvoice(id: string): Promise<Invoice | null>`

Gets an invoice by ID.

##### `getInvoiceByResource(resource: string): Promise<Invoice | null>`

Gets an invoice by resource path.

##### `getInvoiceByClientIp(ip: string, resource?: string): Promise<Invoice | null>`

Gets an invoice by client IP address.

##### `updateInvoiceClientIp(invoiceId: string, ip: string): Promise<void>`

Updates an invoice with client IP address.

##### `incrementInvoiceAccess(invoiceId: string): Promise<void>`

Increments the access count for an invoice.

##### `listInvoices(params?: { status?: InvoiceStatus; limit?: number; offset?: number }): Promise<Invoice[]>`

Lists invoices with optional filtering.

##### `getStatistics(): Promise<InvoiceStatistics>`

Gets invoice statistics.

##### `generateNanoUri(invoice: Invoice): string`

Generates a Nano payment URI for an invoice.

##### `registerWebhook(config: WebhookConfig): void`

Registers a webhook for invoice events.

```typescript
nano402.registerWebhook({
  url: "https://example.com/webhook",
  secret: "webhook-secret",
  events: ["invoice.created", "invoice.paid", "invoice.expired"],
});
```

### Express Middleware

The `nano402` package includes Express middleware for protecting routes:

```typescript
import { nano402Guard } from "@nano402/express";

app.get(
  "/api/protected",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    ttlSeconds: 3600,
    description: "Access to premium content",
    trackByIp: false, // Enable IP-based tracking
    sessionDuration: 3600, // 1 hour session
    maxUsage: 5, // Maximum 5 accesses
    makeItPublic: false, // Make content public after payment
  }),
  (req, res) => {
    res.json({ data: "Protected content" });
  }
);
```

#### Middleware Options

- `amount_xno` (required) - Payment amount in XNO
- `ttlSeconds` (optional) - Invoice time-to-live in seconds (default: 3600)
- `description` (optional) - Human-readable description shown in 402 response
- `trackByIp` (optional) - Track payments by IP address for seamless access (default: false)
- `sessionDuration` (optional) - Access duration in seconds after payment (default: until invoice expires)
- `maxUsage` (optional) - Maximum number of accesses per invoice (default: unlimited)
- `makeItPublic` (optional) - Make content publicly accessible after first payment (default: false)

For detailed documentation, see:

- [IP Tracking Guide](./docs/IP_TRACKING.md) - IP-based payment tracking
- [Unlocking Guide](./docs/UNLOCKING.md) - Different unlocking methods

## Invoice Stores

The library supports multiple invoice storage backends. By default, it will automatically use SQLite if `better-sqlite3` is available, otherwise it falls back to in-memory storage.

### SQLite Invoice Store (Default if `better-sqlite3` is installed)

Persistent storage with better concurrency support. This is the recommended option for production:

```typescript
import { Nano402, SqliteInvoiceStore } from "nano402";

const invoiceStore = new SqliteInvoiceStore({
  dbPath: "./data/invoices.db", // Optional, defaults to .nano402-invoices.db
});

const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
  invoiceStore,
});
```

**Installation:**

```bash
npm install better-sqlite3
# or
pnpm add better-sqlite3
```

The library uses `optionalDependencies`, so if `better-sqlite3` is not installed, it will automatically fall back to the memory store.

### Memory Invoice Store (Fallback)

In-memory storage, perfect for development and testing. Automatically used if SQLite is not available:

```typescript
import { Nano402, MemoryInvoiceStore } from "nano402";

const invoiceStore = new MemoryInvoiceStore({
  indexStorePath: "./.nano402-db.json", // Optional, defaults to .nano402-db.json
});

const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
  invoiceStore,
});
```

**Note:** Memory store data is lost on server restart. For production, use SQLite.

### Index Stores

Index stores manage the deterministic address derivation index. The library supports:

- **FileIndexStore** (default) - Stores index in a JSON file (`.nano402-db.json`)
- **SqliteIndexStore** - Stores index in SQLite database
- **MemoryIndexStore** - In-memory index (lost on restart)

You can configure the index store separately:

```typescript
import { Nano402, FileIndexStore, SqliteIndexStore } from "nano402";

// Use file-based index store
const indexStore = new FileIndexStore("./.nano402-index.json");

const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
  indexStore, // Optional
  indexStorePath: "./.nano402-db.json", // Alternative: specify path directly
});
```

### Custom Invoice Store

Implement the `InvoiceStore` interface:

```typescript
import { InvoiceStore, Invoice } from "nano402";

class DatabaseInvoiceStore implements InvoiceStore {
  async save(invoice: Invoice): Promise<void> {
    // Save to database
  }

  async findById(id: string): Promise<Invoice | null> {
    // Find by ID
  }

  async findByResource(resource: string): Promise<Invoice | null> {
    // Find by resource
  }

  async update(id: string, updates: Partial<Invoice>): Promise<void> {
    // Update invoice
  }

  // ... implement other required methods
}
```

## Advanced Usage

### Session Management

Control access duration and usage limits using the Express middleware:

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  sessionDuration: 3600, // Access valid for 1 hour after payment
  maxUsage: 5, // Maximum 5 accesses per invoice
  trackByIp: true, // Enable IP-based tracking for seamless access
});
```

**Session Behavior:**

- `sessionDuration`: When set, access is granted for this duration after payment. When `undefined`, access lasts until the invoice expires.
- `maxUsage`: Limits how many times an invoice can be accessed. When `undefined`, unlimited access until expiration.
- Both checks are applied: access is denied if either the session has expired OR max usage is exceeded.

### Webhook Integration

Receive notifications for invoice events:

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

### RPC Configuration

Configure RPC client for better performance:

```typescript
const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
  rpcTimeout: 10000, // 10 seconds
  rpcRetries: 3,
  rpcRetryDelay: 1000, // 1 second
  rpcCacheEnabled: true,
  rpcCacheTtl: 5000, // 5 seconds
});
```

### Sender Verification

Restrict payments to specific sender accounts:

```typescript
const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
  verifySender: true,
  allowedSenders: ["nano_1abc...", "nano_1def..."],
});
```

## Examples

See the [examples](./examples/) directory for complete examples:

- [Basic Server](./examples/basic-server/) - Simple Express server with protected routes

## Development

This is a monorepo managed with pnpm workspaces.

### Setup

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Package Scripts

```bash
# Build the package
pnpm --filter nano402 build

# Run tests
pnpm --filter nano402 test

# Run in watch mode
pnpm --filter nano402 dev
```

### Running the Example Server

```bash
cd examples/basic-server
pnpm install
pnpm dev
```

The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable).

## Testing

```bash
# Run all tests
pnpm test

# Run tests
pnpm --filter nano402 test

# Run tests in watch mode
pnpm --filter nano402 dev
```

## Environment Variables

```env
NANO_SEED=your_nano_wallet_seed_here
NANO_RPC_URL=https://node.somenano.com/proxy
PORT=3000
```

## Security Considerations

1. **Seed Security**: Never commit your wallet seed to version control. Use environment variables or secure secret management.

2. **RPC Security**: Ensure your Nano RPC node is secured and not publicly accessible.

3. **Invoice Expiration**: Always set reasonable expiration times to prevent stale invoices.

4. **Payment Verification**: The library verifies payments by checking:

   - Transaction exists in account history
   - Amount is sufficient
   - Transaction is confirmed (or pending if `acceptPending` is true)

5. **Replay Protection**: Use `markUsed()` or `maxUsage` to prevent invoice reuse.

6. **IP-Based Tracking**: Be aware that IP-based tracking can be shared across users behind the same NAT/VPN.

## Repository

- **GitHub**: [https://github.com/nano402/nano402-js](https://github.com/nano402/nano402-js)
- **Issues**: [https://github.com/nano402/nano402-js/issues](https://github.com/nano402/nano402-js/issues)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run `pnpm test` and `pnpm build`
6. Submit a Pull Request

## Related Documentation

- [IP Tracking Guide](./docs/IP_TRACKING.md) - Detailed guide on IP-based payment tracking
- [Unlocking Guide](./docs/UNLOCKING.md) - Different methods for unlocking protected resources
- [Package Structure](./docs/PACKAGE_STRUCTURE.md) - Understanding the package architecture

## Support

For questions, issues, or feature requests, please open an issue on GitHub.

## Donations

If you find this project useful, consider supporting its development:

**Nano Address:** `nano_366td9nfbxns1tkq3u1ryoaazdzjc5ah3duipw5s7dah4nqna41a6hef3i7x`
