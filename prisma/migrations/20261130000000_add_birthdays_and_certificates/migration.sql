-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BIRTHDAY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "dateOfBirth" DATE;

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "certificateCode" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuanceIdempotencyKey" VARCHAR(128),
    "requestHash" VARCHAR(128),
    "title" VARCHAR(200) NOT NULL,
    "titleAr" VARCHAR(200),
    "issuerName" VARCHAR(200) NOT NULL,
    "issuerNameAr" VARCHAR(200),
    "issueDate" DATE NOT NULL,
    "fileKey" VARCHAR(1024) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileMime" VARCHAR(255) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "BirthdayDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "BirthdayDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "BirthdayDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "notificationId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BirthdayDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_certificateCode_key" ON "Certificate"("certificateCode");
CREATE UNIQUE INDEX "Certificate_issuedById_issuanceIdempotencyKey_key" ON "Certificate"("issuedById", "issuanceIdempotencyKey");
CREATE INDEX "Certificate_userId_issueDate_idx" ON "Certificate"("userId", "issueDate");
CREATE INDEX "Certificate_issuedById_createdAt_idx" ON "Certificate"("issuedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayDelivery_userId_year_key" ON "BirthdayDelivery"("userId", "year");
CREATE INDEX "BirthdayDelivery_year_status_idx" ON "BirthdayDelivery"("year", "status");
CREATE INDEX "BirthdayDelivery_status_claimedAt_idx" ON "BirthdayDelivery"("status", "claimedAt");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDelivery" ADD CONSTRAINT "BirthdayDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
