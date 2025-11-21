# Builder
FROM node:20-bullseye AS builder
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy workspace manifests
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY docs ./docs
COPY convex ./convex
COPY packages ./packages
COPY apps ./apps

# Install deps for workspace
RUN pnpm install --frozen-lockfile

# Build worker
RUN pnpm --filter @relay/temporal-worker run build

# Runtime
FROM node:20-bullseye AS runner
WORKDIR /app
RUN corepack enable

# Copy node_modules and built assets
COPY --from=builder /root/.local/share/pnpm /root/.local/share/pnpm
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/temporal-worker/node_modules ./packages/temporal-worker/node_modules
COPY --from=builder /app/packages/temporal-worker/dist ./packages/temporal-worker/dist
COPY --from=builder /app/packages/temporal-worker/package.json ./packages/temporal-worker/package.json

# Default envs (override in deployment)
ENV TEMPORAL_TASK_QUEUE=relay-scan

CMD ["node", "packages/temporal-worker/dist/packages/temporal-worker/src/worker.js"]
