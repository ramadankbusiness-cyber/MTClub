import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "./prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export async function writeAuditLog(input: {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Prisma.InputJsonValue;
  ipHash?: string | null;
}, db: Db = prisma) {
  return db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      details: input.details,
      ipHash: input.ipHash ?? null,
    },
  });
}
