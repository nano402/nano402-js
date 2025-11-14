# Package Structure

This project has been refactored into separate packages to avoid code duplication and support multiple frameworks.

## Package Overview

### `@nano402/core`

**Framework-agnostic core library**

Contains all the business logic:

- `Nano402` class - Main payment handler
- Invoice stores (Memory, SQLite)
- RPC client for Nano network
- Payment verification logic
- Invoice management
- All types and errors

**No framework dependencies** - can be used with any Node.js framework.

### `@nano402/express`

**Express.js middleware**

Thin wrapper around `@nano402/core`:

- Express middleware (`nano402Guard`)
- Express-specific request/response handling
- Re-exports everything from `@nano402/core`

**Dependencies:**

- `@nano402/core` (workspace dependency)
- `express` (peer dependency)

### `@nano402/nestjs`

**NestJS guard**

NestJS-specific implementation:

- `Nano402Guard` class (implements `CanActivate`)
- NestJS `ExecutionContext` handling
- Re-exports everything from `@nano402/core`

**Dependencies:**

- `@nano402/core` (workspace dependency)
- `@nestjs/common`, `@nestjs/core` (peer dependencies)

## Benefits of This Structure

✅ **No Code Duplication** - Core logic lives in one place (`@nano402/core`)
✅ **Framework Independence** - Core can be used with any framework
✅ **Smaller Bundles** - Users only install what they need
✅ **Easy to Extend** - Adding Fastify, Koa, Hono, etc. is straightforward
✅ **Better Testing** - Test core logic separately from framework integrations
✅ **Maintainability** - Framework-specific code is isolated
✅ **Scoped Packages** - Professional organization with `@nano402/` namespace

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
import { Nano402 } from "@nano402/core";

const nano402 = new Nano402({ ... });
// Implement your own middleware/guard using nano402 methods
```

## Workspace Setup

All packages are managed in a pnpm workspace:

- `packages/nano402-core/` - Core library (`@nano402/core`)
- `packages/nano402-express/` - Express middleware (`@nano402/express`)
- `packages/nano402-nestjs/` - NestJS guard (`@nano402/nestjs`)

Dependencies use `workspace:*` protocol for local development.

**Note:** All packages use the `@nano402/` scope for better organization and to avoid naming conflicts.
