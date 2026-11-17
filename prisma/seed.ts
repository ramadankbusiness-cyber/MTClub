import dotenv from "dotenv";
import { PrismaClient } from "../lib/generated/prisma";
import bcrypt from "bcryptjs";
import { CLUB_COMMITTEES, committeeDetails } from "../data/committees";
import { Role } from "../lib/db-enums";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const emailFor = (value: string) => value.trim().toLowerCase();

async function seedAccount(input: {
  name: string;
  email: string;
  role: Role;
  committeeId?: string;
}) {
  const email = emailFor(input.email);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing.id;
  const passwordHash = await bcrypt.hash("mtc123", 12);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email,
      role: input.role,
      committeeId: input.committeeId,
      passwordHash,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: null,
    },
    select: { id: true },
  });
  console.info(`Created ${input.role.toLowerCase()} account: ${email}.`);
  return user.id;
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });
  if (!admin) {
    throw new Error("Create the initial Admin account first by running `npm run seed:admin`.");
  }

  for (const [legacyName, canonicalName] of [["Leadership", "OC"], ["Technology", "Tech"]] as const) {
    const legacy = await prisma.committee.findUnique({ where: { name: legacyName }, select: { id: true } });
    if (!legacy) continue;
    const canonical = await prisma.committee.findUnique({ where: { name: canonicalName }, select: { id: true } });
    if (!canonical) {
      await prisma.committee.update({ where: { id: legacy.id }, data: { name: canonicalName } });
      continue;
    }
    await prisma.$transaction([
      prisma.user.updateMany({ where: { committeeId: legacy.id }, data: { committeeId: canonical.id } }),
      prisma.teamMember.updateMany({ where: { committeeId: legacy.id }, data: { committeeId: canonical.id } }),
      prisma.event.updateMany({ where: { committeeId: legacy.id }, data: { committeeId: canonical.id } }),
      prisma.attendanceSession.updateMany({ where: { committeeId: legacy.id }, data: { committeeId: canonical.id } }),
      prisma.zone.updateMany({ where: { committeeId: legacy.id }, data: { committeeId: canonical.id } }),
      prisma.notification.updateMany({ where: { committeeId: legacy.id }, data: { committeeId: canonical.id } }),
      prisma.committee.delete({ where: { id: legacy.id } }),
    ]);
  }

  for (const [index, name] of CLUB_COMMITTEES.entries()) {
    const detail = committeeDetails[name];
    await prisma.committee.upsert({
      where: { key: detail.key },
      update: { name, nameAr: detail.nameAr, type: "committee", descriptionEn: detail.description, descriptionAr: detail.descriptionAr, order: index + 1 },
      create: { key: detail.key, name, nameAr: detail.nameAr, type: "committee", descriptionEn: detail.description, descriptionAr: detail.descriptionAr, order: index + 1 },
    });
  }
  const mtcCommittee = await prisma.committee.upsert({
    where: { key: "mtc" },
    update: { name: "MTC", nameAr: "MTC", type: "board", descriptionEn: "Club heads / leadership board.", descriptionAr: "هيدات الفريق / مجلس قيادة النادي.", order: 0 },
    create: { key: "mtc", name: "MTC", nameAr: "MTC", type: "board", descriptionEn: "Club heads / leadership board.", descriptionAr: "هيدات الفريق / مجلس قيادة النادي.", order: 0 },
  });
  const [oc, tech] = await Promise.all([
    prisma.committee.findUniqueOrThrow({ where: { name: "OC" } }),
    prisma.committee.findUniqueOrThrow({ where: { name: "Tech" } }),
  ]);

  const leaders = [
    { name: "OC Committee Lead", email: "leader.leadership@example.com", committeeId: oc.id },
    { name: "Tech Committee Lead", email: "leader.technology@example.com", committeeId: tech.id },
  ];
  for (const leader of leaders) {
    await seedAccount({ ...leader, role: Role.LEADER });
  }

  for (let index = 1; index <= 10; index += 1) {
    await seedAccount({
      name: `MT Club Member ${String(index).padStart(2, "0")}`,
      email: `member${String(index).padStart(2, "0")}@example.com`,
      role: Role.MEMBER,
      committeeId: index % 2 === 0 ? tech.id : oc.id,
    });
  }

  const zone = await prisma.zone.findFirst({ where: { name: "Main Hall", committeeId: null } });
  if (!zone) {
    await prisma.zone.create({
      data: { name: "Main Hall", latitude: 30.0444, longitude: 31.2357, radiusMeters: 100 },
    });
  }

  const sampleEvents = [
    { title: "Community Welcome Session", daysFromNow: 14, location: "Main Hall", description: "Meet the community, explore the club, and find your next opportunity to learn and build." },
    { title: "Project Collaboration Workshop", daysFromNow: 28, location: "Main Hall", description: "A hands-on workshop for members to form teams and start shaping collaborative projects." },
  ];
  for (const event of sampleEvents) {
    const existing = await prisma.event.findFirst({ where: { title: event.title } });
    if (!existing) {
      await prisma.event.create({
        data: {
          title: event.title,
          description: event.description,
          startsAt: new Date(Date.now() + event.daysFromNow * 24 * 60 * 60 * 1000),
          location: event.location,
          createdById: admin.id,
          published: true,
        },
      });
    }
  }

  const teamSeed = [
    { name: "Baher Alaa", title: "HEAD MTC", position: "HEAD" as const, isMTC: true, committeeId: mtcCommittee.id, bio: "Bringing the club's people and ideas together." },
    { name: "Laila Ziad", title: "Vice Head, MT Club", position: "VICE" as const, isMTC: false, committeeId: oc.id, bio: "Helping the community learn and grow together." },
    { name: "Mahmoud Sameh", title: "Head, Tech", position: "HEAD" as const, isMTC: false, committeeId: tech.id, bio: "Leading the club's technology committee." },
    { name: "Ramadan Kamal", title: "Vice Head, Tech", position: "VICE" as const, isMTC: false, committeeId: tech.id, bio: "Building thoughtful technology experiences." },
  ];
  for (const [index, entry] of teamSeed.entries()) {
    const existing = await prisma.teamMember.findFirst({ where: { name: entry.name } });
    if (!existing) await prisma.teamMember.create({ data: { ...entry, order: index } });
    else await prisma.teamMember.update({ where: { id: existing.id }, data: { ...entry, order: index } });
  }
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
