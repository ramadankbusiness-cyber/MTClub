"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";
import { useLocale, useTranslations } from "next-intl";
import { getCommitteeLabel, getPositionLabel, suggestTitle, POSITION_ORDER, type PositionLevel } from "@/data/committees";
import { CommitteeSelect } from "@/components/committee-select";

type DbCommittee = { id: string; key: string; name: string; nameAr: string; type?: string };
export type ManagedTeamMember = {
  id: string;
  name: string;
  title: string;
  titleAr?: string | null;
  position?: PositionLevel;
  isMTC?: boolean;
  committeeId: string | null;
  committee: { id?: string; key?: string; name: string; nameAr?: string } | null;
  bio: string | null;
  bioAr?: string | null;
  socialLinks: { website?: string; linkedin?: string; instagram?: string } | null;
  photoUrl: string | null;
  order: number;
  visible: boolean;
  userId: string | null;
};

type FormState = {
  name: string; title: string; titleAr: string; position: PositionLevel; isMTC: boolean; committeeId: string;
  bio: string; bioAr: string; photoUrl: string; visible: boolean;
  socialLinks: { website?: string; linkedin?: string; instagram?: string } | null;
};
const blank: FormState = { name: "", title: "", titleAr: "", position: "LEADER", isMTC: false, committeeId: "", bio: "", bioAr: "", photoUrl: "", visible: true, socialLinks: null };

function groupKey(member: Pick<ManagedTeamMember, "isMTC" | "committeeId">) {
  return member.isMTC ? "mtc" : (member.committeeId ?? "none");
}

function compareMembers(a: ManagedTeamMember, b: ManagedTeamMember) {
  const ap = POSITION_ORDER[a.position ?? "LEADER"] ?? 2;
  const bp = POSITION_ORDER[b.position ?? "LEADER"] ?? 2;
  return ap - bp || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
}

export function TeamManager({ initialMembers, committees }: { initialMembers: ManagedTeamMember[]; committees: DbCommittee[] }) {
  const showToast = useAppToast();
  const t = useTranslations("site.pages.teamManager");
  const locale = useLocale() as "en" | "ar";
  const [members, setMembers] = useState(initialMembers);
  const regularCommittees = committees.filter((c) => c.key !== "mtc");
  const [form, setForm] = useState<FormState>({ ...blank, committeeId: regularCommittees[0]?.id ?? committees[0]?.id ?? "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [formLanguage, setFormLanguage] = useState<"en" | "ar">("en");
  const [filterCommittee, setFilterCommittee] = useState("");
  const [filterPosition, setFilterPosition] = useState<"" | PositionLevel>("");
  const [filterMtc, setFilterMtc] = useState<"" | "yes" | "no">("");

  const groupNameFor = (committeeId: string, isMTC: boolean) => {
    if (isMTC) return "MTC";
    return committees.find((c) => c.id === committeeId)?.name ?? "Committee";
  };
  const autoTitle = (position: PositionLevel, committeeId: string, isMTC: boolean) => suggestTitle(position, groupNameFor(committeeId, isMTC), "en");

  function startEdit(member: ManagedTeamMember) {
    setEditingId(member.id);
    setForm({
      name: member.name, title: member.title, titleAr: member.titleAr ?? "", position: member.position ?? "LEADER", isMTC: !!member.isMTC || member.committee?.key === "mtc",
      committeeId: member.committeeId ?? "", bio: member.bio ?? "", bioAr: member.bioAr ?? "",
      photoUrl: member.photoUrl ?? "", visible: member.visible,
      socialLinks: member.socialLinks ?? null,
    });
    setPhoto(null);
    setFormLanguage("en");
    setMessage("");
  }

  function resetForm() {
    const defaultCommitteeId = regularCommittees[0]?.id ?? "";
    setEditingId(null);
    setForm({ ...blank, committeeId: defaultCommitteeId, title: autoTitle("LEADER", defaultCommitteeId, false) });
    setPhoto(null);
  }

  const filtered = useMemo(() => members.filter((m) => {
    if (filterMtc === "yes" && !m.isMTC) return false;
    if (filterMtc === "no" && m.isMTC) return false;
    if (filterPosition && (m.position ?? "LEADER") !== filterPosition) return false;
    if (filterCommittee && m.committeeId !== filterCommittee) return false;
    return true;
  }).sort(compareMembers), [members, filterCommittee, filterPosition, filterMtc]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedCommittee = committees.find((c) => c.id === form.committeeId);
    const effectiveIsMTC = form.isMTC || selectedCommittee?.key === "mtc";
    if (!effectiveIsMTC && !form.committeeId) { setMessage(t("saveError")); return; }
    setBusy(true);
    setMessage("");
    try {
      let photoUrl = form.photoUrl;
      if (photo) {
        const upload = new FormData();
        upload.set("photo", photo);
        const response = await fetch("/api/team/upload", { method: "POST", body: upload });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Photo upload failed.");
        photoUrl = result.url;
      }
      const payload = {
        name: form.name, title: form.title, titleAr: form.titleAr || null, position: form.position, isMTC: effectiveIsMTC,
        committeeId: form.committeeId || null, bio: form.bio || null, bioAr: form.bioAr || null,
        socialLinks: form.socialLinks ?? undefined,
        photoUrl: photoUrl || null, visible: form.visible,
      };
      const response = await fetch(editingId ? `/api/team/${editingId}` : "/api/team", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save this team member.");
      setMembers((current) => editingId
        ? current.map((member) => member.id === editingId ? result.member : member)
        : [...current, result.member]);
      resetForm();
    } catch {
      const errorMessage = t("saveError");
      setMessage(errorMessage);
      showToast(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: ManagedTeamMember) {
    if (!window.confirm(t("removeConfirm", { name: member.name }))) return;
    const response = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json();
      setMessage(result.error ?? t("removeError"));
      return;
    }
    setMembers((current) => current.filter((entry) => entry.id !== member.id));
  }

  async function changeOrder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromMember = members.find((m) => m.id === fromId);
    const toMember = members.find((m) => m.id === toId);
    if (!fromMember || !toMember) return;
    if (groupKey(fromMember) !== groupKey(toMember) || (fromMember.position ?? "LEADER") !== (toMember.position ?? "LEADER")) return;
    const bucket = members.filter((m) => groupKey(m) === groupKey(fromMember) && (m.position ?? "LEADER") === (fromMember.position ?? "LEADER")).sort(compareMembers);
    const from = bucket.findIndex((e) => e.id === fromId);
    const to = bucket.findIndex((e) => e.id === toId);
    if (from < 0 || to < 0) return;
    const [item] = bucket.splice(from, 1);
    bucket.splice(to, 0, item);
    const reordered = bucket.map((m, i) => ({ ...m, order: i }));
    const next = members.map((m) => reordered.find((r) => r.id === m.id) ?? m);
    setMembers(next);
    const response = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: reordered.map((entry) => entry.id) }),
    });
    if (!response.ok) {
      setMembers(members);
      setMessage(t("orderError"));
    }
  }

  return (
    <section className="team-admin-panel">
      <div className="admin-section-heading">
        <div><p className="eyebrow">{t("controls")}</p><h2>{t("manage")}</h2></div>
        <button className="button button-primary" type="button" onClick={() => { resetForm(); setMessage(""); }}>{t("add")}</button>
      </div>
      <div className="admin-form-grid team-admin-filters">
        <label><span>{t("committee")}</span><CommitteeSelect committees={committees} includeMTC value={filterCommittee} onChange={(v) => setFilterCommittee(Array.isArray(v) ? "" : (v ?? ""))} mode="single" showAll allLabel={locale === "ar" ? "كل اللجان" : "All committees"} /></label>
        <label><span>{t("position") ?? "Position"}</span><select value={filterPosition} onChange={(e) => setFilterPosition(e.target.value as "" | PositionLevel)}><option value="">{locale === "ar" ? "كل المناصب" : "All positions"}</option><option value="HEAD">{getPositionLabel("HEAD", locale)}</option><option value="VICE">{getPositionLabel("VICE", locale)}</option><option value="LEADER">{getPositionLabel("LEADER", locale)}</option></select></label>
        <label><span>{t("mtcFilter") ?? "MTC"}</span><select value={filterMtc} onChange={(e) => setFilterMtc(e.target.value as "" | "yes" | "no")}><option value="">{locale === "ar" ? "الكل" : "All"}</option><option value="yes">{locale === "ar" ? "MTC فقط" : "MTC only"}</option><option value="no">{locale === "ar" ? "غير MTC" : "Non-MTC"}</option></select></label>
      </div>
      <div className="team-admin-list">
        {filtered.map((member) => (
          <div
            className={`team-admin-row${draggedId === member.id ? " is-dragged" : ""}`}
            key={member.id}
            draggable
            onDragStart={() => setDraggedId(member.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { if (draggedId) void changeOrder(draggedId, member.id); setDraggedId(null); }}
            onDragEnd={() => setDraggedId(null)}
          >
            <span className="drag-handle" aria-label={t("drag")} title={t("drag")}>⠿</span>
            <div className="team-admin-avatar">
              {member.photoUrl ? <Image src={member.photoUrl} alt="" fill sizes="48px" unoptimized /> : <span>{member.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="team-admin-name"><strong>{member.name}</strong><span>{member.title} · {member.committee?.key === "mtc" || member.isMTC ? "MTC" : getCommitteeLabel(member.committee?.name, locale)} · {getPositionLabel(member.position ?? "LEADER", locale)}</span></div>
            <span className={`visibility-tag${member.visible ? "" : " is-hidden"}`}>{member.visible ? t("visible") : t("hidden")}</span>
            <button type="button" className="button button-secondary" onClick={() => startEdit(member)}>{t("editButton")}</button>
            <button type="button" className="button button-secondary danger-button" onClick={() => void remove(member)}>{t("remove")}</button>
          </div>
        ))}
        {!filtered.length && <p className="empty-note">{t("empty")}</p>}
      </div>

      <form className="team-edit-form" onSubmit={save}>
        <h3>{editingId ? t("edit") : t("addTitle")}</h3>
        <div className="language-tabs" role="tablist" aria-label="Team member language">
          <button type="button" role="tab" aria-selected={formLanguage === "en"} onClick={() => setFormLanguage("en")}>{t("english")}</button>
          <button type="button" role="tab" aria-selected={formLanguage === "ar"} onClick={() => setFormLanguage("ar")}>{t("arabic")}</button>
        </div>
        <div className="admin-form-grid">
          <label>{t("name")}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={100} /></label>
          <label>{t("position") ?? "Position"}<select value={form.position} onChange={(e) => { const pos = e.target.value as PositionLevel; setForm((f) => ({ ...f, position: pos, title: f.title && f.title !== autoTitle(f.position, f.committeeId, f.isMTC) ? f.title : autoTitle(pos, f.committeeId, f.isMTC) })); }} required>
            <option value="HEAD">{getPositionLabel("HEAD", locale)}</option>
            <option value="VICE">{getPositionLabel("VICE", locale)}</option>
            <option value="LEADER">{getPositionLabel("LEADER", locale)}</option>
          </select></label>
          <label className="visibility-control"><input type="checkbox" checked={form.isMTC} onChange={(e) => { const isMTC = e.target.checked; setForm((f) => ({ ...f, isMTC, title: f.title && f.title !== autoTitle(f.position, f.committeeId, f.isMTC) ? f.title : autoTitle(f.position, f.committeeId, isMTC) })); }} />{t("isMtc") ?? "Part of MTC / Club heads"}</label>
          {formLanguage === "en"
            ? <label>{t("titleEn")}<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={t("titlePlaceholder")} required maxLength={100} /></label>
            : <label lang="ar">{t("titleAr")}<input value={form.titleAr} onChange={(event) => setForm({ ...form, titleAr: event.target.value })} dir="rtl" maxLength={100} /></label>}
          <label>{t("committee")}<CommitteeSelect
            committees={committees}
            includeMTC
            value={form.committeeId}
            onChange={(v) => {
              const committeeId = Array.isArray(v) ? "" : (v || "");
              const selected = committees.find((c) => c.id === committeeId);
              const isMTCCommittee = selected?.key === "mtc";
              setForm((f) => {
                const nextIsMTC = isMTCCommittee ? true : f.isMTC;
                const nextTitle = f.title && f.title !== autoTitle(f.position, f.committeeId, f.isMTC) ? f.title : autoTitle(f.position, committeeId, nextIsMTC || isMTCCommittee);
                return { ...f, committeeId, isMTC: nextIsMTC, title: nextTitle };
              });
            }}
            mode="single"
            required={!form.isMTC}
          /></label>
          <label>{t("photo")}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
          {formLanguage === "en"
            ? <label className="admin-form-wide">{t("bioEn")}<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} maxLength={500} rows={3} /></label>
            : <label className="admin-form-wide" lang="ar">{t("bioAr")}<textarea value={form.bioAr} onChange={(event) => setForm({ ...form, bioAr: event.target.value })} dir="rtl" maxLength={500} rows={3} /></label>}
          <label className="visibility-control"><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} />{t("show")}</label>
        </div>
        {message && <p className="form-error" role="alert">{message}</p>}
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? t("saving") : t("save")}</button>{editingId && <button className="button button-secondary" type="button" onClick={resetForm}>{t("cancel")}</button>}</div>
      </form>
    </section>
  );
}
