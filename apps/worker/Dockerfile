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
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npx turbo run build --filter=@whome/worker...

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
CMD ["node", "apps/worker/dist/index.js"]
