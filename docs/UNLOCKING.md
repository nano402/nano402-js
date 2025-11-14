# Unlocking Protected Resources

There are **four ways** to unlock access to a protected resource:

## 1. **With Headers (Explicit Proof)** 🔐

Send the invoice ID and transaction hash as headers:

```bash
curl -H "X-402-Request-Id: <invoice_id>" \
     -H "X-402-Proof: <tx_hash>" \
     http://localhost:3000/api/secret-data
```

**Pros:**

- ✅ Most secure
- ✅ Immediate verification
- ✅ Works even if invoice was paid long ago

**Cons:**

- ❌ Requires client to track invoice ID and tx hash
- ❌ More complex client implementation

## 2. **IP-Based Tracking** 🌐

Enable `trackByIp: true` to automatically track payments by client IP address:

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  trackByIp: true, // Enable IP-based tracking
});
```

**Usage:**

```bash
# First request - returns 402 with invoice
curl http://localhost:3000/api/secret-data

# Pay the invoice using nano_uri from response

# Second request from same IP - automatically works!
curl http://localhost:3000/api/secret-data  # ✅ No headers needed!
```

**How it works:**

- Server tracks invoices by client IP address
- When payment is verified, access is granted for that IP
- Server automatically checks for payments on each request
- No headers required after payment

**Pros:**

- ✅ **Zero parameters needed** - just make the request
- ✅ Seamless UX - user pays and refreshes page
- ✅ Works immediately after payment
- ✅ Automatic payment verification

**Cons:**

- ⚠️ Requires RPC call on each request (cached for performance)
- ⚠️ IP can change (mobile networks, VPN, etc.)
- ⚠️ Multiple users behind same IP share access

## 3. **Public Access** 🌍

Enable `makeItPublic: true` to make content publicly accessible after first payment:

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  makeItPublic: true, // Content becomes public after payment
});
```

**Usage:**

```bash
# First request - returns 402 with invoice
curl http://localhost:3000/api/secret-data

# Anyone pays the invoice

# All subsequent requests work for everyone!
curl http://localhost:3000/api/secret-data  # ✅ Works for everyone!
```

**How it works:**

- After first payment is verified, content becomes publicly accessible
- No headers or IP tracking needed
- Works for all users until session expires

**Pros:**

- ✅ **One payment, everyone benefits**
- ✅ Zero parameters needed
- ✅ Best UX for public content

**Cons:**

- ⚠️ Lowest security - anyone can access after first payment
- ⚠️ Only one person needs to pay

## 4. **Already Paid/Used** ✨

If an invoice for that resource is already paid/used, access is granted automatically:

```bash
# First request - returns 402 with invoice
curl http://localhost:3000/api/secret-data

# After payment verification (with headers), subsequent requests work automatically
curl http://localhost:3000/api/secret-data  # ✅ No headers needed!
```

**How it works:**

- Server checks if invoice exists for the resource path
- If invoice status is `paid` or `used`, access is granted
- No headers required

**Pros:**

- ✅ Simple - just make the request
- ✅ Works after first verification

**Cons:**

- ❌ Requires first verification with headers
- ❌ Only works for same resource path

## Comparison

| Method             | Headers Required | First Request  | Subsequent Requests | Security   | Use Case |
| ------------------ | ---------------- | -------------- | ------------------- | ---------- | -------- |
| **Explicit Proof** | ✅ Yes           | ✅ Works       | ✅ Works            | 🔒 Highest | Production, high-value |
| **IP-Based**       | ❌ No            | ❌ Returns 402 | ✅ Works            | 🔒 Medium  | Single-user, dev |
| **Public Access**  | ❌ No            | ❌ Returns 402 | ✅ Works (all users) | 🔒 Low     | Public content |
| **Already Paid**   | ❌ No            | ❌ Returns 402 | ✅ Works            | 🔒 High    | After first verification |

## Recommended Usage

### For Production (High Security)

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  trackByIp: false, // Require explicit proof headers
  makeItPublic: false,
  maxUsage: 1, // One-time use
  sessionDuration: 3600, // 1 hour session
});
```

### For User-Friendly Apps

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  trackByIp: true, // Enable IP-based tracking
  maxUsage: 5, // Allow multiple accesses
  sessionDuration: 3600, // 1 hour session
});
```

### For Public Content

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  makeItPublic: true, // Content becomes public after payment
  sessionDuration: 3600, // 1 hour session
});
```

### For Testing/Development

```typescript
import { nano402Guard } from "@nano402/express";

nano402Guard(nano402, {
  amount_xno: "0.00001",
  trackByIp: true, // Easy testing without headers
  maxUsage: undefined, // Unlimited access
});
```

## Example Flow

### With IP-Based Tracking

```javascript
// 1. User requests protected resource
const response1 = await fetch("/api/secret-data");
// Returns: 402 Payment Required
// Body: { nano_uri: "nano:...", request_id: "..." }

// 2. User pays using nano_uri (in wallet app)

// 3. User refreshes page / makes same request from same IP
const response2 = await fetch("/api/secret-data");
// ✅ Returns: 200 OK with protected data
// No headers needed! Server automatically verifies payment for this IP
```

### With Public Access

```javascript
// 1. First user requests protected resource
const response1 = await fetch("/api/secret-data");
// Returns: 402 Payment Required

// 2. First user pays using nano_uri

// 3. Any user makes request (no payment needed)
const response2 = await fetch("/api/secret-data");
// ✅ Returns: 200 OK with protected data
// Content is now public for everyone!
```

### With Explicit Proof

```javascript
// 1. User requests protected resource
const response1 = await fetch("/api/secret-data");
// Returns: 402 Payment Required
const { request_id, nano_account } = await response1.json();

// 2. User pays using nano_uri
// User gets tx_hash from wallet

// 3. User makes request with proof
const response2 = await fetch("/api/secret-data", {
  headers: {
    "X-402-Request-Id": request_id,
    "X-402-Proof": tx_hash,
  },
});
// ✅ Returns: 200 OK with protected data
```

## Security Considerations

1. **IP-Based Tracking**: Medium security. Convenient but IP can change. Use for low-value content or single-user scenarios.

2. **Public Access**: Lowest security. One payment unlocks for everyone. Use only for public content where sharing is acceptable.

3. **Explicit Proof**: Most secure. Use for high-value transactions or when you need proof of payment.

4. **Already Paid**: Good balance. Works after first verification, but requires initial proof.

5. **Usage Limits** (`maxUsage`):
   - `1`: Invoice can only be used once (most secure)
   - `undefined`: Unlimited usage until expiration (better UX, less secure)
   - `5`: Limited usage (balanced)

6. **Session Duration** (`sessionDuration`):
   - When set: Access expires after specified duration from payment time
   - When `undefined`: Access lasts until invoice expires

## Performance

- **IP-Based Tracking**: Makes RPC call on each request if invoice is pending (cached for 5 seconds by default)
- **Public Access**: Makes RPC call on each request if invoice is pending (cached for 5 seconds by default)
- **Explicit Proof**: No RPC call needed (uses provided proof)
- **Already Paid**: No RPC call needed (checks local invoice status)

For high-traffic scenarios, prefer explicit proof or already-paid methods. IP-based and public access methods will automatically verify payments via RPC when invoices are pending, which adds a small latency.
