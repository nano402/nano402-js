import type { Invoice } from "./types";

/**
 * Calculate Retry-After header value in seconds
 */
export function calculateRetryAfter(expiresAt: string): number {
  const expires = new Date(expiresAt).getTime();
  const now = Date.now();
  const seconds = Math.ceil((expires - now) / 1000);
  return Math.max(0, seconds);
}

/**
 * Check if a session is still valid based on paid_at timestamp and session duration
 * When sessionDuration is undefined, session is valid as long as invoice hasn't expired
 */
export function isSessionValid(
  invoice: { paid_at?: string; expires_at?: string },
  sessionDuration?: number
): boolean {
  if (!invoice.paid_at) {
    // No payment timestamp means session hasn't started yet
    return false;
  }

  // If sessionDuration is undefined, check invoice expiration instead
  if (sessionDuration === undefined) {
    if (!invoice.expires_at) {
      return true; // No expiration, always valid
    }
    const expiresAt = new Date(invoice.expires_at).getTime();
    const now = Date.now();
    return now < expiresAt;
  }

  // Check session duration
  const paidAt = new Date(invoice.paid_at).getTime();
  const now = Date.now();
  const sessionExpiresAt = paidAt + sessionDuration * 1000;

  return now < sessionExpiresAt;
}

/**
 * Check if invoice has exceeded max usage
 */
export function isUsageExceeded(
  invoice: { access_count?: number },
  maxUsage?: number
): boolean {
  if (maxUsage === undefined) {
    return false; // Unlimited usage
  }
  const accessCount = invoice.access_count || 0;
  return accessCount >= maxUsage;
}

/**
 * Generate helpful payment information based on configuration
 */
export function getPaymentInfo(options: {
  makeItPublic?: boolean;
  trackByIp?: boolean;
  sessionDuration?: number;
  maxUsage?: number;
}): {
  access_type: string;
  access_details: string[];
  verification_methods: string[];
} {
  const accessDetails: string[] = [];
  const verificationMethods: string[] = [];

  // Determine access type
  let accessType = "personal";
  if (options.makeItPublic) {
    accessType = "public";
    accessDetails.push(
      "After payment, this content will be publicly accessible to everyone"
    );
  } else if (options.trackByIp) {
    accessType = "ip-based";
    accessDetails.push(
      "After payment, this content will be unlocked for your IP address"
    );
  } else {
    accessDetails.push(
      "After payment, use X-402-Request-Id and X-402-Proof (transaction hash) headers to access"
    );
  }

  // Session duration information
  if (options.sessionDuration !== undefined) {
    const minutes = Math.floor(options.sessionDuration / 60);
    const seconds = options.sessionDuration % 60;
    let durationText = "";
    if (minutes > 0 && seconds > 0) {
      durationText = `${minutes} minute${
        minutes > 1 ? "s" : ""
      } and ${seconds} second${seconds > 1 ? "s" : ""}`;
    } else if (minutes > 0) {
      durationText = `${minutes} minute${minutes > 1 ? "s" : ""}`;
    } else {
      durationText = `${seconds} second${seconds > 1 ? "s" : ""}`;
    }
    accessDetails.push(`Access duration: ${durationText} from payment time`);
  } else {
    accessDetails.push("Access duration: Until invoice expires");
  }

  // Max usage information
  if (options.maxUsage !== undefined) {
    accessDetails.push(
      `Maximum ${options.maxUsage} access${
        options.maxUsage > 1 ? "es" : ""
      } allowed`
    );
  } else {
    accessDetails.push("Unlimited access until expiration");
  }

  // Verification methods
  if (options.makeItPublic) {
    verificationMethods.push("No verification needed - content becomes public");
  } else if (options.trackByIp) {
    verificationMethods.push(
      "IP-based: Access automatically from same IP address"
    );
    verificationMethods.push(
      "Proof-based: use X-402-Request-Id and X-402-Proof (transaction hash) headers"
    );
  } else {
    verificationMethods.push(
      "Proof-based: use X-402-Request-Id and X-402-Proof (transaction hash) headers"
    );
  }

  return {
    access_type: accessType,
    access_details: accessDetails,
    verification_methods: verificationMethods,
  };
}

/**
 * Framework-agnostic interface for extracting client IP from request
 */
export interface RequestLike {
  headers?: {
    [key: string]: string | string[] | undefined;
  };
  socket?: {
    remoteAddress?: string;
  };
  ip?: string;
}

/**
 * Get client IP address from request (framework-agnostic)
 */
export function getClientIp(req: RequestLike): string {
  // Check various headers for IP (handles proxies, load balancers, etc.)
  const forwarded = req.headers?.["x-forwarded-for"] as string | undefined;
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    const ip = forwarded.split(",")[0].trim();
    if (ip) return ip;
  }

  const realIp = req.headers?.["x-real-ip"] as string | undefined;
  if (realIp) {
    return realIp;
  }

  // Fallback to connection remote address (check if socket exists)
  if (req.socket) {
    const remoteAddress = req.socket.remoteAddress;
    if (remoteAddress) {
      // Normalize IPv6 localhost
      if (remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1") {
        return "127.0.0.1";
      }
      return remoteAddress;
    }
  }

  // Last resort: use req.ip if available
  if (req.ip && req.ip !== "::1") {
    return req.ip;
  }

  return "127.0.0.1"; // Default to localhost instead of "unknown"
}

