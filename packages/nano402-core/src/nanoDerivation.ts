/**
 * Nano address derivation using the standard nanocurrency library
 * This ensures compatibility with all Nano wallets including Nault, Natrium, etc.
 * 
 * Uses the official Nano derivation method:
 * 1. Derive secret key from seed + index
 * 2. Derive public key from secret key
 * 3. Derive address from public key
 */

import * as nanocurrency from "nanocurrency";

/**
 * Derive a Nano account address from a seed and index
 * 
 * This uses the nanocurrency library's standard derivation which is compatible
 * with all Nano wallets (Nault, Natrium, Nautilus, etc.)
 * 
 * @param seedHex - 64-character hex string seed
 * @param index - Account index (0, 1, 2, ...)
 * @returns Nano address with nano_ prefix
 */
export function deriveNanoAccount(seedHex: string, index: number): string {
  // Ensure seed is hex format (64 chars for 32 bytes)
  let seed = seedHex;
  if (seed.length < 64) {
    // Pad with zeros if needed
    seed = seed.padEnd(64, "0");
  }
  if (seed.length > 64) {
    // Truncate if too long
    seed = seed.slice(0, 64);
  }

  // Use nanocurrency library's standard derivation
  // This is the same method used by Nault, Natrium, and other wallets
  const privateKey = nanocurrency.deriveSecretKey(seed, index);
  const publicKey = nanocurrency.derivePublicKey(privateKey);
  let address = nanocurrency.deriveAddress(publicKey);
  
  // Normalize to nano_ prefix (nanocurrency may return xrb_ prefix)
  if (address.startsWith("xrb_")) {
    address = "nano_" + address.slice(4);
  }
  
  return address;
}

