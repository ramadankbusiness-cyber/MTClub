-- Add event attendance points configuration
ALTER TABLE "Event" ADD COLUMN "attendancePoints" INTEGER NOT NULL DEFAULT 0;

-- Extend notification types for point transactions
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'POINTS_ADDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'POINTS_DEDUCTED';

-- Point transaction ledger
CREATE TYPE "PointTransactionType" AS ENUM (
  'EVENT_ATTENDANCE',
  'MANUAL_ADD',
  'MANUAL_DEDUCT',
  'ATTENDANCE_REVERSAL',
  'ATTENDANCE_ADJUSTMENT'
);

CREATE TABLE "PointTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "type" "PointTransactionType" NOT NULL,
  "eventId" TEXT,
  "attendanceRecordId" TEXT,
  "actorId" TEXT,
  "dedupeKey" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointTransaction_amount_not_zero" CHECK ("amount" <> 0)
);

CREATE UNIQUE INDEX "PointTransaction_dedupeKey_key" ON "PointTransaction"("dedupeKey");
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt");
CREATE INDEX "PointTransaction_eventId_createdAt_idx" ON "PointTransaction"("eventId", "createdAt");
CREATE INDEX "PointTransaction_attendanceRecordId_idx" ON "PointTransaction"("attendanceRecordId");
CREATE INDEX "PointTransaction_actorId_createdAt_idx" ON "PointTransaction"("actorId", "createdAt");
CREATE INDEX "PointTransaction_type_createdAt_idx" ON "PointTransaction"("type", "createdAt");

ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_attendanceRecordId_fkey"
  FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
