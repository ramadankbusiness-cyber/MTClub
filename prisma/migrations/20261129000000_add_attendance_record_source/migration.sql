-- CreateEnum
CREATE TYPE "AttendanceRecordSource" AS ENUM ('UNKNOWN', 'QR', 'MANUAL', 'EXCUSE');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN "source" "AttendanceRecordSource" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX "AttendanceRecord_sessionId_source_idx" ON "AttendanceRecord"("sessionId", "source");
