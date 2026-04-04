# TODOS — Deferred Work Items

Items identified during the mega plan review that were intentionally deferred.
Sorted by priority.

---

## P1: Threshold Mode Design Doc

**Status:** Needs architecture decision
**Context:** `mode: "threshold"` and `activationThreshold` exist in `EventConfig` but have zero runtime enforcement. The gateway always queues visitors regardless of traffic level.

**Open questions:**
- Where does traffic counting happen? (DO per-event? A separate DO? Workers Analytics?)
- What's the counting window? (rolling 1 min? 5 min? exponential moving average?)
- How does the gateway learn the current traffic rate without adding latency?
- Should threshold mode be per-path or per-event?

**Next step:** Write a design doc with options and tradeoffs before implementing.

---

## P2: `broadcastPositionUpdates` O(N²) Fix

**File:** `src/worker/durable-object.ts:758-779`
**Issue:** Every alarm tick, `broadcastPositionUpdates()` iterates all WebSockets and runs a SQL query per socket. At 50K visitors this is ~50K queries/second.

**Options:**
1. Batch query: `SELECT visitor_id, position FROM visitors WHERE released_at IS NULL` once, build a map, then iterate sockets.
2. Incremental updates: Only broadcast to visitors whose relative position changed since last tick.
3. Sampling: Broadcast every N ticks instead of every tick (positions change slowly).

---

## P2: Cookie `max-age` ↔ `tokenTtlSeconds` Sync

**Issue:** The gateway proxies to origin but doesn't set or refresh the `__queue_token` cookie. The token TTL is baked into the JWT claims, but there's no `Set-Cookie` header with a matching `max-age`. Browsers will hold the cookie indefinitely (session cookie) even after the JWT expires.

**Fix:** When proxying a valid token to origin, inject a `Set-Cookie` header with `max-age` matching the remaining TTL of the JWT.

---

## P2: Admin API Rate Limiting

**Issue:** The admin API is protected by API key but has no rate limiting. A compromised key could hammer KV with writes.

**Options:**
- Cloudflare rate limiting rules (WAF level, no code change)
- Per-IP rate limiting in Hono middleware using `cf` request properties
- KV-based sliding window counter

---

## P3: Inline Queue Page Drift / Unify with Static Page

**File:** `src/worker/queue-page.ts:getInlineQueuePage()`
**Issue:** The inline HTML template (287 lines of embedded HTML/CSS/JS) duplicates logic from `public/queue.html`. Changes to one won't propagate to the other.

**Options:**
1. Delete the inline fallback entirely — require `ASSETS` binding always
2. Generate the inline page from `public/queue.html` at build time
3. Accept the drift and only use inline as a last-resort fallback
