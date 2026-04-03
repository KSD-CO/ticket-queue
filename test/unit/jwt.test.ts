import { describe, test, expect } from "vitest";
import { signToken, verifyToken, type QueueTokenClaims } from "../../src/shared/jwt.js";

const TEST_SECRET = "test-secret-key-for-jwt-testing-only";

function makeClaims(overrides: Partial<QueueTokenClaims> = {}): QueueTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "visitor-123",
    evt: "event-abc",
    iat: now,
    exp: now + 1800, // 30 min
    pos: 42,
    ...overrides,
  };
}

describe("JWT", () => {
  describe("signToken", () => {
    test("produces a three-segment JWT string", async () => {
      const token = await signToken(makeClaims(), TEST_SECRET);
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
      // Each part should be non-empty base64url
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    test("different secrets produce different signatures", async () => {
      const claims = makeClaims();
      const token1 = await signToken(claims, "secret-a");
      const token2 = await signToken(claims, "secret-b");
      const sig1 = token1.split(".")[2];
      const sig2 = token2.split(".")[2];
      expect(sig1).not.toBe(sig2);
    });

    test("same input produces same output (deterministic)", async () => {
      const claims = makeClaims();
      const token1 = await signToken(claims, TEST_SECRET);
      const token2 = await signToken(claims, TEST_SECRET);
      expect(token1).toBe(token2);
    });
  });

  describe("verifyToken", () => {
    test("round-trip: sign then verify returns original claims", async () => {
      const claims = makeClaims();
      const token = await signToken(claims, TEST_SECRET);
      const decoded = await verifyToken(token, TEST_SECRET);
      expect(decoded.sub).toBe(claims.sub);
      expect(decoded.evt).toBe(claims.evt);
      expect(decoded.iat).toBe(claims.iat);
      expect(decoded.exp).toBe(claims.exp);
      expect(decoded.pos).toBe(claims.pos);
    });

    test("rejects token with wrong secret", async () => {
      const token = await signToken(makeClaims(), TEST_SECRET);
      await expect(verifyToken(token, "wrong-secret")).rejects.toThrow("signature invalid");
    });

    test("rejects tampered payload", async () => {
      const token = await signToken(makeClaims(), TEST_SECRET);
      const parts = token.split(".");
      // Tamper with payload
      parts[1] = parts[1]! + "X";
      const tampered = parts.join(".");
      await expect(verifyToken(tampered, TEST_SECRET)).rejects.toThrow();
    });

    test("rejects malformed token (wrong segment count)", async () => {
      await expect(verifyToken("not.a.valid.jwt.token", TEST_SECRET)).rejects.toThrow();
      await expect(verifyToken("only-one-part", TEST_SECRET)).rejects.toThrow();
      await expect(verifyToken("two.parts", TEST_SECRET)).rejects.toThrow();
    });

    test("rejects expired token", async () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = makeClaims({ iat: now - 7200, exp: now - 3600 }); // expired 1 hour ago
      const token = await signToken(claims, TEST_SECRET);
      await expect(verifyToken(token, TEST_SECRET)).rejects.toThrow("expired");
    });

    test("accepts expired token within grace period", async () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = makeClaims({ iat: now - 3600, exp: now - 60 }); // expired 60s ago
      const token = await signToken(claims, TEST_SECRET);
      // Grace period of 300 seconds — should pass
      const decoded = await verifyToken(token, TEST_SECRET, 300);
      expect(decoded.sub).toBe(claims.sub);
    });

    test("rejects expired token past grace period", async () => {
      const now = Math.floor(Date.now() / 1000);
      const claims = makeClaims({ iat: now - 7200, exp: now - 3600 }); // expired 1 hour ago
      const token = await signToken(claims, TEST_SECRET);
      // Grace period of 300 seconds — still expired
      await expect(verifyToken(token, TEST_SECRET, 300)).rejects.toThrow("expired");
    });

    test("rejects token with missing required claims", async () => {
      // Manually construct a token with incomplete claims
      const incompleteClaims = { sub: "visitor-123" }; // missing evt, iat, exp
      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const payload = btoa(JSON.stringify(incompleteClaims))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      // Sign it properly
      const encoder = new TextEncoder();
      const keyData = encoder.encode(TEST_SECRET);
      const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigData = encoder.encode(`${header}.${payload}`);
      const sigBuffer = await crypto.subtle.sign("HMAC", key, sigData);
      const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const token = `${header}.${payload}.${sig}`;
      await expect(verifyToken(token, TEST_SECRET)).rejects.toThrow("Missing required claims");
    });
  });
});
