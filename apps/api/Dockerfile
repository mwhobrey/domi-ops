FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
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
RUN npx turbo run build --filter=@whome/api...

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
EXPOSE 4000
# Inline shell avoids Windows CRLF breaking a copied .sh entrypoint on Alpine
ENTRYPOINT ["sh", "-c", "echo 'Applying database migrations...' && node /app/packages/db/dist/migrate.js && echo 'Starting API...' && exec node /app/apps/api/dist/index.js"]
