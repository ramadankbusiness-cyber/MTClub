import { PrismaClient } from "@/lib/generated/prisma";
import { getSafeDatabaseEnvIssues } from "@/lib/auth-config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaDbEnvWarned?: boolean };

if (!globalForPrisma.prismaDbEnvWarned) {
  globalForPrisma.prismaDbEnvWarned = true;
  const dbIssues = getSafeDatabaseEnvIssues();
  if (dbIssues.length > 0) {
    console.warn("[prisma] Database environment warnings", {
      issues: dbIssues.map((issue) => ({ code: issue.code, message: issue.message })),
    });
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
