FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/www/package.json apps/www/
COPY packages/config/package.json packages/config/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/calendar-sync/package.json packages/calendar-sync/
COPY packages/import-homehub/package.json packages/import-homehub/
COPY packages/marketing-ui/package.json packages/marketing-ui/
RUN npm ci
COPY apps ./apps
COPY packages ./packages
COPY vitest.config.ts vitest.hosted.config.ts ./
RUN npx turbo run build --filter=@domi-ops/api... --filter=@domi-ops/worker...
ARG QA_APP_URL=http://localhost:13180
ARG QA_MARKETING_URL=http://localhost:13181
ENV PUBLIC_APP_URL=$QA_APP_URL API_URL=http://api:4000 DOMI_OPS_QA_HARNESS=1
RUN npm run build -w @domi-ops/web
ENV NEXT_PUBLIC_APP_URL=$QA_APP_URL NEXT_PUBLIC_DEMO_URL=$QA_APP_URL PUBLIC_MARKETING_URL=$QA_MARKETING_URL
RUN npm run build -w @domi-ops/www
ENV NODE_ENV=production DOMI_OPS_DOTENV_LOADED=1
COPY scripts/hosted-qa ./scripts/hosted-qa
COPY scripts/mcp-chatgpt ./scripts/mcp-chatgpt
COPY scripts/mcp-claude ./scripts/mcp-claude
COPY scripts/mcp-gemini ./scripts/mcp-gemini
COPY scripts/mcp-grok-bot ./scripts/mcp-grok-bot
COPY docs/fixtures ./docs/fixtures
COPY skills ./skills
COPY scripts/household-archive.mts ./scripts/
COPY .env.hosted-prod.example ./
