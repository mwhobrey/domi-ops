# Competitive landscape — Domi Ops marketing (WHO-134)

*Survey date: 2026-06-23. Informs hero copy and module grid on `domi-ops.com`.*

## Market segments

| Segment | Examples | Deployment | Domi Ops overlap |
|---------|----------|------------|------------------|
| **Legacy family calendar** | Cozi, TimeTree, Google Calendar DIY | Cloud | Calendar, shopping, chores — shallow |
| **AI family OS (2026)** | Nori, OurLife, Momwise, Homsy | Cloud SaaS | Calendar, chores, meals — **AI input is their wedge** |
| **Family dashboard SaaS** | FamilyDash, FamilyWall | Cloud freemium | Calendar, chores, groceries, meals |
| **Self-host household OSS** | HomeHub, Tribu, TidyQuest | Self-host | Closest OSS peers |
| **Homeschool LMS** | Binder, Homeschooly, Daily Weave, tamos, Tailored Learning Hub | Cloud SaaS | School only; household ops bolted on or absent |
| **Household ops SaaS** | tryhomeops.app | Cloud | Generic tasks/files — no school, no self-host |

---

## Feature matrix (simplified)

| Capability | Cozi / FamilyDash | AI apps (Nori, Momwise) | Tribu (OSS) | HomeHub (OSS) | Homeschool SaaS | **Domi Ops** |
|------------|-------------------|---------------------------|-------------|---------------|-----------------|--------------|
| Shared calendar | ✓ | ✓ + AI capture | ✓ CalDAV | ✓ basic | ✓ | ✓ **Google import/sync, recurring, push** |
| Chores / karma | shallow / rewards | ✓ | ✓ + rewards | ✓ basic | some | ✓ **karma, reports** |
| Shopping | ✓ | ✓ | ✓ | ✓ smart add | some | ✓ |
| Notes | — | — | — | ✓ | — | ✓ markdown |
| Expenses / budgets | — | — | — | ✓ | rare | ✓ **budgets + alerts** |
| Homeschool LMS | — | — | — | — | ✓ core | ✓ **gradebook, assignments** |
| Household Drive | — | — | — | shared cloud | — | ✓ **quotas, cross-module links** |
| Health (encrypted) | — | — | — | — | some | ✓ |
| Web Push / notices | email digests | in-app | — | — | — | ✓ |
| Presence (who's home) | location apps | — | — | ✓ | — | ✓ |
| Self-host OSS | — | — | ✓ MIT | ✓ MIT | — | ✓ **planned launch** |
| Managed hosted | — | ✓ | — | — | ✓ | ✓ **planned launch** |
| AI flyer/email capture | — | ✓ **primary** | — | — | ✓ growing | — **not v1** |
| Meal planning / recipes | ✓ strong | ✓ strong | ✓ | ✓ | some | — **not in product** |
| Wall / kiosk display | — | — | ✓ | — | — | PWA (not kiosk-first) |

---

## Gaps Domi Ops fills

### 1. **Homeschool + household ops in one product (primary wedge)**

Homeschool platforms (Binder, Homeschooly, Daily Weave) own academics but families still run Cozi + spreadsheets for chores, money, and files. Family organizers own calendar/chores but force a **second app** for school.

**Domi Ops:** `school` module beside calendar, chores, expenses, drive — one login, one household, shared members/roles.

### 2. **Self-host AND hosted — same codebase**

- Cloud apps: data on their servers, no escape hatch.
- OSS peers (HomeHub, Tribu): self-host only, no managed tier for non-technical families.

**Domi Ops:** MIT self-host + Domi Ops cloud ([ADR 001](../adr/001-public-launch-scope.md)).

### 3. **Depth where competitors stay shallow**

| Area | Competitor norm | Domi Ops |
|------|-----------------|----------|
| Calendar | ICS subscribe or manual | Google OAuth, import-first, worker sync, recurring materialize |
| Files | Recipe box or none | Drive with household ACL, module attachments, quotas (hosted) |
| Money | None or simple ledger | Budgets, alerts, reports |
| Health | — or basic tracker | Encrypted fields, calendar overlays, med reminders |
| Auth / roles | Family group | Owner/admin/member/child/guest, module toggles |

### 4. **Polished product UX on self-host**

HomeHub optimizes for zero-config and Raspberry Pi simplicity. Tribu is broad but homelab-aesthetic. Domi Ops targets **“self-host that doesn’t look like a science project”** — relevant for technical parents, not the primary hero for everyone.

### 5. **What we should NOT claim (v1)**

- AI flyer scanning / email triage (Momwise, OurLife, Nori own this narrative in 2026)
- Meal planning / recipe AI (FamilyDash, Cozi Gold)
- Location tracking (FamilyWall)
- RPG chore gamification (TidyQuest, OurHome)

Acknowledge in FAQ later if needed; don’t put in hero.

---

## Hero copy — recommended angle

**Primary (lead with the gap):**

> **The homeschool household hub.**  
> Calendar, classes, chores, budgets, and files — one household, one app. Self-host free or run on Domi Ops cloud.

**Subhead:**

> Stop duct-taping Cozi, a gradebook, and a spreadsheet. Domi Ops is household operations software for families who actually live in their calendar *and* their curriculum.

**Why this angle**

- Owns a **defensible niche** AI apps aren’t targeting with depth (school gradebook + ops).
- Matches dogfood reality (Mike’s household).
- “Household operations” differentiates from “family organizer” commodity.
- Self-host + hosted in subhead without leading with homelab jargon.

**Secondary hero variant** (A/B or below-fold for self-host crowd):

> **Household operations on your server — or ours.**  
> Open source. Docker Compose. Every module included.

**Avoid**

- “Your family’s operating system” (Momwise, tamos, Domi.today collision)
- “AI-powered family hub” (wrong fight for v1)
- “Cozi alternative” as headline (commodity SEO, no wedge)

---

## Module grid priority (landing page)

Order = **differentiation first**, then table stakes, then depth modules.

| Priority | Module | Tile headline | Why on landing |
|----------|--------|---------------|----------------|
| 1 | **School** | Homeschool LMS | **Unique wedge** — lead tile |
| 2 | **Calendar** | Calendar + Google sync | Universal entry; show week view screenshot |
| 3 | **Drive** | Household Drive | Files + links; cloud apps lack this |
| 4 | **Chores** | Chores & karma | Table stakes; karma = light differentiation |
| 5 | **Shopping** | Shopping lists | Table stakes; smart add hint |
| 6 | **Expenses** | Expenses & budgets | Depth vs family organizers |
| 7 | **Health** | Health tracker | Surprise depth; encrypted — trust signal |
| 8 | **Notes** | Notes | Supporting; smaller tile or “+ more” |

**Dashboard / presence / PWA / push** — show in hero screenshot or “And also” strip, not six more tiles (cognitive load).

Grid layout suggestion: **3×3 with School centered or top-left largest** on desktop; mobile stack School → Calendar → Drive first.

---

## CTA structure (locked)

| Button | Target | Notes |
|--------|--------|-------|
| **Get hosted** (primary) | `/pricing` | Stripe required at launch — no waitlist |
| **Self-host free** (secondary) | GitHub + `docs/SETUP.md` anchor | “Open source · MIT” badge |
| **Log in** | `https://app.domi-ops.com/login` | Header only |

Pricing page hosts tier comparison + Stripe checkout entry ([WHO-181](https://linear.app/mikewhob-whome/issue/WHO-181)).

---

## Wireframe sections (WHO-134)

1. **Header** — Logo · Docs · Pricing · Log in  
2. **Hero** — Primary copy + dual CTA (hosted → `/pricing`, self-host → docs)  
3. **Screenshot** — Dashboard or calendar week view (real UI, not illustration)  
4. **Module grid** — Priority order above  
5. **Two paths** — Self-host (MIT, all modules, unlimited drive) vs Hosted (managed, quotas, Stripe)  
6. **Trust** — Self-hosted privacy, encryption for health, no ads (vs Cozi free tier)  
7. **Footer** — Privacy · Terms · GitHub · SETUP.md  

---

## Open items for wireframe session

- [ ] Hero screenshot: dashboard vs calendar vs school gradebook?
- [ ] “Homeschool” in H1 — too narrow for non-homeschool households, or correct wedge?
- [ ] Show module toggles / settings screenshot for “run what you need”?
- [ ] HomeHub migration callout for legacy users?
