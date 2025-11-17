# Unpublishing @nano402/core from npm

This guide helps you unpublish `@nano402/core` since you're now using `nano402` instead.

## Current Status

- `@nano402/core` exists on npm with versions: 0.0.1, 0.0.11, 0.0.12, 0.0.34
- `nano402` is the new package name (version 0.0.13)

## Option 1: Unpublish Entire Package (Recommended if all versions < 72 hours)

If all versions of `@nano402/core` are less than 72 hours old, you can unpublish the entire package:

```bash
npm unpublish @nano402/core --force --otp=<YOUR_OTP_CODE>
```

**Note:** Replace `<YOUR_OTP_CODE>` with the 6-digit code from your authenticator app.

## Option 2: Unpublish Individual Versions

If some versions are older than 72 hours, unpublish them individually:

```bash
# Unpublish each version
npm unpublish @nano402/core@0.0.34 --otp=<YOUR_OTP_CODE>
npm unpublish @nano402/core@0.0.12 --otp=<YOUR_OTP_CODE>
npm unpublish @nano402/core@0.0.11 --otp=<YOUR_OTP_CODE>
npm unpublish @nano402/core@0.0.1 --otp=<YOUR_OTP_CODE>
```

## Option 3: Deprecate Instead (Safer Alternative)

If unpublishing isn't possible (versions > 72 hours), deprecate the package instead. This warns users but doesn't remove the package:

```bash
npm deprecate @nano402/core "This package has been deprecated. Please use 'nano402' instead. Install with: npm install nano402" --otp=<YOUR_OTP_CODE>
```

## Steps to Execute

1. **Get your OTP code** from your authenticator app (Google Authenticator, Authy, etc.)

2. **Choose your approach:**

   - If all versions are < 72 hours: Use Option 1
   - If some versions are > 72 hours: Use Option 2 or Option 3

3. **Run the command** with your OTP code

4. **Verify** the package is unpublished:
   ```bash
   npm view @nano402/core
   ```
   (Should return an error if successfully unpublished)

## Important Notes

- npm requires 2FA (two-factor authentication) for unpublishing/deprecating
- Packages older than 72 hours cannot be unpublished without contacting npm support
- Deprecation is safer and doesn't break existing installations
- After unpublishing, users who have `@nano402/core` installed will need to migrate to `nano402`

## After Unpublishing

1. Update any documentation that references `@nano402/core`
2. Update the PUBLISHING.md file to remove references to `@nano402/core`
3. Consider adding a note in your README about the package name change
