import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth-guards";
import { team as fallbackTeam } from "@/data/team";
import { TeamManager, type ManagedTeamMember } from "@/components/team-manager";
import { TeamDirectory } from "@/components/team-directory";
import { listClubCommittees } from "@/lib/committees";
import { buildPageMetadata, publicPageDescriptions } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") return {};
  return buildPageMetadata({
    locale,
    path: "/team",
    titleTagline: { en: "Meet the team", ar: "تعرّف على الفريق" },
    description: publicPageDescriptions.team,
  });
}

export default async function TeamPage() {
  const user = process.env.DATABASE_URL ? await getCurrentUser() : null;
  const isAdmin = user?.role === "ADMIN" && !!user.isActive && !user.mustChangePassword;
  let members: ManagedTeamMember[] = [];
  let committees: { id: string; key: string; name: string; nameAr: string }[] = [];
  if (process.env.DATABASE_URL) {
    const [databaseMembers, databaseCommittees] = await Promise.all([
      prisma.teamMember.findMany({
        where: isAdmin ? {} : { visible: true },
        include: { committee: { select: { id: true, key: true, name: true, nameAr: true, type: true } } },
        orderBy: [{ isMTC: "desc" }, { order: "asc" }, { name: "asc" }],
      }),
      listClubCommittees(null, { includeMTC: isAdmin }),
    ]);
    members = databaseMembers.map((member) => {
      const links = member.socialLinks && typeof member.socialLinks === "object" && !Array.isArray(member.socialLinks)
        ? member.socialLinks as Record<string, unknown>
        : null;
      return {
        ...member,
        position: member.position as "HEAD" | "VICE" | "LEADER",
        isMTC: member.isMTC || member.committee?.key === "mtc",
        committeeId: member.committeeId,
        socialLinks: links ? {
          website: typeof links.website === "string" ? links.website : undefined,
          linkedin: typeof links.linkedin === "string" ? links.linkedin : undefined,
          instagram: typeof links.instagram === "string" ? links.instagram : undefined,
        } : null,
      };
    });
    committees = databaseCommittees;
  }
  const staticFallback = !process.env.DATABASE_URL
    ? fallbackTeam.map((member, index) => ({
      id: `static-${index}`, name: member.name, title: member.title || member.role,
      titleAr: member.roleAr,
      position: "LEADER" as const,
      isMTC: false,
      committeeId: null, committee: null, bio: member.description,
      bioAr: member.descriptionAr,
      socialLinks: null, photoUrl: member.image || null, order: index, visible: true, userId: null,
    }))
    : [];
  const publicMembers = process.env.DATABASE_URL ? members.filter((member) => member.visible) : staticFallback;
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <TeamDirectory members={publicMembers} committees={committees} />
      </section>
      {isAdmin && <div className="content-section team-manager-section"><TeamManager initialMembers={members} committees={committees} /></div>}
    </main>
  );
}
