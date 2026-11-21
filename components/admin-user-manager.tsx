"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";
import { useLocale, useTranslations } from "next-intl";
import { CommitteeSelect } from "@/components/committee-select";
import { getPositionLabel, type PositionLevel } from "@/data/committees";

type Role = "ADMIN" | "LEADER" | "MEMBER";
type DbCommittee = { id: string; key: string; name: string; nameAr: string; type?: string };
export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  academicNumber?: string | null;
  clubId?: string | null;
  role: Role;
  position?: PositionLevel;
  isMTC?: boolean;
  committeeId: string | null;
  committee: { id?: string; key?: string; name: string; nameAr?: string } | null;
  isActive: boolean;
  mustChangePassword: boolean;
};

const parseRole = (value: string): Role => value === "ADMIN" || value === "LEADER" || value === "MEMBER" ? value : "MEMBER";
const defaultRoleForPosition = (position: PositionLevel): Role => (position === "HEAD" || position === "VICE" || position === "LEADER") ? "LEADER" : "MEMBER";
const toNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function AdminUserManager({ initialUsers, committees, userRole, userCommitteeId }: { initialUsers: AdminUserRow[]; committees: DbCommittee[]; userRole?: Role; userCommitteeId?: string | null }) {
  const t = useTranslations("site.adminPages.users");
  const locale = useLocale() as "en" | "ar";
  const showToast = useAppToast();
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState({ name: "", email: "", phone: "", academicNumber: "", clubId: "", role: "MEMBER" as Role, position: "LEADER" as PositionLevel, isMTC: false, committeeId: userRole === "LEADER" && userCommitteeId ? userCommitteeId : "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showTempDialog, setShowTempDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      setTemporaryPassword("");
      setShowTempDialog(false);
    };
  }, []);

  function clearTemporaryPassword() {
    setTemporaryPassword("");
    setShowTempDialog(false);
    setCopied(false);
  }

  function revealTemporaryPassword(password: string) {
    setCopied(false);
    setTemporaryPassword(password);
    setShowTempDialog(true);
  }

  async function copyTemporaryPassword() {
    if (!temporaryPassword) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(temporaryPassword);
        setCopied(true);
      }
    } catch {
      setCopied(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    clearTemporaryPassword();
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: toNull(form.phone),
          academicNumber: toNull(form.academicNumber),
          clubId: toNull(form.clubId),
          role: form.role,
          position: form.position,
          isMTC: form.isMTC,
          committeeId: form.committeeId || null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "create-failed");
      const committee = committees.find((entry) => entry.id === result.user.committeeId) ?? null;
      setUsers((current) => [...current, { ...result.user, committee, isActive: true, mustChangePassword: true }]);
      setMessage(t("created", { email: result.user.email }) + " Initial password: mtc123 (must be changed on first sign-in).");
      setForm({ name: "", email: "", phone: "", academicNumber: "", clubId: "", role: "MEMBER", position: "LEADER", isMTC: false, committeeId: userRole === "LEADER" && userCommitteeId ? userCommitteeId : "" });
    } catch (error) {
      const errorMessage = error instanceof Error && error.message && error.message !== "create-failed" ? error.message : t("createError");
      setMessage(errorMessage);
      showToast(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function saveUser(id: string, changes: Record<string, unknown>) {
    setMessage("");
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = result?.error || t("updateError");
      setMessage(errorMessage);
      showToast(errorMessage);
      return;
    }
    if (result?.user) {
      setUsers((current) => current.map((user) => user.id === id ? {
        ...user,
        ...result.user,
        committee: committees.find((entry) => entry.id === (result.user.committeeId ?? null)) ?? null,
      } : user));
    }
    if ("isActive" in changes) return;
    setMessage(t("roleUpdated"));
  }

  async function resetPassword(id: string) {
    clearTemporaryPassword();
    const response = await fetch(`/api/admin/users/${id}`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(result?.error || t("resetError")); return; }
    if (result.temporaryPassword) revealTemporaryPassword(result.temporaryPassword);
    setMessage(t("resetDone"));
    setUsers((current) => current.map((user) => user.id === id ? { ...user, mustChangePassword: true } : user));
  }

  async function removeUser(user: AdminUserRow) {
    if (!window.confirm(t("deleteConfirm", { name: user.name }))) return;
    const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(result?.error || t("deleteError")); return; }
    setUsers((current) => current.filter((entry) => entry.id !== user.id));
  }

  return (
    <div className="admin-users">
      <form className="team-edit-form compact-form" onSubmit={createUser}>
        <h2>{t("createTitle")}</h2>
        <div className="admin-form-grid compact-form-grid">
          <label>{t("name")}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={100} /></label>
          <label>{t("email")}<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required maxLength={254} /></label>
          <label>Phone Number<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+20 100 000 0000" maxLength={32} /></label>
          <label>Academic Number<input value={form.academicNumber} onChange={(event) => setForm({ ...form, academicNumber: event.target.value })} maxLength={64} /></label>
          <label>MT Club ID<input value={form.clubId} onChange={(event) => setForm({ ...form, clubId: event.target.value })} maxLength={64} /></label>
          <label>{t("role")}<select value={form.role} onChange={(event) => setForm({ ...form, role: parseRole(event.target.value) })}><option value="MEMBER">{t("member")}</option><option value="LEADER">{t("leader")}</option><option value="ADMIN">{t("admin")}</option></select></label>
          <label>{t("position") ?? "Position"}<select value={form.position} onChange={(event) => { const position = event.target.value as PositionLevel; setForm({ ...form, position, role: defaultRoleForPosition(position) }); }}><option value="HEAD">{getPositionLabel("HEAD", locale)}</option><option value="VICE">{getPositionLabel("VICE", locale)}</option><option value="LEADER">{getPositionLabel("LEADER", locale)}</option></select></label>
          <label className="visibility-control"><input type="checkbox" checked={form.isMTC} onChange={(event) => setForm({ ...form, isMTC: event.target.checked })} /><span>{t("isMtc") ?? "Part of MTC / Club heads"}</span></label>
          <label>{t("committee")}<CommitteeSelect
            committees={committees}
            includeMTC
            value={form.committeeId ?? ""}
            onChange={(v) => {
              const committeeId = Array.isArray(v) ? "" : (v ?? "");
              const selected = committees.find((c) => c.id === committeeId);
              setForm({ ...form, committeeId, isMTC: selected?.key === "mtc" ? true : form.isMTC });
            }}
            mode="single"
            required={form.role !== "ADMIN" && !form.isMTC}
            disabled={form.role === "ADMIN" || (userRole === "LEADER" && userCommitteeId ? true : false)}
          /></label>
        </div>
        <p className="empty-note compact-note">New accounts are created with the fixed initial password <strong>mtc123</strong> and must change it on first sign-in.</p>
        {message && <p className="form-message" role="status">{message}</p>}
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? t("creating") : t("create")}</button></div>
      </form>

      <section className="team-edit-form compact-form">
        <h2>{t("accounts")}</h2>
        <div className="user-admin-list compact-user-list">
          {users.map((user) => (
            <UserAdminRow
              key={user.id}
              user={user}
              committees={committees}
              onSave={(changes) => void saveUser(user.id, changes)}
              onToggleActive={() => void saveUser(user.id, { isActive: !user.isActive })}
              onReset={() => void resetPassword(user.id)}
              onRemove={() => void removeUser(user)}
              userRole={userRole}
              userCommitteeId={userCommitteeId}
            />
          ))}
          {!users.length && <p className="empty-note">{t("empty")}</p>}
        </div>
      </section>

      {showTempDialog && temporaryPassword && (
        <div className="temp-password-dialog-backdrop" role="presentation" onClick={clearTemporaryPassword}>
          <dialog open className="temp-password-dialog" aria-label={t("temporaryPassword")} onClick={(event) => event.stopPropagation()}>
            <h3>{t("temporaryPassword")}</h3>
            <p className="empty-note">{t("temporaryInfo")}</p>
            <p className="temporary-password"><code>{temporaryPassword}</code></p>
            <div className="user-admin-actions">
              <button type="button" className="button button-secondary" onClick={() => void copyTemporaryPassword()}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" className="button button-primary" onClick={clearTemporaryPassword}>Close</button>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
}

function UserAdminRow({ user, committees, onSave, onToggleActive, onReset, onRemove, userRole, userCommitteeId }: { user: AdminUserRow; committees: DbCommittee[]; onSave: (changes: Record<string, unknown>) => void; onToggleActive: () => void; onReset: () => void; onRemove: () => void; userRole?: Role; userCommitteeId?: string | null }) {
  const t = useTranslations("site.adminPages.users");
  const locale = useLocale() as "en" | "ar";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [academicNumber, setAcademicNumber] = useState(user.academicNumber ?? "");
  const [clubId, setClubId] = useState(user.clubId ?? "");
  const [role, setRole] = useState<Role>(user.role);
  const [position, setPosition] = useState<PositionLevel>(user.position ?? "LEADER");
  const [isMTC, setIsMTC] = useState(!!user.isMTC);
  const isLeader = userRole === "LEADER";
  const lockedCommittee = isLeader && userCommitteeId ? userCommitteeId : null;
  const [committeeId, setCommitteeId] = useState(lockedCommittee ?? user.committeeId ?? "");

  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
    setPhone(user.phone ?? "");
    setAcademicNumber(user.academicNumber ?? "");
    setClubId(user.clubId ?? "");
    setRole(user.role);
    setPosition(user.position ?? "LEADER");
    setIsMTC(!!user.isMTC);
    setCommitteeId(lockedCommittee ?? user.committeeId ?? "");
  }, [user, lockedCommittee]);

  function saveAll() {
    const selected = committees.find((c) => c.id === committeeId);
    const nextCommitteeId = role === "ADMIN" ? null : (isLeader ? userCommitteeId ?? null : committeeId || null);
    onSave({
      name: name.trim(),
      email: email.trim(),
      phone: toNull(phone),
      academicNumber: toNull(academicNumber),
      clubId: toNull(clubId),
      role,
      position,
      isMTC: isMTC || selected?.key === "mtc",
      committeeId: nextCommitteeId,
    });
    setEditing(false);
  }

  const committeeLabel = user.isMTC ? "MTC" : (user.committee?.name ?? t("noCommittee"));
  const roleLabel = user.role === "ADMIN" ? t("admin") : user.role === "LEADER" ? t("leader") : t("member");
  const positionLabel = getPositionLabel((user.position ?? "LEADER") as PositionLevel, locale);

  return (
    <article className={`user-admin-row compact-user-row${editing ? " is-editing" : ""}`}>
      <div className="user-admin-summary">
        <div className="user-admin-main">
          <div className="user-admin-identity compact-identity">
            <strong>{user.name}</strong>
            <a href={`mailto:${user.email}`}>{user.email}</a>
          </div>
          <div className="user-admin-badges" aria-label="Member details">
            <span className="compact-badge">{roleLabel}</span>
            <span className="compact-badge">{positionLabel}</span>
            <span className="compact-badge">{committeeLabel}</span>
            <span className={`compact-badge ${user.isActive ? "is-good" : "is-muted"}`}>{user.isActive ? t("active") : t("inactive")}</span>
            {user.mustChangePassword && <span className="compact-badge is-warn">{t("passwordRequired").trim() || "Password change required"}</span>}
          </div>
        </div>
        <div className="user-admin-meta-grid">
          <span><b>Club ID:</b> {user.clubId || "—"}</span>
          <span><b>Academic:</b> {user.academicNumber || "—"}</span>
          <span><b>Phone:</b> {user.phone || "—"}</span>
        </div>
      </div>
      <div className="user-admin-actions compact-actions">
        <button type="button" className="button button-secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : t("edit")}</button>
        <button type="button" className="button button-secondary" onClick={onToggleActive}>{user.isActive ? t("deactivate") : t("reactivate")}</button>
        <button type="button" className="button button-secondary" onClick={onReset}>{t("resetPassword")}</button>
        <button type="button" className="button button-secondary danger-button" onClick={onRemove}>{t("delete")}</button>
      </div>
      {editing && (
        <div className="user-admin-edit-panel">
          <div className="admin-form-grid compact-form-grid user-edit-grid">
            <label><span>{t("name")}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label><span>{t("email")}</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} /></label>
            <label><span>Academic Number</span><input value={academicNumber} onChange={(e) => setAcademicNumber(e.target.value)} maxLength={64} /></label>
            <label><span>MT Club ID</span><input value={clubId} onChange={(e) => setClubId(e.target.value)} maxLength={64} /></label>
            <label><span>{t("role")}</span><select value={role} onChange={(event) => setRole(parseRole(event.target.value))}><option value="ADMIN">{t("admin")}</option><option value="LEADER">{t("leader")}</option><option value="MEMBER">{t("member")}</option></select></label>
            <label><span>{t("position") ?? "Position"}</span><select value={position} onChange={(event) => setPosition(event.target.value as PositionLevel)}><option value="HEAD">{getPositionLabel("HEAD", locale)}</option><option value="VICE">{getPositionLabel("VICE", locale)}</option><option value="LEADER">{getPositionLabel("LEADER", locale)}</option></select></label>
            <label><span>{t("committee")}</span><CommitteeSelect
              committees={committees}
              includeMTC
              value={committeeId}
              onChange={(v) => {
                const nextCommitteeId = Array.isArray(v) ? "" : (v ?? "");
                const selected = committees.find((c) => c.id === nextCommitteeId);
                if (selected?.key === "mtc") setIsMTC(true);
                setCommitteeId(nextCommitteeId);
              }}
              mode="single"
              disabled={role === "ADMIN" || (isLeader && userCommitteeId ? true : false)}
            /></label>
            <label className="visibility-control"><input type="checkbox" checked={isMTC} onChange={(e) => setIsMTC(e.target.checked)} /><span>{t("isMtc") ?? "MTC"}</span></label>
          </div>
          <div className="form-actions compact-actions">
            <button type="button" className="button button-primary" onClick={saveAll}>{t("saveRole")}</button>
            <button type="button" className="button button-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}
