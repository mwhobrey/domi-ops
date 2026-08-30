FROM node:26-alpine AS builder
WORKDIR /app
RUN corepack enable

ARG API_URL=http://api:4000
ENV API_URL=$API_URL

COPY package.json package-lock.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build -w @domi-ops/web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
