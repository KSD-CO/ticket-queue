// ============================================================
// Admin API rate limiting middleware
//
// Uses KV-based fixed window counter. Each API key gets a
// counter per time window. When the counter exceeds the limit,
// returns 429 Too Many Requests.
//
// KV key format: ratelimit:{window}:{key_prefix}
// Counter is approximate (no atomic increment in KV), but
// sufficient for admin API abuse protection.
// ============================================================

import { createMiddleware } from "hono/factory";
import {
  ADMIN_RATE_LIMIT_MAX,
  ADMIN_RATE_LIMIT_WINDOW_SECONDS,
} from "../shared/constants.js";
import { RateLimitError } from "../shared/errors.js";

interface RateLimitEnv {
  CONFIG_KV: KVNamespace;
  ADMIN_API_KEY: string;
}

/**
 * Rate limiting middleware for admin API endpoints.
 * Uses a fixed window counter stored in KV.
 *
 * - 100 requests per 60-second window (configurable via constants)
 * - Returns 429 with Retry-After header when limit exceeded
 * - Keyed by API key prefix (first 8 chars) to avoid storing full key in KV
 * - KV entry auto-expires after 2x window duration
 */
export const adminRateLimit = createMiddleware<{ Bindings: RateLimitEnv }>(
  async (c, next) => {
    const apiKey = c.req.header("Authorization")?.replace("Bearer ", "") ?? "unknown";
    // Use a prefix of the key as identifier (don't store full key in KV key names)
    const keyPrefix = apiKey.slice(0, 8);
    const window = Math.floor(Date.now() / 1000 / ADMIN_RATE_LIMIT_WINDOW_SECONDS);
    const kvKey = `ratelimit:${window}:${keyPrefix}`;

    try {
      const raw = await c.env.CONFIG_KV.get(kvKey);
      const count = raw ? parseInt(raw, 10) : 0;

      if (!isNaN(count) && count >= ADMIN_RATE_LIMIT_MAX) {
        // Calculate seconds remaining in this window
        const windowStart = window * ADMIN_RATE_LIMIT_WINDOW_SECONDS;
        const windowEnd = windowStart + ADMIN_RATE_LIMIT_WINDOW_SECONDS;
        const retryAfter = Math.max(1, windowEnd - Math.floor(Date.now() / 1000));
        throw new RateLimitError(retryAfter);
      }

      // Increment counter. We await the write to ensure it completes
      // before the response is sent. KV writes are fast (~10ms) and this
      // avoids issues with isolated storage in tests and with Workers
      // potentially cancelling background writes.
      const newCount = (isNaN(count) ? 0 : count) + 1;
      try {
        await c.env.CONFIG_KV.put(kvKey, String(newCount), {
          // Auto-expire after 2x window to clean up old entries
          expirationTtl: ADMIN_RATE_LIMIT_WINDOW_SECONDS * 2,
        });
      } catch (e) {
        console.error("[Admin] Rate limit KV write failed:", e);
      }
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      // KV error → fail open (don't block requests if rate limit is broken)
      console.error("[Admin] Rate limit check failed, allowing request:", e);
    }

    await next();
  },
);
