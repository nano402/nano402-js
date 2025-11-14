import { InvalidAmountError } from "./errors";

// Maximum value: 2^128 - 1 raw (Nano's maximum supply)
const MAX_RAW = "340282366920938463463374607431768211455";
const MAX_XNO = "340282366.920938463463374607431768211455";

/**
 * Validate and convert XNO to raw (1 XNO = 10^30 raw)
 * 
 * @param xno - XNO amount as string (e.g., "1.5", "0.001", "100")
 * @returns Raw amount as string
 * @throws InvalidAmountError if input is invalid
 */
export function xnoToRaw(xno: string): string {
  // Validate input
  if (!xno || typeof xno !== "string") {
    throw new InvalidAmountError("Amount must be a non-empty string");
  }

  // Remove whitespace
  const trimmed = xno.trim();
  if (!trimmed) {
    throw new InvalidAmountError("Amount cannot be empty");
  }

  // Check for scientific notation (not supported)
  if (/[eE]/.test(trimmed)) {
    throw new InvalidAmountError("Scientific notation is not supported");
  }

  // Validate format: optional sign, digits, optional decimal point, digits
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError(
      "Invalid format. Expected decimal number (e.g., '1.5' or '100')"
    );
  }

  // Check for negative values
  if (trimmed.startsWith("-")) {
    throw new InvalidAmountError("Amount cannot be negative");
  }

  // Split into integer and decimal parts
  const parts = trimmed.split(".");
  const integer = parts[0] || "0";
  const decimal = parts[1] || "";

  // Validate decimal precision (max 30 digits)
  if (decimal.length > 30) {
    throw new InvalidAmountError(
      "Amount cannot have more than 30 decimal places"
    );
  }

  // Pad decimal to exactly 30 digits
  const paddedDecimal = (decimal + "0".repeat(30)).slice(0, 30);

  // Combine integer and decimal parts
  const combined = integer + paddedDecimal;

  // Remove leading zeros but keep at least one digit
  const cleaned = combined.replace(/^0+/, "") || "0";

  // Check maximum value
  if (cleaned.length > MAX_RAW.length) {
    throw new InvalidAmountError(`Amount exceeds maximum value of ${MAX_XNO} XNO`);
  }

  if (cleaned.length === MAX_RAW.length && cleaned > MAX_RAW) {
    throw new InvalidAmountError(`Amount exceeds maximum value of ${MAX_XNO} XNO`);
  }

  return cleaned;
}

/**
 * Convert raw to XNO (1 XNO = 10^30 raw)
 * 
 * @param raw - Raw amount as string
 * @returns XNO amount as string with up to 30 decimal places
 */
export function rawToXno(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new InvalidAmountError("Raw amount must be a non-empty string");
  }

  // Remove leading zeros
  const cleaned = raw.replace(/^0+/, "") || "0";

  // Pad to at least 31 digits (30 decimal + 1 integer)
  const padded = cleaned.padStart(31, "0");

  // Split into integer and decimal parts
  const integer = padded.slice(0, -30) || "0";
  const decimal = padded.slice(-30);

  // Remove trailing zeros from decimal part
  const trimmedDecimal = decimal.replace(/0+$/, "");

  if (trimmedDecimal) {
    return `${integer}.${trimmedDecimal}`;
  }

  return integer;
}

