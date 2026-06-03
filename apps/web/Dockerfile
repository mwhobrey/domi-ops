FROM node:22-alpine AS builder
WORKDIR /app
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
RUN npm ci 2>/dev/null || npm install
COPY apps/web ./apps/web
COPY package.json turbo.json ./
WORKDIR /app/apps/web
RUN mkdir -p public
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
