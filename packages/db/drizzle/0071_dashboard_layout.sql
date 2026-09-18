-- Dashboard section-card order, per member (DashboardBoard.tsx). Null means default order
-- (glance → agenda+weather → conflicts → household → month).

ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "dashboard_layout" text;
