FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
# better-sqlite3 (packages/import-homehub) has no prebuilt binary for this Node major on
# musl yet — build tools let npm ci fall back to compiling it from source.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
COPY packages/config/package.json packages/config/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/calendar-sync/package.json packages/calendar-sync/
COPY packages/import-homehub/package.json packages/import-homehub/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci
COPY . .
RUN npx turbo run build --filter=@domi-ops/api...

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/packages/db/drizzle ./packages/db/drizzle
USER node
EXPOSE 4000
# Inline shell avoids Windows CRLF breaking a copied .sh entrypoint on Alpine
ENTRYPOINT ["sh", "-c", "echo 'Applying database migrations...' && node /app/packages/db/dist/migrate.js && echo 'Starting API...' && exec node /app/apps/api/dist/index.js"]
