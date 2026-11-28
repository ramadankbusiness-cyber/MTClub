-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "eventId" TEXT;

-- CreateTable
CREATE TABLE "EventReadiness" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_eventId_type_idx" ON "Notification"("eventId", "type");

-- CreateIndex
CREATE INDEX "EventReadiness_userId_createdAt_idx" ON "EventReadiness"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EventReadiness_eventId_createdAt_idx" ON "EventReadiness"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventReadiness_eventId_userId_key" ON "EventReadiness"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReadiness" ADD CONSTRAINT "EventReadiness_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReadiness" ADD CONSTRAINT "EventReadiness_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
