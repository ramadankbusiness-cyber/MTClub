-- Allow system-generated notifications (e.g. points ledger) without a user author.
ALTER TABLE "Notification" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_createdById_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
