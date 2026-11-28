-- CreateEnum
CREATE TYPE "FormAccessMode" AS ENUM ('MEMBERS_ONLY', 'AUTHENTICATED_USERS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('SHORT_ANSWER', 'PARAGRAPH', 'MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN', 'NUMBER', 'DATE', 'TIME', 'EMAIL', 'PHONE', 'FILE_UPLOAD');

-- CreateEnum
CREATE TYPE "FormDuplicatePolicy" AS ENUM ('ALLOW', 'ONE_PER_USER', 'ONE_PER_EMAIL', 'ONE_PER_IP');

-- CreateEnum
CREATE TYPE "FormSubmissionStatus" AS ENUM ('SUBMITTED');

-- CreateEnum
CREATE TYPE "FormEventKind" AS ENUM ('REGISTRATION', 'FEEDBACK', 'GENERAL');

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "publicSlug" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "titleAr" VARCHAR(200),
    "description" VARCHAR(5000),
    "descriptionAr" VARCHAR(5000),
    "accessMode" "FormAccessMode" NOT NULL DEFAULT 'MEMBERS_ONLY',
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "maxResponses" INTEGER,
    "duplicatePolicy" "FormDuplicatePolicy" NOT NULL DEFAULT 'ALLOW',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "label" VARCHAR(300) NOT NULL,
    "labelAr" VARCHAR(300),
    "description" VARCHAR(2000),
    "descriptionAr" VARCHAR(2000),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "validation" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormEvent" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "FormEventKind" NOT NULL DEFAULT 'GENERAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "publicId" VARCHAR(64) NOT NULL,
    "formId" TEXT NOT NULL,
    "respondentUserId" TEXT,
    "respondentEmail" VARCHAR(320),
    "respondentName" VARCHAR(200),
    "status" "FormSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "ipHash" VARCHAR(128),
    "userAgentHash" VARCHAR(128),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" JSONB,
    "fileKey" VARCHAR(1024),
    "fileName" VARCHAR(255),
    "fileSize" INTEGER,
    "fileMime" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(80),
    "title" VARCHAR(200) NOT NULL,
    "titleAr" VARCHAR(200),
    "description" VARCHAR(2000),
    "descriptionAr" VARCHAR(2000),
    "category" VARCHAR(80) NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "fields" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Form_publicSlug_key" ON "Form"("publicSlug");

-- CreateIndex
CREATE INDEX "Form_createdById_updatedAt_idx" ON "Form"("createdById", "updatedAt");

-- CreateIndex
CREATE INDEX "Form_status_updatedAt_idx" ON "Form"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Form_accessMode_status_idx" ON "Form"("accessMode", "status");

-- CreateIndex
CREATE INDEX "FormField_formId_order_idx" ON "FormField"("formId", "order");

-- CreateIndex
CREATE INDEX "FormField_formId_isArchived_order_idx" ON "FormField"("formId", "isArchived", "order");

-- CreateIndex
CREATE INDEX "FormEvent_eventId_kind_idx" ON "FormEvent"("eventId", "kind");

-- CreateIndex
CREATE INDEX "FormEvent_formId_idx" ON "FormEvent"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "FormEvent_formId_eventId_key" ON "FormEvent"("formId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmission_publicId_key" ON "FormSubmission"("publicId");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_submittedAt_idx" ON "FormSubmission"("formId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_respondentUserId_submittedAt_idx" ON "FormSubmission"("respondentUserId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_respondentUserId_idx" ON "FormSubmission"("formId", "respondentUserId");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_respondentEmail_idx" ON "FormSubmission"("formId", "respondentEmail");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_ipHash_idx" ON "FormSubmission"("formId", "ipHash");

-- CreateIndex
CREATE INDEX "FormAnswer_fieldId_idx" ON "FormAnswer"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "FormAnswer_submissionId_fieldId_key" ON "FormAnswer"("submissionId", "fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_key_key" ON "FormTemplate"("key");

-- CreateIndex
CREATE INDEX "FormTemplate_category_updatedAt_idx" ON "FormTemplate"("category", "updatedAt");

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormEvent" ADD CONSTRAINT "FormEvent_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormEvent" ADD CONSTRAINT "FormEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_respondentUserId_fkey" FOREIGN KEY ("respondentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
