-- Add soft-archive support for events. Attendance sessions/records are preserved by archiving.
ALTER TABLE "Event" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Event_archivedAt_startsAt_idx" ON "Event"("archivedAt", "startsAt");
