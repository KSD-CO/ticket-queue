# TODOS — Deferred Work Items

All items from the original review are now implemented. This file is kept for historical reference.

---

## ~~P1: Threshold Mode~~ DONE

**Implementation:**
- DO alarm publishes active visitor count to KV `queue_count:{eventId}` (10s TTL)
- Gateway reads count when `mode === "threshold"`; bypasses queue if below `activationThreshold`
- Config validation: `activationThreshold` required when mode is threshold, must be >= 1

---

## ~~P2: `broadcastPositionUpdates` O(N) Fix~~ DONE

**Before:** O(N) — one SQL query per WebSocket per alarm tick.
**After:** O(1) — single batch `SELECT` + in-memory map lookup.

---

## ~~P2: Cookie `max-age` Sync~~ DONE

**Implementation:** `injectTokenCookieRefresh()` in gateway — sets `Set-Cookie` with `Max-Age` matching remaining JWT TTL + grace period.

---

## ~~P2: Admin API Rate Limiting~~ DONE

**Implementation:** KV-based fixed window counter (100 req/60s per API key). Returns 429 with `Retry-After`. Fails open on KV errors.

---

## ~~P3: Inline Queue Page Drift~~ DONE

**Resolution:** Deleted the 180-line inline fallback HTML entirely. Queue page now always serves from the ASSETS binding (`public/queue.html` + `queue.js` + `queue.css`). Returns 500 if ASSETS is unavailable instead of degraded inline page.
