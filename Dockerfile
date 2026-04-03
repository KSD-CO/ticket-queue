# ============================================================
# Multi-stage Dockerfile for Next.js demo site
# Produces a minimal standalone image (~150MB)
# ============================================================

# ── Stage 1: Install dependencies ──
FROM node:22-alpine AS deps
WORKDIR /app

COPY demo-site/package.json demo-site/package-lock.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY demo-site/ .

RUN npm run build

# ── Stage 3: Production image ──
#
# Next.js standalone in a monorepo outputs:
#   .next/standalone/
#     node_modules/          (shared: sharp, etc.)
#     demo-site/
#       server.js
#       node_modules/        (next, react, etc.)
#
# We replicate this layout so require() paths resolve correctly.
# ============================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Replicate the standalone directory structure
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets into the app subfolder
# Only copy public/ if it exists in the build — currently demo-site has no public/ dir
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./demo-site/.next/static

USER nextjs
EXPOSE 3000

WORKDIR /app/demo-site
CMD ["node", "server.js"]
