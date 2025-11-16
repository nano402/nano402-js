# Package Structure

This project has been refactored into separate packages to avoid code duplication and support multiple frameworks.

## Package Overview

### `nano402`

**Framework-agnostic core library**

Contains all the business logic:

- `Nano402` class - Main payment handler
- Invoice stores (Memory, SQLite)
- RPC client for Nano network
- Payment verification logic
- Invoice management
- **Verification utilities** - Shared helpers (`calculateRetryAfter`, `isSessionValid`, `isUsageExceeded`, `getPaymentInfo`, `getClientIp`)
- **Guard logic** - Framework-agnostic verification handler (`handleGuardRequest`, `generate402Response`)
- All types and errors

**No framework dependencies** - can be used with any Node.js framework.

**Architecture:** The core package contains all shared verification logic, eliminating code duplication between framework packages. Framework packages are thin wrappers that adapt the core logic to their specific patterns.

### `@nano402/express`

**Express.js middleware**

Thin wrapper around `nano402` (~126 lines):

- Express middleware (`nano402Guard`)
- Express-specific request/response handling
- Uses shared verification logic from core
- Re-exports everything from `nano402`

**Dependencies:**

- `nano402` (workspace dependency)
- `express` (peer dependency)

**Implementation:** The middleware uses `handleGuardRequest` from core and adapts the result to Express's middleware pattern (`next()` callback).

### `@nano402/nestjs`

**NestJS guard**

NestJS-specific implementation (~200 lines):

- `Nano402Guard` class (implements `CanActivate`)
- NestJS `ExecutionContext` handling
- Uses shared verification logic from core
- Re-exports everything from `nano402`

**Dependencies:**

- `nano402` (workspace dependency)
- `@nestjs/common`, `@nestjs/core` (peer dependencies)

**Implementation:** The guard uses `handleGuardRequest` from core and adapts the result to NestJS's guard pattern (returns `boolean`).

## Benefits of This Structure

✅ **No Code Duplication** - Core logic lives in one place (`nano402`)
✅ **Framework Independence** - Core can be used with any framework
✅ **Smaller Bundles** - Users only install what they need
✅ **Easy to Extend** - Adding Fastify, Koa, Hono, etc. is straightforward
✅ **Better Testing** - Test core logic separately from framework integrations
✅ **Maintainability** - Framework-specific code is isolated (Express: ~126 lines, NestJS: ~200 lines)
✅ **Scoped Packages** - Professional organization with `@nano402/` namespace
✅ **Shared Verification Logic** - All verification helpers and guard logic centralized in core

## Usage Examples

### Express

```typescript
import { Nano402, nano402Guard } from "@nano402/express";

const nano402 = new Nano402({ ... });
app.get("/api/protected", nano402Guard(nano402, { ... }), handler);
```

### NestJS

```typescript
import { Nano402, Nano402Guard } from "@nano402/nestjs";

@Controller("api")
export class AppController {
  constructor(private readonly nano402: Nano402) {}

  @Get("protected")
  @UseGuards(new Nano402Guard(this.nano402, { ... }))
  getProtected() {
    return { secret: "Protected data!" };
  }
}
```

### Core Only (Custom Framework)

```typescript
import { Nano402, handleGuardRequest, generate402Response, getClientIp } from "nano402";

const nano402 = new Nano402({ ... });

// Use shared guard logic
const guardRequest = {
  path: req.path,
  headers: req.headers,
  getClientIp: () => getClientIp(req),
};

const result = await handleGuardRequest(nano402, guardRequest, options);
if (result.type === "grant") {
  // Grant access
} else if (result.type === "deny") {
  // Return 402 response using generate402Response
}
```

## Workspace Setup

All packages are managed in a pnpm workspace:

- `packages/nano402-core/` - Core library (`nano402`)
- `packages/nano402-express/` - Express middleware (`@nano402/express`)
- `packages/nano402-nestjs/` - NestJS guard (`@nano402/nestjs`)

Dependencies use `workspace:*` protocol for local development.

**Note:** All packages use the `@nano402/` scope for better organization and to avoid naming conflicts.
