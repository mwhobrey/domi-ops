-- First-login checklist state, server-side (not localStorage — must follow the member
-- across devices/PWA installs; see apps/web/src/components/OnboardingChecklist.tsx).

ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "onboarding_steps_done" text NOT NULL DEFAULT '[]';
ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "onboarding_dismissed_at" timestamptz;
