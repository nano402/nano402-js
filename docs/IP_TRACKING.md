# IP-Based Payment Tracking

Track payments by client IP address for seamless, parameter-free unlocking!

## How It Works

When `trackByIp: true` is enabled:

1. **First Request** - User requests protected resource
   - Server creates invoice and tracks it by client IP address
   - Returns 402 with invoice details

2. **Payment** - User pays the invoice using `nano_uri`

3. **Second Request** - User makes same request from same IP
   - Server checks: "Does this IP have a paid invoice?"
   - If yes → ✅ Access granted (no headers needed!)
   - If no → Returns 402 again

## Usage

```typescript
import { nano402Guard } from "@nano402/express";

app.get(
  "/api/protected",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    trackByIp: true, // Enable IP-based tracking
  }),
  (req, res) => {
    res.json({ secret: "Protected data!" });
  }
);
```

## Example Flow

```bash
# 1. First request - returns 402 with invoice
curl http://localhost:3000/api/secret-data

# Response:
# {
#   "request_id": "...",
#   "nano_account": "nano_...",
#   "nano_uri": "nano:nano_...?amount=...",
#   ...
# }

# 2. Pay invoice using nano_uri in wallet app

# 3. Second request from same IP - automatically works!
curl http://localhost:3000/api/secret-data
# ✅ Returns 200 with protected data
# No headers needed!
```

## How IP Detection Works

The middleware detects client IP from:

1. `X-Forwarded-For` header (for proxies/load balancers)
2. `X-Real-IP` header (for nginx)
3. `req.socket.remoteAddress` (direct connection)

## Benefits

✅ **Zero Parameters** - No headers, no tokens, no cookies  
✅ **Seamless UX** - User pays and refreshes page  
✅ **Automatic Verification** - Checks Nano RPC for payment  
✅ **IP-Based Sessions** - Works as long as IP stays same  

## Limitations

⚠️ **IP Changes** - If user's IP changes, they'll need to pay again  
⚠️ **Shared IPs** - Multiple users behind same IP share access  
⚠️ **NAT/VPN** - Users behind NAT may share IP with others  
⚠️ **Mobile Networks** - IP can change frequently  

## Security Considerations

### When to Use

✅ **Good for:**
- Low-value content
- Single-user scenarios
- Development/testing
- Content that's okay to share

❌ **Not recommended for:**
- High-value transactions
- Multi-user environments
- Strict access control needed
- Financial transactions

### Best Practices

1. **Set usage limits:**
   ```typescript
   trackByIp: true,
   maxUsage: 1, // One-time use (most secure)
   // or
   maxUsage: 5, // Allow multiple accesses
   ```

2. **Set expiration:**
   ```typescript
   ttlSeconds: 3600, // Invoice expires in 1 hour
   sessionDuration: 3600, // Access valid for 1 hour after payment
   ```

3. **Use for specific resources:**
   ```typescript
   // Only track IP for public content
   trackByIp: true, // For /api/public-content
   trackByIp: false, // For /api/premium-content
   ```

## Comparison with Other Methods

| Method | Parameters | Security | UX | Use Case |
|--------|-----------|----------|-----|----------|
| **IP Tracking** (`trackByIp: true`) | None | Medium | ⭐⭐⭐⭐⭐ | Public content, dev |
| **Public Access** (`makeItPublic: true`) | None | Low | ⭐⭐⭐⭐⭐ | One payment, everyone benefits |
| **Explicit Proof** (Headers) | Headers | High | ⭐⭐ | Production, high-value |
| **Already Paid** | None | High | ⭐⭐⭐ | After first verification |

## Implementation Details

### Invoice Storage

Invoices are stored with `client_ip` field:

```typescript
interface Invoice {
  // ... other fields
  client_ip?: string; // Tracked IP address
}
```

### IP Lookup

```typescript
// Find invoice by IP
const invoice = await nano402.getInvoiceByClientIp("192.168.1.1", "/api/resource");

// Update invoice IP
await nano402.updateInvoiceClientIp(invoiceId, "192.168.1.1");
```

### Verification Flow

1. Check if IP has invoice → `findByClientIp(ip, resource)`
2. If invoice exists and is paid/used → ✅ Allow access
3. If invoice is pending → Check RPC for payment
4. If payment found → ✅ Allow access
5. If no invoice or not paid → Return 402

## Example: Complete Setup

```typescript
import express from "express";
import { Nano402, nano402Guard } from "@nano402/express";

const app = express();

const nano402 = new Nano402({
  walletSeed: process.env.NANO_SEED!,
  nanoRpcUrl: process.env.NANO_RPC_URL!,
});

// Public content - IP tracking enabled
app.get(
  "/api/public-content",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    trackByIp: true,
    maxUsage: undefined, // Allow unlimited accesses until expiration
    sessionDuration: 3600, // 1 hour session
  }),
  (req, res) => {
    res.json({ content: "Public premium content" });
  }
);

// Premium content - Explicit proof required
app.get(
  "/api/premium-content",
  nano402Guard(nano402, {
    amount_xno: "0.001",
    trackByIp: false, // Require headers
    maxUsage: 1, // One-time use
  }),
  (req, res) => {
    res.json({ content: "Premium content" });
  }
);
```

## Troubleshooting

### IP Not Detected

If IP shows as "unknown":
- Check proxy configuration
- Ensure `X-Forwarded-For` header is set
- Verify Express trust proxy settings: `app.set('trust proxy', true)`

### Multiple Users Same IP

If multiple users share IP:
- Each user gets their own invoice
- First payment unlocks for all users on that IP
- Consider using explicit proof for multi-user scenarios

### IP Changes

If user's IP changes:
- They'll need to pay again
- Consider using cookies/sessions for better tracking
- Or use explicit proof method

## Advanced: Custom IP Extraction

You can customize IP extraction by modifying the middleware or using a custom function:

```typescript
// In your Express app
app.set('trust proxy', true); // Trust proxy headers

// Custom IP extraction (if needed)
function getClientIp(req: Request): string {
  // Your custom logic
  return req.headers['custom-ip-header'] || req.ip;
}
```

