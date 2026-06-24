FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json package-lock.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build -w @whome/www

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/www/.next/standalone ./
COPY --from=builder /app/apps/www/.next/static ./apps/www/.next/static
COPY --from=builder /app/apps/www/public ./apps/www/public
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/www/server.js"]
