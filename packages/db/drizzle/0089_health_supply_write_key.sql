-- WHO-419: a retried supply change must not be applied twice. The client sends a key with each
-- change; the key of the latest change is kept on the supply row, so repeating that request returns
-- the saved result instead of a version conflict or a second revision.
ALTER TABLE "health_medication_supply" ADD COLUMN IF NOT EXISTS "last_write_key" text;
