import dotenv from "dotenv";
import { PrismaClient } from "../lib/generated/prisma";
import bcrypt from "bcryptjs";
import { Role } from "../lib/db-enums";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const providedPassword = process.env.ADMIN_PASSWORD;
const resetPassword = process.argv.includes("--reset-password");

export function isValidAdminPassword(value: string | undefined): value is string {
  return !!value && value.length >= 16 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

export async function runAdminSeed(options?: {
  email?: string;
  providedPassword?: string;
  resetPassword?: boolean;
  databaseUrl?: string;
  prismaClient?: PrismaClient;
}) {
  const targetEmail = (options?.email !== undefined ? options.email : email)?.trim().toLowerCase();
  const adminPassword =
    options?.providedPassword !== undefined
      ? options.providedPassword
      : providedPassword;
  const shouldReset = options?.resetPassword ?? resetPassword;
  const db = options?.prismaClient ?? prisma;
  const databaseUrl = options?.databaseUrl !== undefined ? options.databaseUrl : process.env.DATABASE_URL;

  if (shouldReset && !isValidAdminPassword(adminPassword)) {
    throw new Error("ADMIN_PASSWORD must be set and valid before using --reset-password.");
  }
  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    throw new Error("Set a valid ADMIN_EMAIL in .env.local.");
  }
  if (shouldReset) {
    if (!isValidAdminPassword(adminPassword)) {
      throw new Error("ADMIN_PASSWORD must be set and valid before using --reset-password.");
    }
    if (!databaseUrl) {
      throw new Error("ADMIN_SEED_DATABASE_MISSING");
    }
    const existing = await db.user.findUnique({
      where: { email: targetEmail },
      select: { id: true },
    });
    if (!existing) {
      throw new Error("Admin account not found for ADMIN_EMAIL; reset aborted without creating a new account.");
    }
    const customPasswordHash = await bcrypt.hash(adminPassword, 12);
    await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: customPasswordHash,
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        sessionVersion: { increment: 1 },
      },
    });
    return { action: "reset" as const, id: existing.id };
  }

  if (!databaseUrl) {
    throw new Error("ADMIN_SEED_DATABASE_MISSING");
  }
  const existing = await db.user.findUnique({
    where: { email: targetEmail },
    select: { id: true },
  });
  if (existing) {
    return { action: "unchanged" as const, id: existing.id };
  }

  const initialPasswordHash = await bcrypt.hash("mtc123", 12);
  const admin = await db.user.create({
    data: {
      name: "MT Club Admin",
      email: targetEmail,
      role: Role.ADMIN,
      isActive: true,
      committeeId: null,
      passwordHash: initialPasswordHash,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: null,
    },
    select: { id: true },
  });
  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: "admin.bootstrap",
      targetType: "User",
      targetId: admin.id,
    },
  });
  return { action: "created" as const, id: admin.id };
}

async function main() {
  const result = await runAdminSeed();
  if (result.action === "created") {
    console.info(`Admin account created for ${email}.`);
  } else if (result.action === "reset") {
    console.info(`Admin password reset for ${email}.`);
  } else {
    console.info(`Admin account already exists for ${email}; no credentials changed.`);
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(entry)
      || import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main()
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "ADMIN_SEED_DATABASE_MISSING") {
        console.error("Admin seed failed: set DATABASE_URL in .env.local.");
      } else if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error("Admin seed failed. Check the environment configuration and database connection.");
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
