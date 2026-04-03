# VIBE — Virtual Queue Ticket System

A **Cloudflare Workers-based virtual waiting room** that protects ticket-selling websites from traffic spikes during onsales. Visitors are held in a fair FIFO queue and released at a controlled rate, preventing origin servers from being overwhelmed.

Includes a **full Next.js demo site** — a fictional Vietnamese music event ticketing platform called **VIBE** — to demonstrate the queue in action.

```
Visitor ──▶ Gateway ──▶ token valid? ──▶ proxy to origin
                            │ no
                            ▼
                      Queue Page ──WS──▶ Durable Object
                            │                    │
                            ◀── position updates ─┘
                            │
                      token issued ──▶ redirect to origin
```

---

## Architecture

| Component | Tech | Description |
|---|---|---|
| **Worker 1** — `ticket-queue-worker` | Cloudflare Workers + Hono | Gateway (token check → proxy or redirect), queue page, WebSocket to DO |
| **Worker 2** — `ticket-queue-admin` | Cloudflare Workers + Hono | REST API for event CRUD, release rate control, queue stats |
| **QueueDurableObject** | Durable Objects + SQLite + WS Hibernation | One instance per event. Manages all visitors, FIFO release, JWT signing |
| **Demo Site** | Next.js 16 + React 19 + Tailwind CSS v4 | Music event ticketing site with queue integration |

### Key design decisions

- **Fail-open** — if the queue system breaks, visitors pass through to the origin
- **WebSocket Hibernation** — no billing while visitors idle; alarm-based release every 1s
- **JWT tokens** — HMAC-SHA256 via Web Crypto API, not a library dependency
- **Zero runtime deps** — only `hono` (14KB). Everything else is native (Web Crypto, Date.now(), crypto.randomUUID())
- **Fair FIFO** — first-come, first-served with reconnection support and disconnect grace period

---

## Project Structure

```
├── src/
│   ├── shared/            # Code shared by both Workers
│   │   ├── config.ts      # EventConfig type + validation
│   │   ├── constants.ts   # Cookie names, KV prefixes, limits
│   │   ├── errors.ts      # 12 typed error classes
│   │   ├── jwt.ts         # HMAC-SHA256 JWT sign/verify
│   │   └── messages.ts    # WebSocket message types
│   ├── worker/            # Worker 1: visitor-facing
│   │   ├── index.ts       # Hono routes: /queue, /queue/ws, /queue/poll, /*
│   │   ├── gateway.ts     # Token check → proxy or redirect
│   │   ├── queue-page.ts  # Serve waiting room HTML, WS upgrade, polling
│   │   └── durable-object.ts  # The queue brain: SQLite, WS, alarm release
│   └── admin/             # Worker 2: admin API
│       ├── index.ts       # REST API: /api/events CRUD + /rate + /stats
│       ├── auth.ts        # Bearer token auth (timing-attack safe)
│       └── handlers.ts    # Event management handlers
├── public/                # Static queue page (HTML/CSS/JS)
├── test/
│   ├── unit/              # 50 unit tests (jwt, config, errors, messages)
│   └── integration/       # 43 integration tests (admin API, gateway, E2E)
├── demo-site/             # Next.js music ticket demo site
├── Dockerfile             # Multi-stage build for demo site
├── wrangler.toml          # Worker 1 config
├── wrangler.admin.toml    # Worker 2 config
└── .github/workflows/     # CI/CD: Docker build + SSH deploy
```

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

All endpoints require `Authorization: Bearer <ADMIN_API_KEY>`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/events` | Create a new event with queue config |
| `GET` | `/api/events` | List all events |
| `GET` | `/api/events/:id` | Get event by ID |
| `PUT` | `/api/events/:id` | Update event config |
| `DELETE` | `/api/events/:id` | Delete event + signing key |
| `PUT` | `/api/events/:id/rate` | Adjust release rate (visitors/min) |
| `GET` | `/api/events/:id/stats` | Queue stats (active, released, avg wait) |

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

## How the Queue Works

1. **Visitor hits a protected path** (e.g. `/tickets/buy`)
2. **Gateway** checks for a `__queue_token` cookie
   - **No token** → redirect to `/queue?event=...&return_url=...`
   - **Valid token** → proxy request to origin
   - **Expired/invalid** → redirect to queue
3. **Queue page** opens a WebSocket to the Durable Object
4. **DO assigns position**, broadcasts updates every second
5. **Alarm fires** every 1s, releases `ceil(releaseRate / 60)` visitors from the front
6. **Released visitor** receives a signed JWT via WebSocket
7. **Client stores token** in cookie and redirects back to the protected path
8. **Gateway verifies** token and proxies to origin

### Resilience

- **Reconnection** — if WebSocket drops, client reconnects with exponential backoff + jitter. Position is preserved for 120s.
- **HTTP polling fallback** — if WebSocket fails 3 times, client falls back to polling `/queue/poll`
- **Fail-open** — if KV/DO is unreachable, gateway proxies to origin anyway
- **Visibility API** — reconnects immediately when user returns to the tab

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
docker run -p 3000:3000 ticket-queue
```

### CI/CD

The `.github/workflows/deploy.yml` workflow:

1. Builds the Docker image on push to `main`
2. Pushes to Docker Hub as `jamesvu/lunev3:ticket-queue`
3. SSHs into the deploy server and runs `deploy.sh`

**Required GitHub secrets:**

| Secret | Description |
|---|---|
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password or access token |
| `SSH_HOST` | Deploy server hostname/IP |
| `SSH_USERNAME` | SSH user |
| `SSH_PASSWORD` | SSH password |
| `SSH_PORT` | SSH port |
| `DEPLOY_PATH` | Path to `deploy.sh` on the server |

---

## Demo Site (VIBE)

A fictional Vietnamese music event ticketing platform built with **Next.js 16**, **React 19**, and **Tailwind CSS v4**.

### Pages

| Route | Description |
|---|---|
| `/` | Landing page — hero, featured events, "How it works", upcoming events |
| `/events` | All events with category filters (Concerts, Festivals, DJ Sets, Live Sessions) |
| `/events/[slug]` | Event detail — lineup, venue, ticket tier selector |
| `/checkout` | Checkout — queue overlay (if enabled), order summary, payment form |

### Mock Events

8 fictional events in Ho Chi Minh City / Vung Tau:

- **Neon Nights 2026** — electronic festival (queue enabled)
- **K-Wave Live 2026** — K-Pop concert (queue enabled)
- **Saigon Symphony Night** — orchestral concert (queue enabled)
- **Bassline Warehouse** — D&B / dubstep DJ set (queue enabled)
- **Sunrise Beach Party** — beach festival (queue enabled)
- **Acoustic Garden** — intimate live session
- **Jazz on the Rooftop** — jazz evening
- **Retro Vinyl Night** — vinyl DJ set (sold out)

### Queue Integration

Events with `queueEnabled: true` show a full-screen **QueueOverlay** component when the user reaches checkout. The overlay:

- Connects via WebSocket to the queue Worker
- Shows real-time position, estimated wait, and progress bar
- Stores visitor ID in localStorage for reconnection
- Sets `__queue_token` cookie on release
- Falls back to HTTP polling after 3 WS failures

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

## Future Work

| Priority | Feature | Effort |
|---|---|---|
| P1 | **Pre-queue Randomization** — randomize positions at sale start for scheduled onsales | M |
| P1 | **JWT Key Rotation** — multiple active signing keys with overlap period | S |
| P2 | **One-Order-Per-Customer** — identity verification to prevent scalping | L |
| P2 | **Queue Sharding** — for >50K concurrent visitors per event | XL |
| P2 | **Admin Dashboard UI** — React SPA for event managers | L |
| P3 | **Rust/WASM Hot Paths** — incremental WASM for CPU bottlenecks | S |

---

## License

MIT
