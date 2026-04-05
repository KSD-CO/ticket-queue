# TODOS — Deferred Work Items

Items identified during the mega plan review. Sorted by priority.
Completed items are marked with ~~strikethrough~~.

---

## ~~P1: Threshold Mode~~ ✓ DONE

**Status:** Implemented
**Implementation:**
- DO alarm writes active visitor count to KV key `queue_count:{eventId}` every tick (10s TTL, auto-expires if DO stops running)
- Gateway reads this KV key when `mode === "threshold"`. If count < `activationThreshold`, bypasses queue and proxies to origin directly
- Config validation: `activationThreshold` required when `mode === "threshold"`, must be >= 1
- Fails open: if KV read fails or key is missing, count defaults to 0 → traffic below threshold → skip queue

---

## ~~P2: `broadcastPositionUpdates` O(N) Fix~~ ✓ DONE

**Status:** Implemented
**Before:** O(N) — one `SELECT position FROM visitors WHERE visitor_id = ?` per WebSocket per alarm tick. At 50K visitors = 50K queries/second.
**After:** O(1) — single `SELECT visitor_id, position FROM visitors WHERE released_at IS NULL ORDER BY position ASC`, build map, iterate sockets from map. Relative positions are computed from the sorted array index (no per-socket SQL).

---

## ~~P2: Cookie `max-age` ↔ `tokenTtlSeconds` Sync~~ ✓ DONE

**Status:** Implemented
**Implementation:** `injectTokenCookieRefresh()` in `gateway.ts` — after verifying a valid token and proxying to origin, injects a `Set-Cookie` header:
```
Set-Cookie: __queue_token={jwt}; Path=/; Max-Age={remaining_ttl}; HttpOnly; Secure; SameSite=Lax
```
`Max-Age` = `claims.exp - now + TOKEN_GRACE_PERIOD_SECONDS`, so the cookie expires when the JWT does.

---

## ~~P2: Admin API Rate Limiting~~ ✓ DONE

**Status:** Implemented
**Implementation:** KV-based fixed window counter in `src/admin/rate-limit.ts`:
- 100 requests per 60-second window per API key (configurable via constants)
- Key format: `ratelimit:{window}:{key_prefix}` (first 8 chars of API key)
- Returns 429 with `Retry-After` header when limit exceeded
- KV entries auto-expire after 2x window duration
- Fails open: if KV read/write fails, allows the request through
- New error class: `RateLimitError` (429, `RATE_LIMIT_EXCEEDED`)

---

## P3: Inline Queue Page Drift / Unify with Static Page

**File:** `src/worker/queue-page.ts:getInlineQueuePage()`
**Issue:** The inline HTML template (287 lines of embedded HTML/CSS/JS) duplicates logic from `public/queue.html`. Changes to one won't propagate to the other.

**Options:**
1. Delete the inline fallback entirely — require `ASSETS` binding always
2. Generate the inline page from `public/queue.html` at build time
3. Accept the drift and only use inline as a last-resort fallback
