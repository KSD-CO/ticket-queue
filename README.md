# VIBE — Virtual Queue Ticket System

A **Cloudflare Workers-based virtual waiting room** that protects ticket-selling websites from traffic spikes during onsales. Visitors are held in a fair FIFO queue and released at a controlled rate, preventing origin servers from being overwhelmed.

Includes a **full Next.js demo site** — a fictional Vietnamese music event ticketing platform called **VIBE** — to demonstrate the queue in action.

---

## System Architecture

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │                   CLOUDFLARE EDGE                       │
                                  │                                                         │
  ┌─────────┐    HTTPS            │  ┌───────────────────────────────────────────────────┐  │
  │ Browser │─────────────────────┼─▶│           Worker 1: ticket-queue-worker           │  │
  │         │◀────────────────────┼──│  (Hono)   ticket.ironcode.cloud/*                 │  │
  └─────────┘                     │  │                                                   │  │
       │                          │  │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │  │
       │ WSS                      │  │  │   Gateway    │  │  Queue   │  │  Queue WS   │  │  │
       │                          │  │  │   /* (all)   │  │  Page    │  │  /queue/ws   │  │  │
       │                          │  │  │              │  │  /queue  │  │             ─┼──┼──┼─┐
       │                          │  │  └──────┬───────┘  └──────────┘  └─────────────┘  │  │ │
       │                          │  └─────────┼─────────────────────────────────────────┘  │ │
       │                          │            │                                            │ │
       │                          │            │ read                                       │ │
       │                          │            ▼                                            │ │
       │                          │  ┌─────────────────┐                                   │ │
       │                          │  │   CONFIG_KV     │◀──── write ────┐                  │ │
       │                          │  │  (KV Namespace)  │                │                  │ │
       │                          │  │                 │                │                  │ │
       │                          │  │  event:{id}     │    ┌──────────┴──────────────┐   │ │
       │                          │  │  signing_key:{} │    │  Worker 2: queue-admin  │   │ │
       │                          │  └─────────────────┘    │  (Hono)                │   │ │
       │                          │            ▲             │                        │   │ │
       │                          │            │ read        │  /api/events    CRUD   │   │ │
       │                          │            │             │  /api/events/:id/rate  │   │ │
       │                          │  ┌─────────┴──────────┐  │  /api/events/:id/stats │   │ │
       │                          │  │  QueueDurableObject │◀─│  /api/public/queue-   │   │ │
       │      WebSocket ◀─────────┼──│  (1 per event)     │  │       status           │   │ │
       │                          │  │                    │  └─────────────────────────┘   │ │
       │                          │  │  SQLite:           │         ▲                      │ │
       │                          │  │    visitors table  │         │ Bearer auth           │ │
       │                          │  │    _meta table     │    ┌────┴─────┐                │ │
       │                          │  │                    │    │  Admin   │                │ │
       │                          │  │  Alarm (1s):       │    │Dashboard │                │ │
       │                          │  │    release visitors│    │ /admin   │                │ │
       │                          │  │    sign JWT tokens │    └──────────┘                │ │
       │                          │  └────────────────────┘                                │ │
       │                          │                                                         │ │
       │                          └─────────────────────────────────────────────────────────┘ │
       │                                         │                                           │
       │                                         │ proxy (valid token)                       │
       │                                         ▼                                           │
       │                               ┌──────────────────┐                                  │
       │                               │  Origin Server   │                                  │
       │                               │  (your site)     │                                  │
       │                               └──────────────────┘                                  │
       │                                                                                     │
       └─────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Tech | Role |
|---|---|---|
| **Worker 1** `ticket-queue-worker` | Cloudflare Workers + Hono | Gateway (token verify + proxy), queue page, WebSocket to DO |
| **Worker 2** `ticket-queue-admin` | Cloudflare Workers + Hono | REST API for event CRUD, rate control, queue stats, public status |
| **QueueDurableObject** | Durable Objects + SQLite + WS Hibernation | One instance per event. FIFO queue, alarm-based release, JWT signing |
| **CONFIG_KV** | Cloudflare KV | Shared config store: event configs + signing keys |
| **Demo Site** | Next.js 16 + React 19 + Tailwind CSS v4 | Music event ticketing site with queue integration |

---

## Visitor Workflow

### Full request lifecycle from ticket purchase to checkout

```
 Visitor                   Gateway (Worker 1)              Queue Page              DO (per event)                   Origin
   │                            │                             │                        │                              │
   │  1. GET /checkout          │                             │                        │                              │
   ├───────────────────────────▶│                             │                        │                              │
   │                            │  2. Cookie __queue_token?   │                        │                              │
   │                            │     NO                      │                        │                              │
   │                            │  3. findEventForPath()      │                        │                              │
   │                            │     KV lookup: event:*      │                        │                              │
   │                            │     Path matches            │                        │                              │
   │                            │     protectedPaths          │                        │                              │
   │  4. 302 Redirect           │                             │                        │                              │
   │◀──/queue?event=X&return──  │                             │                        │                              │
   │     _url=/checkout         │                             │                        │                              │
   │                            │                             │                        │                              │
   │  5. GET /queue?event=X     │                             │                        │                              │
   ├───────────────────────────▶│ ───────────────────────────▶│                        │                              │
   │                            │                             │  6. Serve queue.html   │                              │
   │  HTML + JS + CSS           │                             │     (inject event ID)  │                              │
   │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                        │                              │
   │                            │                             │                        │                              │
   │  7. WSS /queue/ws?event=X  │                             │                        │                              │
   ├───────────────────────────▶│ ──────────────────────────────────────────────────────▶│                              │
   │                            │         DO.fetch()          │         8. Accept WS    │                              │
   │                            │         (WS upgrade)        │            Load config  │                              │
   │  ◀── WebSocket Open ──────────────────────────────────────────────────────────────│                              │
   │                            │                             │                        │                              │
   │  9. { type: "join" }       │                             │                        │                              │
   ├──────────────────────────────────────────────────────────────────────────────────▶│                              │
   │                            │                             │         10. Validate    │                              │
   │                            │                             │             config      │                              │
   │                            │                             │             enabled?    │                              │
   │                            │                             │         11. INSERT      │                              │
   │                            │                             │             visitor     │                              │
   │                            │                             │             (SQLite)    │                              │
   │                            │                             │         12. Schedule    │                              │
   │                            │                             │             alarm       │                              │
   │  13. { type: "position",   │                             │                        │                              │
   │        position: 42,       │                             │                        │                              │
   │        totalAhead: 41 }    │                             │                        │                              │
   │◀──────────────────────────────────────────────────────────────────────────────────│                              │
   │                            │                             │                        │                              │
   │         ... visitor waits, receives position updates every ~1s ...                │                              │
   │                            │                             │                        │                              │
   │                            │                             │  ┌──── Alarm (1s) ────┐│                              │
   │                            │                             │  │ 14. Batch release:  ││                              │
   │                            │                             │  │   ceil(rate/60)     ││                              │
   │                            │                             │  │   visitors/tick     ││                              │
   │                            │                             │  │ 15. Sign JWT per    ││                              │
   │                            │                             │  │   visitor (HMAC-    ││                              │
   │                            │                             │  │   SHA256)           ││                              │
   │                            │                             │  └─────────────────────┘│                              │
   │                            │                             │                        │                              │
   │  16. { type: "released",   │                             │                        │                              │
   │        token: "eyJ..." }   │                             │                        │                              │
   │◀──────────────────────────────────────────────────────────────────────────────────│                              │
   │                            │                             │                        │                              │
   │  17. Set cookie:           │                             │                        │                              │
   │      __queue_token=eyJ...  │                             │                        │                              │
   │                            │                             │                        │                              │
   │  18. GET /checkout         │                             │                        │                              │
   │      (with cookie)         │                             │                        │                              │
   ├───────────────────────────▶│                             │                        │                              │
   │                            │  19. Verify token:          │                        │                              │
   │                            │      HMAC-SHA256            │                        │                              │
   │                            │      check evt claim        │                        │                              │
   │                            │      check exp + grace      │                        │                              │
   │                            │                             │                        │                              │
   │                            │  20. Proxy to origin ───────────────────────────────────────────────────────────────▶│
   │                            │                             │                        │                              │
   │  21. Checkout page         │                             │                        │                              │
   │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
   │                            │                             │                        │                              │
```

---

## Gateway Decision Tree

```
                         ┌──────────────────┐
                         │  Incoming Request │
                         │  (any path)       │
                         └────────┬─────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │  Has __queue_token cookie?  │
                    └──────┬──────────────┬──────┘
                           │              │
                          YES             NO
                           │              │
                ┌──────────▼──────────┐  ┌▼─────────────────────┐
                │ findEventForPath()  │  │  findEventForPath()  │
                │ (KV lookup)         │  │  (KV lookup)         │
                └──────┬────────┬─────┘  └──────┬──────────┬────┘
                       │        │               │          │
                    matched   no match       matched    no match
                       │        │               │          │
            ┌──────────▼───┐    │    ┌──────────▼───┐      │
            │ Get signing  │    │    │  302 Redirect │      │
            │ key from KV  │    │    │  /queue?event │      │
            └──────┬───────┘    │    │  =X&return_   │   ┌──▼──────────┐
                   │            │    │  url=...       │   │ Passthrough │
            ┌──────▼───────┐    │    └───────────────┘   │ fetch(req)  │
            │ verifyToken()│    │                         └─────────────┘
            │ (HMAC-SHA256)│    │
            └──┬───┬───┬───┘    │
               │   │   │        │
            valid  │ expired    │
            +evt   │ (past      │
            match  │  grace)    │
               │   │   │        │
    ┌──────────▼┐  │  ┌▼──────────────┐
    │ Proxy to  │  │  │ 302 → /queue  │
    │ origin    │  │  └───────────────┘
    └───────────┘  │
                   │
         ┌─────────▼─────────┐
         │ Key missing or    │
         │ KV/DO error       │
         └─────────┬─────────┘
                   │
           ┌───────▼────────┐
           │   FAIL-OPEN    │
           │ proxy to origin│
           └────────────────┘
```

---

## Durable Object State Machine

Each event gets one `QueueDurableObject` instance. The DO manages all visitors for that event using SQLite and WebSocket Hibernation.

```
                              ┌──────┐
                              │ IDLE │ (no visitors)
                              └──┬───┘
                                 │ visitor connects via WS
                                 │ config loaded + enabled
                                 ▼
                            ┌────────┐
                        ┌──▶│ ACTIVE │◀─────────────────┐
                        │   └───┬────┘                   │
                        │       │                        │
                        │       │ visitor sends "join"   │
                        │       ▼                        │
                        │  ┌──────────┐                  │
                        │  │ QUEUEING │                  │
                        │  │          │                  │
                        │  │ assign   │ alarm fires      │
                        │  │ position │ every 1s         │
                        │  │ (FIFO)   │                  │
                        │  │          │                  │
                        │  │          ▼                  │
                        │  │  ┌─────────────────┐       │
                        │  │  │ Release batch:  │       │
                        │  │  │ ceil(rate/60)   │       │
                        │  │  │ visitors/tick   │       │
                        │  │  │                 │       │
                        │  │  │ For each:       │       │
                        │  │  │   Sign JWT      │       │
                        │  │  │   UPDATE SQLite │       │
                        │  │  │   WS → released │       │
                        │  │  └───────┬─────────┘       │
                        │  │          │                  │
                        │  │  broadcast position         │
                        │  │  updates to remaining       │
                        │  └──────────┘                  │
                        │                                │
                        │       last visitor released    │
                        └────────────────────────────────┘
                                 │
                      enabled=false or event ended
                                 │
                                 ▼
                           ┌───────────┐
                           │ DRAINING  │──(all released)──▶ COMPLETE
                           └───────────┘
```

### SQLite Schema (inside each DO instance)

```sql
-- Visitor queue state
CREATE TABLE visitors (
    visitor_id    TEXT PRIMARY KEY,      -- UUID
    position      INTEGER NOT NULL,      -- monotonically increasing
    joined_at     INTEGER NOT NULL,      -- Unix timestamp (ms)
    released_at   INTEGER,               -- NULL if still waiting
    disconnected  INTEGER DEFAULT 0,     -- 1 if WS disconnected (grace period)
    token         TEXT                   -- JWT string after release
);

CREATE INDEX idx_visitors_position
    ON visitors(position) WHERE released_at IS NULL;

-- DO identity (survives hibernation)
CREATE TABLE _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- Stores: ('event_id', 'neon-nights-2026')
```

---

## WebSocket Message Protocol

### Client → Server

```
┌──────────────────────────────────────────────────────────┐
│                    JOIN                                   │
│  { type: "join", visitorId?: string }                    │
│                                                          │
│  Sent on connect. Include visitorId from localStorage    │
│  to reconnect and preserve queue position.               │
├──────────────────────────────────────────────────────────┤
│                    PING                                   │
│  { type: "ping" }                                        │
│                                                          │
│  Heartbeat sent every 30s to keep connection alive.      │
└──────────────────────────────────────────────────────────┘
```

### Server → Client

```
┌──────────────────────────────────────────────────────────┐
│                  POSITION                                 │
│  {                                                       │
│    type: "position",                                     │
│    visitorId: "uuid",        // store in localStorage    │
│    position: 42,             // 1-based queue position   │
│    totalAhead: 41,           // people ahead             │
│    estimatedWaitSeconds: 120 // -1 if paused             │
│  }                                                       │
│  Sent on join and after each alarm release cycle.        │
├──────────────────────────────────────────────────────────┤
│                  RELEASED                                 │
│  { type: "released", token: "eyJhbGci..." }              │
│                                                          │
│  Visitor released! Set cookie and redirect.              │
├──────────────────────────────────────────────────────────┤
│                  PAUSED                                   │
│  { type: "paused", message?: "Queue paused" }            │
│                                                          │
│  releaseRate set to 0 by admin. No one is released.      │
├──────────────────────────────────────────────────────────┤
│                  QUEUE_FULL                               │
│  { type: "queue_full", currentSize: 50000, maxSize: ... }│
│                                                          │
│  Queue at capacity. Visitor cannot join.                 │
├──────────────────────────────────────────────────────────┤
│                  ERROR                                    │
│  { type: "error", code: "...", message: "..." }          │
│                                                          │
│  Codes: EVENT_NOT_FOUND, EVENT_INACTIVE,                 │
│         TEMPORARY_ERROR, INVALID_MESSAGE, STORAGE_FULL   │
├──────────────────────────────────────────────────────────┤
│                  PONG                                     │
│  { type: "pong" }                                        │
│                                                          │
│  Heartbeat acknowledgment.                               │
└──────────────────────────────────────────────────────────┘
```

---

## Admin API Workflow

```
  Admin Dashboard               Worker 2 (queue-admin)           CONFIG_KV              Durable Object
       │                              │                              │                       │
       │  POST /api/events            │                              │                       │
       │  { eventId, name,            │                              │                       │
       │    protectedPaths, ... }     │                              │                       │
       ├─────────────────────────────▶│                              │                       │
       │                              │  1. Validate input           │                       │
       │                              │  2. Check duplicate          │                       │
       │                              │                              │                       │
       │                              │  3. Generate signing key     │                       │
       │                              │     randomUUID() x 2        │                       │
       │                              │                              │                       │
       │                              │  4. KV.put (parallel)        │                       │
       │                              │ ────────────────────────────▶│                       │
       │                              │    event:{id} = config JSON  │                       │
       │                              │    signing_key:{id} = key    │                       │
       │                              │                              │                       │
       │                              │  5. notifyDO (best-effort)   │                       │
       │                              │ ─────────────────────────────┼──────────────────────▶│
       │                              │    /reload-config?eventId=X  │   null config cache   │
       │                              │    (via waitUntil)           │   reload from KV      │
       │                              │                              │                       │
       │  201 { config }              │                              │                       │
       │◀─────────────────────────────│                              │                       │
       │                              │                              │                       │
       │  PUT /api/events/:id/rate    │                              │                       │
       │  { releaseRate: 200 }        │                              │                       │
       ├─────────────────────────────▶│                              │                       │
       │                              │  Update KV                   │                       │
       │                              │ ────────────────────────────▶│                       │
       │                              │  Notify DO                   │                       │
       │                              │ ─────────────────────────────┼──────────────────────▶│
       │                              │                              │   Hot reload config   │
       │                              │                              │   Next alarm uses     │
       │  200 { releaseRate: 200 }    │                              │   new rate            │
       │◀─────────────────────────────│                              │                       │
```

### Admin API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `GET` | `/api/public/queue-status` | **No** | Public: `{ eventId, enabled }` for all events |
| `POST` | `/api/events` | Bearer | Create event with queue config |
| `GET` | `/api/events` | Bearer | List all events |
| `GET` | `/api/events/:id` | Bearer | Get event by ID |
| `PUT` | `/api/events/:id` | Bearer | Update event config |
| `DELETE` | `/api/events/:id` | Bearer | Delete event + signing key |
| `PUT` | `/api/events/:id/rate` | Bearer | Adjust release rate (visitors/min) |
| `GET` | `/api/events/:id/stats` | Bearer | Queue stats (active, released, avg wait) |

---

## Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CONFIG_KV (Cloudflare KV)                  │
│                                                                     │
│  Key                              │  Value                          │
│ ──────────────────────────────────┼──────────────────────────────── │
│  event:neon-nights-2026           │  { eventId, name, enabled,      │
│                                   │    protectedPaths, originUrl,   │
│                                   │    releaseRate, mode, ...       │
│                                   │    createdAt, updatedAt }       │
│                                   │                                 │
│  signing_key:neon-nights-2026     │  "a1b2c3d4-...-e5f6g7h8..."    │
│                                   │  (randomUUID x 2)               │
└───────────────────────────────────┴─────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              Durable Object SQLite (per event instance)             │
│                                                                     │
│  visitors                                                           │
│  ┌──────────────┬──────────┬───────────┬────────────┬──────┬──────┐│
│  │ visitor_id   │ position │ joined_at │released_at │discon│token ││
│  ├──────────────┼──────────┼───────────┼────────────┼──────┼──────┤│
│  │ uuid-001     │ 1        │ 17752...  │ 17752...   │ 0    │eyJ...││
│  │ uuid-002     │ 2        │ 17752...  │ NULL       │ 0    │ NULL ││
│  │ uuid-003     │ 3        │ 17752...  │ NULL       │ 1    │ NULL ││
│  └──────────────┴──────────┴───────────┴────────────┴──────┴──────┘│
│                                                                     │
│  _meta                                                              │
│  ┌────────────┬─────────────────────┐                               │
│  │ key        │ value               │                               │
│  ├────────────┼─────────────────────┤                               │
│  │ event_id   │ neon-nights-2026    │  (survives hibernation)       │
│  └────────────┴─────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     Client-Side Storage                             │
│                                                                     │
│  Cookie:       __queue_token = eyJhbGciOi... (JWT, max-age=3600)   │
│  localStorage: queue_visitor_neon-nights-2026 = uuid-002            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## JWT Token Structure

Tokens are signed using **HMAC-SHA256** via the Web Crypto API (zero library dependencies).

```
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "sub": "uuid-002",           // visitor ID
  "evt": "neon-nights-2026",   // event ID (verified by gateway)
  "iat": 1775232800,           // issued at (Unix seconds)
  "exp": 1775234600,           // expires at (iat + tokenTtlSeconds)
  "pos": 42                    // queue position when released
}
Signature: HMAC-SHA256(header.payload, signing_key)
```

**Verification** at the gateway includes a **5-minute grace period** after expiry, allowing visitors to complete in-flight purchases even if their token technically expired seconds ago.

---

## Demo Site Integration

The Next.js demo site integrates with the queue system at three levels:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Demo Site (Next.js 16)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Server Components (SSR/SSG)                                │ │
│  │                                                             │ │
│  │  fetchQueueStatusMap() ──GET──▶ /api/public/queue-status    │ │
│  │    ↓ (revalidate: 60s)                                      │ │
│  │  { "neon-nights-2026": true, "acoustic-garden": false }     │ │
│  │    ↓                                                        │ │
│  │  isQueueEnabled(map, event.slug)                            │ │
│  │    ↓                                                        │ │
│  │  <EventCard queueEnabled={true} />  ← "Queue Active" badge │ │
│  │  <TicketSelector queueEnabled={true} /> ← "Join Queue" CTA │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Client Components                                          │ │
│  │                                                             │ │
│  │  /checkout (client-side)                                    │ │
│  │    ↓ fetchQueueEnabledForEvent(slug)                        │ │
│  │    ↓                                                        │ │
│  │  if queueEnabled && !hasToken:                              │ │
│  │    <QueueOverlay />  ← full-screen WebSocket queue UI       │ │
│  │      ↓ WSS /queue/ws?event=X                                │ │
│  │      ↓ position updates, released → set cookie              │ │
│  │      ↓ onRelease → dismiss overlay → show checkout form     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Resilience Patterns

### 1. Fail-Open Gateway

If the queue system itself has an error, visitors are **not blocked**:

```
KV unavailable       → proxy to origin anyway
Signing key missing  → log critical error, proxy to origin
DO unreachable       → proxy to origin
Config parse error   → skip event, proxy to origin
```

Configurable per-event via `failMode: "open" | "closed"`.

### 2. WebSocket Reconnection

```
Connection lost
  │
  ├── Attempt 1:  1s delay  + jitter (0-25%)
  ├── Attempt 2:  2s delay  + jitter
  ├── Attempt 3:  4s delay  + jitter
  ├── Attempt N:  min(2^N s, 30s) + jitter
  │
  ├── After 3 WS failures → switch to HTTP polling (/queue/poll, every 3s)
  │
  └── Tab becomes visible → reconnect immediately (Visibility API)
```

Queue position is preserved for **120 seconds** after disconnect (grace period).

### 3. DO Hibernation Recovery

```
DO hibernated (idle, not billed)
  │
  ├── Wake from fetch() (new visitor connects)
  │     → Force reload config from KV
  │     → Recreate SQLite tables if needed
  │     → Recover event ID from _meta table
  │
  ├── Wake from webSocketMessage() (existing visitor sends message)
  │     → ensureInitialized()
  │     → Recover event ID from _meta table
  │     → Reload config from KV
  │
  └── Wake from alarm()
        → Same recovery + always reschedule if visitors waiting
        → KV transient error → retry on next alarm (not lost)
```

### 4. Transient Error Handling

```
KV read fails in DO
  │
  ├── During handleJoin()
  │     → Send TEMPORARY_ERROR to client
  │     → Client auto-retries after 3s
  │
  └── During alarm()
        → Log error
        → Reschedule alarm (visitors not stuck)
        → Next alarm retries config load
```

---

## Project Structure

```
├── src/
│   ├── shared/                  # Code shared by both Workers
│   │   ├── config.ts            # EventConfig type + validation + defaults
│   │   ├── constants.ts         # Cookie names, KV prefixes, limits
│   │   ├── errors.ts            # 12 typed error classes
│   │   ├── jwt.ts               # HMAC-SHA256 JWT sign/verify (Web Crypto)
│   │   └── messages.ts          # WebSocket message types + parse/serialize
│   ├── worker/                  # Worker 1: visitor-facing
│   │   ├── index.ts             # Hono routes: /queue, /queue/ws, /queue/poll, /*
│   │   ├── gateway.ts           # Token check → proxy or redirect to queue
│   │   ├── queue-page.ts        # Serve waiting room HTML, WS upgrade, polling
│   │   └── durable-object.ts    # Queue brain: SQLite, WS Hibernation, alarm release
│   └── admin/                   # Worker 2: admin API
│       ├── index.ts             # REST routes + CORS + error handler
│       ├── auth.ts              # Bearer token auth (timing-safe comparison)
│       └── handlers.ts          # CRUD + rate control + stats + public status
├── public/                      # Static queue page assets
│   ├── queue.html               # Waiting room template (server-injected config)
│   ├── queue.js                 # WS client: reconnect, backoff, polling fallback
│   └── queue.css                # Dark-themed responsive queue UI
├── test/
│   ├── unit/                    # 50 unit tests (jwt, config, errors, messages)
│   └── integration/             # 43 integration tests (admin API, gateway, E2E)
├── demo-site/                   # Next.js 16 music ticket demo site
│   ├── src/
│   │   ├── app/                 # Pages: /, /events, /events/[slug], /checkout, /admin
│   │   ├── components/          # EventCard, QueueOverlay, TicketSelector, Header, Footer
│   │   └── lib/                 # events.ts (mock data), admin-api.ts, queue-status.ts
│   └── ...
├── Dockerfile                   # Multi-stage build for demo site
├── wrangler.toml                # Worker 1 config (routes to ticket.ironcode.cloud/*)
├── wrangler.admin.toml          # Worker 2 config (admin API)
└── vitest.config.ts             # Vitest + @cloudflare/vitest-pool-workers
```

---

## Key Design Decisions

- **Fail-open** — if the queue system breaks, visitors pass through to the origin
- **WebSocket Hibernation** — no billing while visitors idle; alarm-based release every 1s
- **JWT tokens** — HMAC-SHA256 via Web Crypto API, not a library dependency
- **Zero runtime deps** — only `hono` (14KB). Everything else is native (Web Crypto, crypto.randomUUID())
- **Fair FIFO** — first-come, first-served with reconnection support and disconnect grace period
- **Eventual consistency** — KV reads may be stale; DO always reschedules alarms when config load fails

---

## Quick Start

### Prerequisites

- Node.js >= 20
- npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)

### 1. Install dependencies

```bash
npm install
```

### 2. Run queue system (dev)

```bash
# Worker 1 — visitor-facing gateway + queue
npm run dev

# Worker 2 — admin API (separate terminal)
npm run dev:admin
```

### 3. Run demo site

```bash
cd demo-site
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the VIBE ticketing site.

### 4. Run tests

```bash
# All 93 tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck
```

---

## Admin API

All endpoints under `/api/*` require `Authorization: Bearer <ADMIN_API_KEY>`.

Public endpoints (`/health`, `/api/public/*`) require no auth.

### Create event example

```bash
curl -X POST http://localhost:8787/api/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "summer-fest-2026",
    "name": "Summer Festival 2026",
    "protectedPaths": ["/tickets/*", "/checkout"],
    "originUrl": "https://your-origin.com",
    "releaseRate": 120,
    "tokenTtlSeconds": 1800
  }'
```

### Event config options

| Field | Type | Default | Description |
|---|---|---|---|
| `eventId` | string | *required* | URL-safe unique ID |
| `name` | string | *required* | Display name |
| `protectedPaths` | string[] | *required* | URL patterns to protect (supports `*` wildcards) |
| `originUrl` | string | *required* | HTTPS origin to proxy to |
| `releaseRate` | number | `60` | Visitors released per minute |
| `tokenTtlSeconds` | number | `1800` | Token validity (seconds) |
| `failMode` | `"open"` \| `"closed"` | `"open"` | Behavior when queue system fails |
| `mode` | `"always"` \| `"threshold"` | `"always"` | Queue activation mode |
| `maxQueueSize` | number | `0` | Max visitors in queue (0 = up to 50K DO limit) |
| `turnstileEnabled` | boolean | `false` | Require Cloudflare Turnstile |
| `enabled` | boolean | `true` | Whether queue is active |

---

## Deployment

### Cloudflare Workers

```bash
# Create KV namespace
wrangler kv namespace create CONFIG_KV

# Update wrangler.toml and wrangler.admin.toml with the namespace ID

# Set admin API key
wrangler secret put ADMIN_API_KEY --config wrangler.admin.toml

# Deploy both Workers
npm run deploy
```

### Demo Site (Docker)

The demo site ships as a standalone Docker image:

```bash
docker build -t ticket-queue .
docker run -p 3000:3000 -e NEXT_PUBLIC_ADMIN_API_URL=https://your-admin.workers.dev ticket-queue
```

### CI/CD

The `.github/workflows/deploy.yml` workflow runs on every push to `main`:

1. **Test** — typecheck + run all 93 tests in the Workers runtime
2. **Deploy Workers** — deploy both Cloudflare Workers (`queue-worker` + `queue-admin`)
3. **Deploy Demo Site** — build & push Docker image, then SSH deploy to server

On pull requests, only the test job runs.

**Required GitHub secrets:**

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password or access token |
| `SSH_HOST` | Deploy server hostname/IP |
| `SSH_USERNAME` | SSH user |
| `SSH_PASSWORD` | SSH password |
| `SSH_PORT` | SSH port |
| `DEPLOY_PATH` | Path to `deploy.sh` on the server |

---

## Tests

**93 tests** across 7 test files, all running in the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`:

```
 ✓ test/unit/errors.test.ts        (11 tests)
 ✓ test/unit/messages.test.ts      (12 tests)
 ✓ test/unit/jwt.test.ts           (11 tests)
 ✓ test/unit/config.test.ts        (16 tests)
 ✓ test/integration/worker.test.ts (15 tests)
 ✓ test/integration/admin.test.ts  (24 tests)
 ✓ test/integration/e2e-flow.test.ts (4 tests)
```

### What's tested

- **JWT** — sign/verify round-trip, wrong secret, tampered payload, expiry, grace period, missing claims
- **Config validation** — required fields, HTTPS enforcement, invalid values, multiple errors
- **Error classes** — all 12 classes: status codes, JSON serialization, instanceof chains
- **Messages** — parse/serialize for all client + server message types
- **Gateway** — protected/unprotected paths, valid/expired/tampered tokens, wildcard matching, disabled events, fail-open
- **Admin API** — full CRUD, auth middleware, duplicate rejection, rate adjustment, stats
- **E2E** — create event → verify KV + signing key, full lifecycle, JWT round-trip, multi-event isolation

---

## Constants Reference

| Constant | Value | Description |
|---|---|---|
| `TOKEN_COOKIE_NAME` | `__queue_token` | Cookie for access token |
| `EVENT_CONFIG_PREFIX` | `event:` | KV key prefix for configs |
| `SIGNING_KEY_PREFIX` | `signing_key:` | KV key prefix for HMAC keys |
| `DEFAULT_TOKEN_TTL_SECONDS` | `1800` (30 min) | Token validity |
| `TOKEN_GRACE_PERIOD_SECONDS` | `300` (5 min) | Post-expiry grace |
| `DEFAULT_RELEASE_RATE` | `60` / min | Default throughput |
| `ALARM_INTERVAL_MS` | `1000` (1s) | Release cycle frequency |
| `MAX_VISITORS_PER_DO` | `50,000` | Hard limit per DO instance |
| `DISCONNECT_GRACE_SECONDS` | `120` (2 min) | Position hold on disconnect |

---

## Future Work

| Priority | Feature | Effort |
|---|---|---|
| P1 | **Pre-queue Randomization** — randomize positions at sale start for scheduled onsales | M |
| P1 | **JWT Key Rotation** — multiple active signing keys with overlap period | S |
| P2 | **One-Order-Per-Customer** — identity verification to prevent scalping | L |
| P2 | **Queue Sharding** — for >50K concurrent visitors per event | XL |
| P3 | **Rust/WASM Hot Paths** — incremental WASM for CPU bottlenecks | S |

---

## License

MIT
