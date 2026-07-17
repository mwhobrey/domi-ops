-- WHO-226: new health rows default private; existing household rows unchanged.
ALTER TABLE "health_events" ALTER COLUMN "visibility" SET DEFAULT 'private';
ALTER TABLE "health_medications" ALTER COLUMN "visibility" SET DEFAULT 'private';
