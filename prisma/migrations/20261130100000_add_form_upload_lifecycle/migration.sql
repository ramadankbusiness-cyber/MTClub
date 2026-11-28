-- CreateEnum
CREATE TYPE "FormUploadStatus" AS ENUM ('PENDING', 'ATTACHED', 'EXPIRED', 'DELETED', 'DELETE_FAILED');

-- CreateTable
CREATE TABLE "FormUpload" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "key" VARCHAR(1024) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileMime" VARCHAR(255) NOT NULL,
    "uploaderUserId" TEXT,
    "ipHash" VARCHAR(128),
    "tokenJti" VARCHAR(64) NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "FormUploadStatus" NOT NULL DEFAULT 'PENDING',
    "submissionId" TEXT,
    "attachedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deleteAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDeleteError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormUpload_key_key" ON "FormUpload"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FormUpload_tokenJti_key" ON "FormUpload"("tokenJti");

-- CreateIndex
CREATE INDEX "FormUpload_formId_ipHash_createdAt_idx" ON "FormUpload"("formId", "ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "FormUpload_formId_uploaderUserId_createdAt_idx" ON "FormUpload"("formId", "uploaderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FormUpload_status_tokenExpiresAt_idx" ON "FormUpload"("status", "tokenExpiresAt");

-- CreateIndex
CREATE INDEX "FormUpload_status_createdAt_idx" ON "FormUpload"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FormUpload_submissionId_idx" ON "FormUpload"("submissionId");

-- CreateIndex
CREATE INDEX "FormUpload_fieldId_createdAt_idx" ON "FormUpload"("fieldId", "createdAt");

-- AddForeignKey
ALTER TABLE "FormUpload" ADD CONSTRAINT "FormUpload_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormUpload" ADD CONSTRAINT "FormUpload_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormUpload" ADD CONSTRAINT "FormUpload_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormUpload" ADD CONSTRAINT "FormUpload_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
