# Publishing Guide

This guide explains how to publish the `@nano402/*` packages to npm.

## Prerequisites

1. **npm account** - You need an npm account
2. **Login to npm** - Run `npm login` in your terminal
3. **Publish access** - For scoped packages, you need to configure public access

## Important: Scoped Packages Configuration

Scoped packages (`@nano402/*`) are **private by default** on npm. To publish them as **public**, you need to configure npm:

```bash
# Set scoped packages to publish as public
npm config set @nano402:registry https://registry.npmjs.org/
npm config set //registry.npmjs.org/:_authToken YOUR_NPM_TOKEN
```

Or add to your `.npmrc` file in the project root:

```
@nano402:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

## Publishing Steps

### 1. Build All Packages

```bash
# Build all packages
pnpm build
```

### 2. Update Workspace Dependencies

Before publishing, you need to replace `workspace:*` with actual versions. You can do this manually or use a tool like `pnpm publish` which handles this automatically.

### 3. Publish in Order

**Important:** Publish `@nano402/core` first, then the dependent packages:

```bash
# 1. Publish core first
cd packages/nano402-core
npm publish --access public

# 2. Publish express (depends on core)
cd ../nano402-express
npm publish --access public

# 3. Publish nestjs (depends on core)
cd ../nano402-nestjs
npm publish --access public
```

### 4. Using pnpm (Recommended)

pnpm can handle workspace dependencies automatically:

```bash
# From project root
pnpm --filter @nano402/core publish --access public
pnpm --filter @nano402/express publish --access public
pnpm --filter @nano402/nestjs publish --access public
```

## Publishing Script

You can add a publish script to the root `package.json`:

```json
{
  "scripts": {
    "publish:all": "pnpm --filter @nano402/core publish --access public && pnpm --filter @nano402/express publish --access public && pnpm --filter @nano402/nestjs publish --access public",
    "publish:core": "pnpm --filter @nano402/core publish --access public",
    "publish:express": "pnpm --filter @nano402/express publish --access public",
    "publish:nestjs": "pnpm --filter @nano402/nestjs publish --access public"
  }
}
```

Then run:

```bash
pnpm publish:all
```

## Version Management

All packages should have the same version. To update versions:

```bash
# Update version in all packages
pnpm --filter "@nano402/*" version patch  # or minor, major
```

Or manually update `package.json` files and run:

```bash
pnpm install  # Updates lockfile
```

## Pre-Publish Checklist

- [ ] All packages are built (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Version numbers are consistent across packages
- [ ] `workspace:*` dependencies will be resolved (pnpm handles this)
- [ ] `.npmrc` is configured for public scoped packages
- [ ] You're logged into npm (`npm whoami`)

## Dry Run

Test publishing without actually publishing:

```bash
npm publish --dry-run --access public
```

## Troubleshooting

### "You do not have permission to publish"

- Make sure you're logged in: `npm whoami`
- Check if the package name is already taken
- For scoped packages, ensure you have the right npm organization/user

### "Package name already exists"

- The package name is already published
- You need to use a different name or unpublish (if it's yours)

### Workspace dependencies not resolved

- pnpm automatically resolves `workspace:*` during publish
- If using npm, you'll need to manually replace `workspace:*` with the published version

## After Publishing

1. **Verify** packages are published:

   ```bash
   npm view @nano402/core
   npm view @nano402/express
   npm view @nano402/nestjs
   ```

2. **Test installation**:

   ```bash
   npm install @nano402/express
   ```

3. **Update documentation** if needed

## Continuous Publishing (CI/CD)

For automated publishing, you can use GitHub Actions or similar:

```yaml
# .github/workflows/publish.yml
name: Publish
on:
  release:
    types: [created]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
          registry-url: "https://registry.npmjs.org"
      - run: pnpm install
      - run: pnpm build
      - run: pnpm --filter @nano402/core publish --access public
      - run: pnpm --filter @nano402/express publish --access public
      - run: pnpm --filter @nano402/nestjs publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
