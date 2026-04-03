// ============================================================
// Admin API authentication middleware
// Uses Bearer token from Authorization header
// ============================================================

import { createMiddleware } from "hono/factory";
import { UnauthorizedError } from "../shared/errors.js";

interface AdminEnv {
  ADMIN_API_KEY: string;
}

/** Bearer token auth middleware for admin API */
export const adminAuth = createMiddleware<{ Bindings: AdminEnv }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      throw new UnauthorizedError("Missing Authorization header");
    }

    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedError("Invalid Authorization format. Expected: Bearer <token>");
    }

    const expectedKey = c.env.ADMIN_API_KEY;
    if (!expectedKey) {
      console.error("[Admin] ADMIN_API_KEY not configured");
      throw new UnauthorizedError("Server misconfigured");
    }

    // Constant-time comparison to prevent timing attacks
    const encoder = new TextEncoder();
    const a = encoder.encode(token);
    const b = encoder.encode(expectedKey);

    if (a.byteLength !== b.byteLength) {
      throw new UnauthorizedError("Invalid API key");
    }

    const keyA = await crypto.subtle.importKey("raw", a, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const keyB = await crypto.subtle.importKey("raw", b, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const dummy = encoder.encode("compare");
    const sigA = await crypto.subtle.sign("HMAC", keyA, dummy);
    const sigB = await crypto.subtle.sign("HMAC", keyB, dummy);

    const isEqual = timingSafeEqual(new Uint8Array(sigA), new Uint8Array(sigB));
    if (!isEqual) {
      throw new UnauthorizedError("Invalid API key");
    }

    await next();
  },
);

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}
