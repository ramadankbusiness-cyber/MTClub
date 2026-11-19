"use client";

import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAppToast } from "@/components/app-toast-provider";
import { useLocale, useTranslations } from "next-intl";
import { getCommitteeLabel } from "@/data/committees";
import ZoneCapture, { type ZoneCaptureValue } from "@/components/zone-capture";
import { CommitteeSelect } from "@/components/committee-select";

type DbCommittee = { id: string; key: string; name: string; nameAr: string };
type ManagedAttendanceSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  qrMode: "ROTATING" | "STATIC";
  qrEnabled?: boolean;
  recordCount?: number;
  event?: { id: string; isOpen: boolean; qrAttendanceOpen: boolean } | null;
};
export type ManagedEvent = {
  id: string;
  title: string;
  titleAr: string | null;
  description: string;
  descriptionAr: string | null;
  startsAt: string | Date;
  endsAt: string | Date | null;
  location: string | null;
  committeeId: string | null;
  committee: { id: string; name: string } | null;
  published: boolean;
  isOpen?: boolean;
  qrAttendanceOpen?: boolean;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  locationAccuracy: number | null;
  placeName: string | null;
  attendanceSessions?: ManagedAttendanceSession[];
};

const emptyForm = {
  title: "",
  titleAr: "",
  description: "",
  descriptionAr: "",
  startsAt: "",
  endsAt: "",
  location: "",
  committeeId: "",
  published: true,
  isOpen: true,
  qrAttendanceOpen: false,
  centerLat: 30.0444,
  centerLng: 31.2357,
  radiusMeters: 100,
  locationAccuracy: null as number | null,
  placeName: null as string | null,
};
const localInput = (date: string | Date | null) => date ? new Date(date).toISOString().slice(0, 16) : "";

export function AdminEventManager({ initialEvents, committees, isAdmin, userRole, userCommitteeId }: { initialEvents: ManagedEvent[]; committees: DbCommittee[]; isAdmin: boolean; userRole?: "ADMIN" | "LEADER" | "MEMBER"; userCommitteeId?: string | null }) {
  const showToast = useAppToast();
  const t = useTranslations("site.pages.eventManager");
  const locale = useLocale();
  const [events, setEvents] = useState(initialEvents);
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    ...(userRole === "LEADER" && userCommitteeId ? { committeeId: userCommitteeId } : {}),
  }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [formLanguage, setFormLanguage] = useState<"en" | "ar">("en");
  const [zoneValue, setZoneValue] = useState<ZoneCaptureValue>({ latitude: 30.0444, longitude: 31.2357, radiusMeters: 100, accuracy: null, placeName: null, saveAsZone: false, zoneName: null, zoneId: null });

  function editEvent(event: ManagedEvent) {
    setEditingId(event.id);
    setForm({
      title: event.title, titleAr: event.titleAr ?? "", description: event.description, descriptionAr: event.descriptionAr ?? "", startsAt: localInput(event.startsAt),
      endsAt: localInput(event.endsAt), location: event.location ?? "", committeeId: event.committeeId ?? "", published: event.published,
      isOpen: event.isOpen ?? true, qrAttendanceOpen: event.qrAttendanceOpen ?? false,
      centerLat: event.centerLat ?? 30.0444, centerLng: event.centerLng ?? 31.2357, radiusMeters: event.radiusMeters ?? 100, locationAccuracy: event.locationAccuracy ?? null, placeName: event.placeName ?? null,
    });
    setZoneValue({ latitude: event.centerLat ?? 30.0444, longitude: event.centerLng ?? 31.2357, radiusMeters: event.radiusMeters ?? 100, accuracy: event.locationAccuracy ?? null, placeName: event.placeName ?? null, saveAsZone: false, zoneName: null, zoneId: null });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const isOpen = !!form.isOpen;
      const qrAttendanceOpen = isOpen && !!form.qrAttendanceOpen;
      const payload = {
        ...form, isOpen, qrAttendanceOpen, startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        location: form.location || null, committeeId: userRole === "LEADER" ? userCommitteeId : isAdmin ? form.committeeId || null : null,
        centerLat: zoneValue.latitude, centerLng: zoneValue.longitude, radiusMeters: zoneValue.radiusMeters,
        locationAccuracy: zoneValue.accuracy, placeName: zoneValue.placeName || form.placeName || null,
      };
      const response = await fetch(editingId ? `/api/events/${editingId}` : "/api/events", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("saveError"));
      setEvents((current) => editingId
        ? current.map((item) => item.id === editingId ? result.event : item).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        : [...current, result.event].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
      setForm({ ...emptyForm, ...(userRole === "LEADER" && userCommitteeId ? { committeeId: userCommitteeId } : {}) });
      setEditingId(null);
      setFormLanguage("en");
      setZoneValue({ latitude: 30.0444, longitude: 31.2357, radiusMeters: 100, accuracy: null, placeName: null, saveAsZone: false, zoneName: null, zoneId: null });
    } catch {
      const errorMessage = t("saveError");
      setMessage(errorMessage);
      showToast(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: ManagedEvent) {
    if (!window.confirm(t("deleteConfirm", { title: event.title }))) return;
    const response = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) setMessage(result.error ?? t("deleteError"));
    else setEvents((current) => current.filter((entry) => entry.id !== event.id));
  }

  return (
    <div className="admin-events">
      <form className="team-edit-form" onSubmit={save}>
        <h2>{editingId ? t("edit") : t("create")}</h2>
        <div className="language-tabs" role="tablist" aria-label="Event language">
          <button type="button" role="tab" aria-selected={formLanguage === "en"} onClick={() => setFormLanguage("en")}>{t("english")}</button>
          <button type="button" role="tab" aria-selected={formLanguage === "ar"} onClick={() => setFormLanguage("ar")}>{t("arabic")}</button>
        </div>
        <div className="admin-form-grid">
          {formLanguage === "en"
            ? <label>{t("titleEn")}<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required maxLength={120} /></label>
            : <label lang="ar">{t("titleAr")}<input value={form.titleAr} onChange={(event) => setForm({ ...form, titleAr: event.target.value })} dir="rtl" maxLength={120} /></label>}
          <label>{t("starts")}<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></label>
          <label>{t("ends")}<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
          <label>{t("location")}<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} maxLength={250} /></label>
          <ZoneCapture value={zoneValue} onChange={(value) => { setZoneValue(value); setForm((current) => ({ ...current, placeName: value.placeName ?? current.placeName ?? null })); }} />
          <label>{t("committee")}<CommitteeSelect
            committees={committees}
            value={form.committeeId ?? ""}
            onChange={(v) => setForm({ ...form, committeeId: Array.isArray(v) ? "" : (v ?? "") })}
            mode="single"
            disabled={userRole === "LEADER"}
          /></label>
          {formLanguage === "en"
            ? <label className="admin-form-wide">{t("descriptionEn")}<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required maxLength={2000} rows={4} /></label>
            : <label className="admin-form-wide" lang="ar">{t("descriptionAr")}<textarea value={form.descriptionAr} onChange={(event) => setForm({ ...form, descriptionAr: event.target.value })} dir="rtl" maxLength={2000} rows={4} /></label>}
          <label className="visibility-control"><input type="checkbox" checked={form.published} onChange={(event) => setForm({ ...form, published: event.target.checked })} />{t("publish")}</label>
          <label className="visibility-control"><input type="checkbox" checked={!!form.isOpen} onChange={(event) => setForm({ ...form, isOpen: event.target.checked, qrAttendanceOpen: event.target.checked ? form.qrAttendanceOpen : false })} />{t("eventOpen") ?? "Event open"}</label>
          <label className="visibility-control"><input type="checkbox" checked={!!form.qrAttendanceOpen} disabled={!form.isOpen} onChange={(event) => setForm({ ...form, qrAttendanceOpen: event.target.checked })} />{t("qrAttendanceOpen") ?? "QR attendance open"}</label>
        </div>
        {message && <p className="form-error" role="alert">{message}</p>}
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? t("saving") : editingId ? t("save") : t("createButton")}</button>{editingId && <button className="button button-secondary" type="button" onClick={() => { setEditingId(null); setForm({ ...emptyForm, ...(userRole === "LEADER" && userCommitteeId ? { committeeId: userCommitteeId } : {}) }); setZoneValue({ latitude: 30.0444, longitude: 31.2357, radiusMeters: 100, accuracy: null, placeName: null, saveAsZone: false, zoneName: null, zoneId: null }); }}>{t("cancel")}</button>}</div>
      </form>
      <section className="team-edit-form">
        <h2>{t("events")}</h2>
        <div className="user-admin-list">{events.map((item) => <article className="user-admin-row" key={item.id}>
          <div className="user-admin-identity">
            <strong>{locale === "ar" ? item.titleAr || item.title : item.title}</strong>
            <span>{new Date(item.startsAt).toLocaleString(locale)} · {item.location || t("noLocation")}</span>
            <span>{(item.isOpen ?? true) ? (t("eventOpen") ?? "Event open") : (t("eventClosed") ?? "Event closed")} · {(item.qrAttendanceOpen ?? false) ? (t("qrAttendanceOpen") ?? "QR attendance open") : (t("qrAttendanceClosed") ?? "QR attendance closed")}</span>
          </div>
          <div className="user-admin-status"><span>{item.committee ? getCommitteeLabel(item.committee.name, locale as "en" | "ar") : t("allMembers")}</span><span>{item.published ? t("published") : t("draft")}</span></div>
          <div className="user-admin-actions"><button className="button button-secondary" type="button" onClick={() => editEvent(item)}>{t("editButton")}</button>{isAdmin && <button className="button button-secondary danger-button" type="button" onClick={() => void remove(item)}>{t("delete")}</button>}</div>
          {editingId === item.id && <EventAttendancePanel event={item} onUpdated={(updated) => setEvents((current) => current.map((entry) => entry.id === updated.id ? updated : entry))} />}
        </article>)}
          {!events.length && <p className="empty-note">{t("empty")}</p>}
        </div>
      </section>
    </div>
  );
}

function EventAttendancePanel({ event, onUpdated }: { event: ManagedEvent; onUpdated: (event: ManagedEvent) => void }) {
  const t = useTranslations("site.attendance");
  const locale = useLocale();
  const showToast = useAppToast();
  const [busyAction, setBusyAction] = useState<string>("");
  const [qrState, setQrState] = useState<Record<string, { token: string; expiresAt: string; error: string }>>({});
  const [controls, setControls] = useState({ isOpen: !!event.isOpen, qrAttendanceOpen: !!event.qrAttendanceOpen });
  const sessions = event.attendanceSessions ?? [];

  useEffect(() => {
    setControls({ isOpen: !!event.isOpen, qrAttendanceOpen: !!event.qrAttendanceOpen });
  }, [event.id, event.isOpen, event.qrAttendanceOpen]);

  async function saveControls(next: { isOpen: boolean; qrAttendanceOpen: boolean }) {
    setBusyAction("controls");
    try {
      const payload = {
        title: event.title,
        titleAr: event.titleAr ?? null,
        description: event.description,
        descriptionAr: event.descriptionAr ?? null,
        startsAt: new Date(event.startsAt).toISOString(),
        endsAt: event.endsAt ? new Date(event.endsAt).toISOString() : null,
        location: event.location ?? null,
        committeeId: event.committeeId ?? null,
        published: event.published,
        isOpen: next.isOpen,
        qrAttendanceOpen: next.isOpen && next.qrAttendanceOpen,
        centerLat: event.centerLat,
        centerLng: event.centerLng,
        radiusMeters: event.radiusMeters,
        locationAccuracy: event.locationAccuracy ?? null,
        placeName: event.placeName ?? null,
      };
      const response = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update event controls.");
      onUpdated(result.event);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not update event controls.");
    } finally {
      setBusyAction("");
    }
  }

  async function qrAction(sessionId: string, action: "issue" | "regenerate" | "invalidate") {
    setBusyAction(`${action}:${sessionId}`);
    try {
      const response = await fetch(`/api/admin/attendance/sessions/${sessionId}/qr?action=${action}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "QR action failed.");
      setQrState((current) => ({
        ...current,
        [sessionId]: action === "invalidate"
          ? { token: "", expiresAt: "", error: t("qrUnavailable") }
          : { token: result.token, expiresAt: result.expiresAt, error: "" },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "QR action failed.";
      setQrState((current) => ({ ...current, [sessionId]: { token: current[sessionId]?.token ?? "", expiresAt: current[sessionId]?.expiresAt ?? "", error: message } }));
      showToast(message);
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="team-edit-form" style={{ marginTop: "1rem" }}>
      <h3>Attendance & QR</h3>
      <div className="admin-form-grid">
        <label className="visibility-control"><input type="checkbox" checked={controls.isOpen} disabled={busyAction === "controls"} onChange={(e) => { const next = { isOpen: e.target.checked, qrAttendanceOpen: e.target.checked ? controls.qrAttendanceOpen : false }; setControls(next); void saveControls(next); }} />Event open</label>
        <label className="visibility-control"><input type="checkbox" checked={controls.qrAttendanceOpen} disabled={!controls.isOpen || busyAction === "controls"} onChange={(e) => { const next = { isOpen: controls.isOpen, qrAttendanceOpen: e.target.checked }; setControls(next); void saveControls(next); }} />QR attendance open</label>
      </div>
      <p className="empty-note">Independent controls: closing the event closes QR scanning; closing QR scanning immediately prevents new submissions.</p>
      {sessions.length ? sessions.map((session) => {
        const state = qrState[session.id];
        return (
          <article className="attendance-session-card" key={session.id}>
            <div className="attendance-session-copy">
              <p className="eyebrow">{session.qrMode} · {(session.recordCount ?? 0)} check-ins</p>
              <h4>{session.title}</h4>
              <p>{new Date(session.startsAt).toLocaleString(locale)} – {new Date(session.endsAt).toLocaleString(locale)}</p>
              <div className="form-actions">
                <button type="button" className="button button-secondary" disabled={!!busyAction} onClick={() => void qrAction(session.id, "issue")}>{busyAction === `issue:${session.id}` ? "Working…" : "Generate / Show QR"}</button>
                <button type="button" className="button button-secondary" disabled={!!busyAction} onClick={() => void qrAction(session.id, "regenerate")}>Regenerate</button>
                <button type="button" className="button button-secondary danger-button" disabled={!!busyAction} onClick={() => void qrAction(session.id, "invalidate")}>Invalidate</button>
              </div>
              {state?.error && <p className="form-error" role="alert">{state.error}</p>}
              {state?.expiresAt && <small>Expires: {new Date(state.expiresAt).toLocaleString(locale)}</small>}
            </div>
            <div className="attendance-session-tools">
              {state?.token ? <QRCodeSVG value={state.token} size={160} level="M" includeMargin aria-label={`QR: ${session.title}`} /> : <div className="qr-placeholder">QR not generated</div>}
            </div>
          </article>
        );
      }) : <p className="empty-note">Save the event to create attendance session(s). Multi-day events get one session per day.</p>}
    </div>
  );
}
