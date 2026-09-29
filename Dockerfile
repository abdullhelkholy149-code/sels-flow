# syntax=docker/dockerfile:1
# SalesFlow - application image
#
# Base image is node 22 on bookworm slim (not alpine) on purpose: Phase 6 needs
# headless Chromium through Playwright to render Arabic PDFs correctly, and
# swapping the base image later would break the PDF layer. See docs/DECISIONS.md D-003.

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# openssl is required by the Prisma query engine; ca-certificates for outbound TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Development / Codespaces image.
#
# Built on the official devcontainer base image so the Codespaces user, sudo and
# VS Code server behave normally, plus postgresql-client for pg_isready.
FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm AS dev
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
# The lock file only exists after the first local `npm install`.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------------------------------------------------------------------------
FROM deps AS builder
COPY prisma ./prisma
COPY tsconfig.json next.config.ts postcss.config.mjs tailwind.config.ts ./
COPY src ./src
COPY public ./public
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
FROM base AS runner
# Runtime dependencies only (worker, prisma CLI, tsx)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force

# The Next.js standalone server bundle and its minimal node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Sources required by the background worker and by prisma seed
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
RUN npx prisma generate

# Uploaded files live outside the app directory on purpose (Section 10)
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
