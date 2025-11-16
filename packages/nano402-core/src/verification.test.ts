import { describe, it, expect } from "vitest";
import {
  calculateRetryAfter,
  isSessionValid,
  isUsageExceeded,
  getPaymentInfo,
  getClientIp,
  type RequestLike,
} from "./verification";

describe("verification utilities", () => {
  describe("calculateRetryAfter", () => {
    it("should calculate seconds until expiration", () => {
      const future = new Date(Date.now() + 5000).toISOString();
      const retryAfter = calculateRetryAfter(future);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(5);
    });

    it("should return 0 for expired dates", () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const retryAfter = calculateRetryAfter(past);
      expect(retryAfter).toBe(0);
    });
  });

  describe("isSessionValid", () => {
    it("should return false if invoice has no paid_at", () => {
      const invoice = { expires_at: new Date().toISOString() };
      expect(isSessionValid(invoice)).toBe(false);
    });

    it("should return true if sessionDuration is undefined and invoice not expired", () => {
      const future = new Date(Date.now() + 10000).toISOString();
      const invoice = {
        paid_at: new Date().toISOString(),
        expires_at: future,
      };
      expect(isSessionValid(invoice)).toBe(true);
    });

    it("should return false if sessionDuration is undefined and invoice expired", () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const invoice = {
        paid_at: past,
        expires_at: past,
      };
      expect(isSessionValid(invoice)).toBe(false);
    });

    it("should return true if session is within duration", () => {
      const invoice = {
        paid_at: new Date(Date.now() - 1000).toISOString(),
      };
      expect(isSessionValid(invoice, 10)).toBe(true);
    });

    it("should return false if session exceeded duration", () => {
      const invoice = {
        paid_at: new Date(Date.now() - 2000).toISOString(),
      };
      expect(isSessionValid(invoice, 1)).toBe(false);
    });
  });

  describe("isUsageExceeded", () => {
    it("should return false if maxUsage is undefined", () => {
      const invoice = { access_count: 100 };
      expect(isUsageExceeded(invoice)).toBe(false);
    });

    it("should return false if access_count is below maxUsage", () => {
      const invoice = { access_count: 3 };
      expect(isUsageExceeded(invoice, 5)).toBe(false);
    });

    it("should return true if access_count equals maxUsage", () => {
      const invoice = { access_count: 5 };
      expect(isUsageExceeded(invoice, 5)).toBe(true);
    });

    it("should return true if access_count exceeds maxUsage", () => {
      const invoice = { access_count: 10 };
      expect(isUsageExceeded(invoice, 5)).toBe(true);
    });

    it("should handle missing access_count", () => {
      const invoice = {};
      expect(isUsageExceeded(invoice, 5)).toBe(false);
    });
  });

  describe("getPaymentInfo", () => {
    it("should generate personal access type by default", () => {
      const info = getPaymentInfo({});
      expect(info.access_type).toBe("personal");
      expect(info.verification_methods).toContain(
        "Proof-based: use X-402-Request-Id and X-402-Proof (transaction hash) headers"
      );
    });

    it("should generate public access type when makeItPublic is true", () => {
      const info = getPaymentInfo({ makeItPublic: true });
      expect(info.access_type).toBe("public");
      expect(info.access_details).toContain(
        "After payment, this content will be publicly accessible to everyone"
      );
    });

    it("should generate ip-based access type when trackByIp is true", () => {
      const info = getPaymentInfo({ trackByIp: true });
      expect(info.access_type).toBe("ip-based");
      expect(info.access_details).toContain(
        "After payment, this content will be unlocked for your IP address"
      );
    });

    it("should include session duration information", () => {
      const info = getPaymentInfo({ sessionDuration: 3600 });
      expect(info.access_details.some((detail) =>
        detail.includes("Access duration")
      )).toBe(true);
    });

    it("should include max usage information", () => {
      const info = getPaymentInfo({ maxUsage: 5 });
      expect(info.access_details.some((detail) =>
        detail.includes("Maximum 5 access")
      )).toBe(true);
    });
  });

  describe("getClientIp", () => {
    it("should extract IP from x-forwarded-for header", () => {
      const req: RequestLike = {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      };
      expect(getClientIp(req)).toBe("192.168.1.1");
    });

    it("should extract IP from x-real-ip header", () => {
      const req: RequestLike = {
        headers: {
          "x-real-ip": "192.168.1.2",
        },
      };
      expect(getClientIp(req)).toBe("192.168.1.2");
    });

    it("should extract IP from socket remoteAddress", () => {
      const req: RequestLike = {
        socket: {
          remoteAddress: "192.168.1.3",
        },
      };
      expect(getClientIp(req)).toBe("192.168.1.3");
    });

    it("should normalize IPv6 localhost", () => {
      const req: RequestLike = {
        socket: {
          remoteAddress: "::1",
        },
      };
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("should fallback to default localhost", () => {
      const req: RequestLike = {};
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("should use req.ip if available", () => {
      const req: RequestLike = {
        ip: "192.168.1.4",
      };
      expect(getClientIp(req)).toBe("192.168.1.4");
    });
  });
});

