-- Add persistent, independent event and QR attendance controls (additive, non-destructive)
ALTER TABLE "Event" ADD COLUMN "isOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Event" ADD COLUMN "qrAttendanceOpen" BOOLEAN NOT NULL DEFAULT false;

-- Link attendance sessions to events and add QR scanning control (additive, non-destructive)
ALTER TABLE "AttendanceSession" ADD COLUMN "eventId" TEXT;
ALTER TABLE "AttendanceSession" ADD COLUMN "qrEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "AttendanceSession_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AttendanceSession_eventId_startsAt_idx" ON "AttendanceSession"("eventId", "startsAt");
