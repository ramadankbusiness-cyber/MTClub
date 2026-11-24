"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SectionHeading } from "@/components/section-heading";
import { useSite } from "@/components/site-provider";
import { useTranslations } from "next-intl";
import { getCommitteeLabel, getPositionLabel, POSITION_ORDER, type PositionLevel } from "@/data/committees";
import type { ManagedTeamMember } from "@/components/team-manager";

type DbCommittee = { id: string; key: string; name: string; nameAr: string };

function compareMembers(a: ManagedTeamMember, b: ManagedTeamMember) {
  const ap = POSITION_ORDER[(a.position ?? "LEADER") as PositionLevel] ?? 2;
  const bp = POSITION_ORDER[(b.position ?? "LEADER") as PositionLevel] ?? 2;
  return ap - bp || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
}

function useReveal() {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof window === "undefined") {
      setVisible(true);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

type CommitteeHeadingProps = {
  id: string;
  index: number;
  name: string;
  label: string;
  description?: string;
};

function CommitteeHeading({ id, index, name, label, description }: CommitteeHeadingProps) {
  return (
    <header className="team-group-heading">
      <span className="team-group-index" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="team-group-heading-body">
        <p className="team-group-kicker">{label}</p>
        <div className="team-group-title-row">
          <h2 id={id} className="team-group-title">{name}</h2>
          <span className="team-group-rule" aria-hidden="true" />
        </div>
        {description ? <p className="team-group-description">{description}</p> : null}
      </div>
      <span className="team-group-watermark" aria-hidden="true">{name}</span>
    </header>
  );
}

function MemberCard({ member, index, large = false }: { member: ManagedTeamMember; index: number; large?: boolean }) {
  const { language } = useSite();
  const pages = useTranslations("site.pages.team");
  const position = (member.position ?? "LEADER") as PositionLevel;
  const badgeClass = position === "HEAD" ? "is-head" : position === "VICE" ? "is-vice" : "is-leader";
  const committeeTag = member.isMTC && !member.committee ? "MTC" : getCommitteeLabel(member.committee?.name, language);
  return (
    <article className={`team-card team-tone-${index % 4}${large ? " team-card-mtc" : ""}`} key={member.id} data-position={position}>
      <div className="team-avatar">
        {member.photoUrl
          ? <Image src={member.photoUrl} alt={member.name} fill sizes={large ? "(max-width: 640px) 95vw, (max-width: 1024px) 50vw, 320px" : "(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 260px"} unoptimized />
          : <span aria-hidden="true">{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>}
      </div>
      <div className="team-card-copy">
        <p className="team-role">{language === "ar" ? member.titleAr ?? member.title : member.title}</p>
        <h2>{member.name}</h2>
        <div className="team-badges">
          <span className={`position-badge ${badgeClass}`}>{getPositionLabel(position, language)}</span>
          {committeeTag && <span className="committee-tag">{committeeTag}</span>}
        </div>
        {(language === "ar" ? member.bioAr ?? member.bio : member.bio) && <p>{language === "ar" ? member.bioAr ?? member.bio : member.bio}</p>}
        {member.socialLinks && <div className="team-socials">
          {member.socialLinks.website && <a href={member.socialLinks.website} target="_blank" rel="noreferrer">{pages("website")}</a>}
          {member.socialLinks.linkedin && <a href={member.socialLinks.linkedin} target="_blank" rel="noreferrer">{pages("linkedin")}</a>}
          {member.socialLinks.instagram && <a href={member.socialLinks.instagram} target="_blank" rel="noreferrer">{pages("instagram")}</a>}
        </div>}
      </div>
    </article>
  );
}

function TeamGroupSection({
  id,
  index,
  name,
  label,
  description,
  className = "",
  gridClassName = "team-grid",
  children,
}: {
  id: string;
  index: number;
  name: string;
  label: string;
  description?: string;
  className?: string;
  gridClassName?: string;
  children: ReactNode;
}) {
  const { ref, visible } = useReveal();
  return (
    <section
      ref={ref}
      className={`team-group ${visible ? "is-visible" : ""} ${className}`.trim()}
      aria-labelledby={id}
    >
      <CommitteeHeading id={id} index={index} name={name} label={label} description={description} />
      <div className={gridClassName}>{children}</div>
    </section>
  );
}

export function TeamDirectory({ members, committees = [] }: { members: ManagedTeamMember[]; committees?: DbCommittee[] }) {
  const { language, text } = useSite();
  const pages = useTranslations("site.pages.team");

  const mtcMembers = useMemo(() => members.filter((m) => m.isMTC).sort(compareMembers), [members]);
  const grouped = useMemo(() => {
    const map = new Map<string, { committee: DbCommittee; members: ManagedTeamMember[] }>();
    for (const committee of committees) {
      if (committee.key === "mtc") continue;
      map.set(committee.id, { committee, members: [] });
    }
    for (const member of members) {
      if (!member.committeeId) continue;
      if (member.committee?.key === "mtc") continue;
      const group = map.get(member.committeeId);
      if (group) group.members.push(member);
      else if (member.committee && (member.committee as DbCommittee).key !== "mtc") {
        map.set(member.committeeId, { committee: member.committee as DbCommittee, members: [member] });
      }
    }
    return [...map.values()].map((g) => ({ ...g, members: g.members.sort(compareMembers) })).filter((g) => g.members.length > 0);
  }, [members, committees]);

  const hasAny = mtcMembers.length > 0 || grouped.length > 0;
  let sectionIndex = 0;
  return (
    <>
      <SectionHeading eyebrow={text.team.eyebrow} title={text.team.title} lead={text.team.lead} />
      {!hasAny ? <p className="empty-note">{pages("empty")}</p> : (
        <div className="team-sections">
          {mtcMembers.length > 0 && (
            <TeamGroupSection
              id="team-mtc-title"
              index={sectionIndex++}
              name="MTC"
              label={pages("committeeLabel")}
              description={language === "ar" ? "هيدات الفريق" : "The heads of the team"}
              className="team-group-mtc"
              gridClassName="team-grid team-grid-mtc"
            >
              {mtcMembers.map((member, index) => <MemberCard key={member.id} member={member} index={index} large />)}
            </TeamGroupSection>
          )}
          {grouped.map((group, gi) => (
            <TeamGroupSection
              key={group.committee.id}
              id={`team-group-${group.committee.id}`}
              index={sectionIndex++}
              name={language === "ar" ? group.committee.nameAr : group.committee.name}
              label={pages("committeeLabel")}
            >
              {group.members.map((member, index) => <MemberCard key={`${member.id}-${gi}`} member={member} index={index} />)}
            </TeamGroupSection>
          ))}
        </div>
      )}
    </>
  );
}
