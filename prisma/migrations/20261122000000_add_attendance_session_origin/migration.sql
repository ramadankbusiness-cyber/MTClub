-- Add explicit origin for attendance sessions to distinguish manual vs event-generated sessions.
-- Default MANUAL preserves legitimate standalone sessions. Event-linked sessions are marked EVENT.
CREATE TYPE "AttendanceSessionOrigin" AS ENUM ('MANUAL', 'EVENT');

ALTER TABLE "AttendanceSession"
  ADD COLUMN "origin" "AttendanceSessionOrigin" NOT NULL DEFAULT 'MANUAL';

-- Any session linked to an event is event-generated.
UPDATE "AttendanceSession"
SET "origin" = 'EVENT'
WHERE "eventId" IS NOT NULL;

-- Known orphaned event-generated session (event permanently deleted, eventId set null by FK).
-- Explicit ID only; no broad eventId-null update.
UPDATE "AttendanceSession"
SET "origin" = 'EVENT'
WHERE "id" = 'cmwnmnzi00003jw081941z09f'
  AND "eventId" IS NULL;

CREATE INDEX "AttendanceSession_origin_eventId_idx" ON "AttendanceSession"("origin", "eventId");
