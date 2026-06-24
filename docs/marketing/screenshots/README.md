# Marketing screenshots

Captured via `npm run marketing:capture-screenshots` from the Rivera demo household (`npm run db:seed-demo`).

**Naming:** `{priority}-{view}-{desktop|mobile}-{width}x{height}-{light|dark}.png`

Copies are written to this folder and `apps/web/public/marketing/screenshots/` for Next.js static serving. Landing uses `ThemeAwareScreenshot` (`<picture>` + `prefers-color-scheme`).
