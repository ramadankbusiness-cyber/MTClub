-- Add optional user identity fields (additive, non-destructive). "phone" already exists from initial migration.
ALTER TABLE "User" ADD COLUMN "academicNumber" VARCHAR(64);
ALTER TABLE "User" ADD COLUMN "clubId" VARCHAR(64);

-- Prevent duplicates when values are provided; PostgreSQL allows multiple NULLs in unique indexes
CREATE UNIQUE INDEX "User_academicNumber_key" ON "User"("academicNumber");
CREATE UNIQUE INDEX "User_clubId_key" ON "User"("clubId");
