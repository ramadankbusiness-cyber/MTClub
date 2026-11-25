"use client";

import React from "react";

import { FormEvent, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAppToast } from "@/components/app-toast-provider";
import { useLocale, useTranslations } from "next-intl";
import { getCommitteeLabel } from "@/data/committees";
import ZoneCapture, { type ZoneCaptureValue } from "@/components/zone-capture";
import { CommitteeSelect } from "@/components/committee-select";
import { QrScannerView } from "@/components/qr-scanner";

type Role = "ADMIN" | "LEADER" | "MEMBER";
type DbCommittee = { id: string; key: string; name: string; nameAr: string };
type AttendanceMember = { id: string; name: string; committeeId: string | null; committee: { name: string } | null };
export type AttendanceSessionView = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  lateAfterMinutes: number;
  qrMode: "ROTATING" | "STATIC";
  committee: { id: string; name: string } | null;
  zone: { id: string; name: string; latitude: number; longitude: number; radiusMeters: number } | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
  locationAccuracy: number | null;
  placeName: string | null;
  recordCount: number;
};
type AttendanceRecordView = { id: string; status: string; checkedInAt: string | null; session: { title: string } };

export function AttendanceTools({
  role,
  initialSessions,
  committees,
  members,
  records,
  attendanceRate,
  userRole,
  userCommitteeId,
}: {
  role: Role,
  initialSessions: AttendanceSessionView[],
  committees: DbCommittee[],
  members: AttendanceMember[],
  records: AttendanceRecordView[],
  attendanceRate: number,
  userRole?: Role,
  userCommitteeId?: string | null,
}) {
  if (role === "MEMBER") return <MemberAttendance records={records} attendanceRate={attendanceRate} />;
  if (role === "ADMIN") {
    return (
      <>
        <MemberAttendance records={records} attendanceRate={attendanceRate} />
        <SessionManager sessions={initialSessions} committees={committees} members={members} isAdmin={true} userRole={userRole} userCommitteeId={userCommitteeId} />
      </>
    );
  }
  return <SessionManager sessions={initialSessions} committees={committees} members={members} isAdmin={false} userRole={userRole} userCommitteeId={userCommitteeId} />;
}

function SessionManager({ sessions: initialSessions, committees, members, isAdmin, userRole, userCommitteeId }: { sessions: AttendanceSessionView[]; committees: DbCommittee[]; members: AttendanceMember[]; isAdmin: boolean; userRole?: Role; userCommitteeId?: string | null }) {
  const t = useTranslations("site.attendance");
  const locale = useLocale();
  const showToast = useAppToast();
  const [sessions, setSessions] = useState(initialSessions);
  const [title, setTitle] = useState("");
  const [committeeId, setCommitteeId] = useState(userRole === "LEADER" && userCommitteeId ? userCommitteeId : "");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [lateAfterMinutes, setLateAfterMinutes] = useState(10);
  const [qrMode, setQrMode] = useState<"ROTATING" | "STATIC">("ROTATING");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [zoneValue, setZoneValue] = useState<ZoneCaptureValue>({ latitude: 30.0444, longitude: 31.2357, radiusMeters: 100, accuracy: null, placeName: null, saveAsZone: false, zoneName: null, zoneId: null });

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/attendance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, committeeId: userRole === "LEADER" ? userCommitteeId : committeeId || null,
          startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
          lateAfterMinutes, qrMode,
          centerLat: zoneValue.latitude, centerLng: zoneValue.longitude, radiusMeters: zoneValue.radiusMeters,
          locationAccuracy: zoneValue.accuracy, placeName: zoneValue.placeName, zoneId: zoneValue.zoneId || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("createError"));
      const added: AttendanceSessionView = {
        ...result.session,
        startsAt: result.session.startsAt,
        endsAt: result.session.endsAt,
        centerLat: result.session.centerLat,
        centerLng: result.session.centerLng,
        radiusMeters: result.session.radiusMeters,
        locationAccuracy: result.session.locationAccuracy,
        placeName: result.session.placeName,
        zone: result.session.zone,
        recordCount: 0,
      };
      setSessions((current) => [added, ...current]);
      setTitle("");
      setStartsAt("");
      setEndsAt("");
      setZoneValue({ latitude: 30.0444, longitude: 31.2357, radiusMeters: 100, accuracy: null, placeName: null, saveAsZone: false, zoneName: null, zoneId: null });
      setMessage(t("created"));
    } catch {
      const errorMessage = t("createError");
      setMessage(errorMessage);
      showToast(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession(session: AttendanceSessionView) {
    if (!isAdmin) return;
    const confirmed = window.confirm(t("confirmDeleteSession", { title: session.title }));
    if (!confirmed) return;
    setDeletingSessionId(session.id);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/attendance/sessions/${session.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? t("deleteSessionError"));
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setMessage(t("sessionDeleted"));
    } catch (error) {
      const errorMessage = error instanceof Error && error.message ? error.message : t("deleteSessionError");
      setMessage(errorMessage);
      showToast(errorMessage);
    } finally {
      setDeletingSessionId(null);
    }
  }

  return (
    <div className="attendance-layout">
      {isAdmin && <form className="team-edit-form attendance-create-form" onSubmit={createSession}>
        <h2>{t("create")}</h2>
        <div className="admin-form-grid attendance-form-grid">
          <label className="admin-form-wide">{t("title")}<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={120} required /></label>
          <label>{t("committee")}<CommitteeSelect
            committees={committees}
            includeMTC={isAdmin}
            value={committeeId}
            onChange={(v) => setCommitteeId(Array.isArray(v) ? "" : (v ?? ""))}
            mode="single"
            showAll={true}
            allLabel={t("allCommittees")}
            disabled={userRole === "LEADER"}
          /></label>
          <label>{t("qrMode")}<select value={qrMode} onChange={(event) => setQrMode(event.target.value === "STATIC" ? "STATIC" : "ROTATING")}><option value="ROTATING">{t("rotating")}</option><option value="STATIC">{t("static")}</option></select></label>
          <ZoneCapture value={zoneValue} onChange={(value) => setZoneValue(value)} />
          <label>{t("starts")}<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
          <label>{t("ends")}<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label>
          <label>{t("lateAfter")}<input type="number" min={0} max={240} value={lateAfterMinutes} onChange={(event) => setLateAfterMinutes(Number(event.target.value))} required /></label>
        </div>
        {qrMode === "STATIC" && <p className="warning-note">{t("staticWarning")}</p>}
        {message && <p className="form-message" role="status">{message}</p>}
        <div className="form-actions"><button className="button button-primary attendance-submit" disabled={busy}>{busy ? t("creating") : t("createButton")}</button></div>
      </form>}
      <section className="team-edit-form attendance-session-list">
        <h2>{isAdmin ? t("sessions") : t("committeeSessions")}</h2>
        {sessions.map((session) => <article className="attendance-session-card" key={session.id}>
          <div className="attendance-session-copy">
            <p className="eyebrow attendance-session-meta">{session.committee ? getCommitteeLabel(session.committee.name, locale as "en" | "ar") : t("allCommittees")} · {session.zone?.name ?? session.placeName ?? t("noZone")}</p>
            <h3 className="attendance-session-title">{session.title}</h3>
            <p className="attendance-session-dates">{new Date(session.startsAt).toLocaleString(locale)} – {new Date(session.endsAt).toLocaleString(locale)}</p>
            <div className="attendance-session-badges">
              <span className="compact-badge">{t("checkIns", { count: session.recordCount })}</span>
              <span className="compact-badge">{t("lateAfterShort", { minutes: session.lateAfterMinutes })}</span>
              <span className="compact-badge">{session.qrMode === "STATIC" ? t("static") : t("rotating")}</span>
            </div>
            <div className="attendance-session-actions">
              <LiveCheckIns sessionId={session.id} isAdmin={isAdmin} onRecordDeleted={() => setSessions((current) => current.map((s) => s.id === session.id ? { ...s, recordCount: Math.max(0, s.recordCount - 1) } : s))} />
              <button type="button" onClick={() => window.location.assign("/api/admin/attendance/export")}>{t("exportCsv")}</button>
              {isAdmin && <button type="button" className="danger-button" disabled={deletingSessionId === session.id} onClick={() => void deleteSession(session)}>{deletingSessionId === session.id ? t("deleting") : t("deleteSession")}</button>}
            </div>
          </div>
          <div className="attendance-session-tools">
            {isAdmin && <AttendanceQr session={session} />}
            {isAdmin && <ManualAttendance session={session} members={members} />}
          </div>
        </article>)}
        {!sessions.length && <p className="empty-note">{t("emptySessions")}</p>}
      </section>
    </div>
  );
}

function ManualAttendance({ session, members }: { session: AttendanceSessionView; members: AttendanceMember[] }) {
  const t = useTranslations("site.attendance");
  const locale = useLocale() as "en" | "ar";
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("ABSENT");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const eligibleMembers = members.filter((member) => !session.committee || member.committeeId === session.committee.id);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/admin/attendance/sessions/${session.id}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, status, reason }),
    });
    const result = await response.json();
    setMessage(response.ok ? t("updated") : result.error ?? t("updateError"));
  }

  return <div className="manual-attendance">
    <button type="button" className="button button-secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? t("manualHide") : t("manualShow")}</button>
    {open && <form onSubmit={submit}>
      <label>{t("member")}<select value={userId} onChange={(event) => setUserId(event.target.value)} required><option value="">{t("chooseMember")}</option>{eligibleMembers.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.committee ? getCommitteeLabel(member.committee.name, locale) : t("noCommittee")}</option>)}</select></label>
      <label>{t("status")}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ABSENT">{t("absent")}</option><option value="PRESENT">{t("present")}</option><option value="LATE">{t("late")}</option><option value="EXCUSED">{t("excused")}</option></select></label>
      <label>{t("reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={2} /></label>
      {message && <p className="form-message" role="status">{message}</p>}
      <button type="submit" className="button button-primary">{t("saveAttendance")}</button>
    </form>}
  </div>;
}

function LiveCheckIns({ sessionId, isAdmin, onRecordDeleted }: { sessionId: string; isAdmin: boolean; onRecordDeleted?: () => void }) {
  const t = useTranslations("site.attendance");
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<{ id: string; userId: string; status: string; checkedInAt: string | null; user: { id?: string; name: string; committee: { name: string } | null } }[]>([]);
  const [attempts, setAttempts] = useState<{ id: string; reason: string; status: string; user: { name: string; committee: { name: string } | null } | null; createdAt: string }[]>([]);
  const [error, setError] = useState("");
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = async () => {
      const response = await fetch(`/api/admin/attendance/sessions/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json();
        if (active) setError(result.error ?? t("loadCheckins"));
        return;
      }
      const result = await response.json();
      if (!active) return;
      setRecords(result.records);
      setAttempts(result.attempts);
      setError("");
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [open, sessionId]);

  async function deleteRecord(record: { id: string; userId: string; user: { name: string } }) {
    if (!isAdmin) return;
    const confirmed = window.confirm(t("confirmDeleteRecord", { name: record.user.name }));
    if (!confirmed) return;
    setDeletingRecordId(record.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/attendance/sessions/${sessionId}/records?userId=${encodeURIComponent(record.userId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? t("deleteRecordError"));
      setRecords((current) => current.filter((item) => item.id !== record.id));
      onRecordDeleted?.();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("deleteRecordError"));
    } finally {
      setDeletingRecordId(null);
    }
  }

  return (
    <div className="live-checkins">
      <button type="button" className="button button-secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? t("hideLive") : t("live")}</button>
      {open && <div className="live-checkins-details">
        {error && <p className="form-error" role="alert">{error}</p>}
        <strong>{t("refreshing", { count: records.length })}</strong>
        <ul>{records.map((record) => <li key={record.id}>
          <span>{record.user.name}</span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span>{record.status.toLowerCase()}</span>
            {isAdmin && <button type="button" className="link-danger" disabled={deletingRecordId === record.id} onClick={() => void deleteRecord(record)}>{deletingRecordId === record.id ? t("deleting") : t("delete")}</button>}
          </span>
        </li>)}</ul>
        {attempts.length > 0 && <details><summary>{t("recentAttempts", { count: attempts.length })}</summary><ul>{attempts.map((attempt) => <li key={attempt.id}><span>{attempt.user?.name ?? t("unknownMember")} · {attempt.status.toLowerCase()}</span><span>{attempt.reason}</span></li>)}</ul></details>}
      </div>}
    </div>
  );
}

function AttendanceQr({ session }: { session: AttendanceSessionView }) {
  const t = useTranslations("site.attendance");
  const locale = useLocale();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/attendance/sessions/${session.id}/qr`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("qrNotReady"));
      setToken(result.token);
      setExpiresAt(result.expiresAt);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("qrLoadError"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (session.qrMode === "ROTATING") void refresh(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [session.id, session.qrMode]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch {
      setError(t("fullscreenUnavailable"));
    }
  }

  return (
    <div className="attendance-qr-panel" ref={panelRef}>
      {token ? <QRCodeSVG value={token} size={180} level="M" includeMargin aria-label={`${t("scan")}: ${session.title}`} /> : <div className="qr-placeholder">{busy ? t("qrLoading") : t("qrUnavailable")}</div>}
      {session.qrMode === "STATIC" && <strong className="warning-note">{t("staticQrWarning")}</strong>}
      {expiresAt && session.qrMode === "ROTATING" && <small>{t("refreshAuto", { time: new Date(expiresAt).toLocaleTimeString(locale) })}</small>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => void refresh()}>{t("refresh")}</button><button type="button" className="button button-secondary" onClick={() => void toggleFullscreen()}>{t("fullScreen")}</button></div>
    </div>
  );
}

function localizeAttendanceError(message: string, t: (key: string) => string) {
  const m = message.toLowerCase();
  if (m.includes("already checked in")) return t("alreadyCheckedIn");
  if (m.includes("invalid or has expired")) return t("invalidQr");
  if (m.includes("session is not open") || m.includes("not open for attendance")) return t("sessionNotOpen");
  if (m.includes("not eligible to check in")) return t("notEligible");
  if (m.includes("away from the allowed area") || m.includes("outside")) return t("outsideArea");
  return message;
}

async function acquireAttendanceBestPosition(onUpdate: (accuracy: number) => void): Promise<GeolocationPosition> {
  if (!("geolocation" in navigator)) throw Object.assign(new Error("Location unavailable"), { code: 0 });
  return await new Promise<GeolocationPosition>((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let settled = false;
    const desiredAccuracy = 50;
    const maxWaitMs = 25_000;
    const finish = (error?: GeolocationPositionError | Error) => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      if (best) resolve(best);
      else if (error && "code" in error) reject(error);
      else reject(error ?? new Error("Could not get a reliable location."));
    };
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        onUpdate(position.coords.accuracy);
        if (position.coords.accuracy <= desiredAccuracy) finish();
      },
      (error) => {
        if (best) finish();
        else finish(error);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
    const timer = window.setTimeout(() => {
      if (best) finish();
      else finish(new Error("Timed out while trying to get a reliable GPS fix."));
    }, maxWaitMs);
  });
}

function MemberAttendance({ records, attendanceRate }: { records: AttendanceRecordView[]; attendanceRate: number }) {
  const showToast = useAppToast();
  const t = useTranslations("site.attendance");
  const locale = useLocale();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scannerResetKey, setScannerResetKey] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  function clearResetTimer() {
    if (resetTimerRef.current != null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }

  function resetForNextScan(delayMs = 2600) {
    clearResetTimer();
    resetTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setScanSuccess(false);
      setBusy(false);
      setMessage("");
      setSuccess(false);
      setGpsAccuracy(null);
      submittingRef.current = false;
    }, delayMs);
  }

  async function stopScanner() {
    clearResetTimer();
    setScanning(false);
    setBusy(false);
    setScanSuccess(false);
    setGpsAccuracy(null);
    submittingRef.current = false;
  }

  async function submitCheckIn(token: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    clearResetTimer();
    setBusy(true);
    setScanSuccess(false);
    setSuccess(false);
    setGpsAccuracy(null);
    setMessage(t("locationGetting"));
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setMessage(t("cameraInsecure"));
      setBusy(false);
      submittingRef.current = false;
      setScannerResetKey((k) => k + 1);
      return;
    }
    if (!("geolocation" in navigator)) {
      setMessage(t("locationUnavailable"));
      setBusy(false);
      submittingRef.current = false;
      setScannerResetKey((k) => k + 1);
      return;
    }
    try {
      const position = await acquireAttendanceBestPosition((accuracy) => {
        if (!mountedRef.current) return;
        setGpsAccuracy(accuracy);
        setMessage(`±${Math.round(accuracy)} m`);
      });
      if (!mountedRef.current) return;
      setGpsAccuracy(position.coords.accuracy);
      if (position.coords.accuracy > 75) {
        setMessage(`±${Math.round(position.coords.accuracy)} m`);
        setSuccess(false);
        setBusy(false);
        submittingRef.current = false;
        setScannerResetKey((k) => k + 1);
        showToast(t("locationFailed"));
        return;
      }
      let deviceId = localStorage.getItem("mt-attendance-device");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem("mt-attendance-device", deviceId);
      }
      const response = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, timestamp: position.timestamp, deviceId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? t("checkinFailed"));
      if (!mountedRef.current) return;
      setSuccess(true);
      setScanSuccess(true);
      const statusLabel = result.record?.status === "PRESENT" ? t("present") : result.record?.status === "LATE" ? t("late") : String(result.record?.status ?? "").toLowerCase();
      setMessage(t("confirmed", { status: statusLabel }));
      setBusy(false);
      submittingRef.current = false;
      resetForNextScan(2600);
    } catch (error) {
      if (!mountedRef.current) return;
      setSuccess(false);
      setScanSuccess(false);
      const geolocationError = error as GeolocationPositionError;
      if (typeof geolocationError?.code === "number" && geolocationError.code > 0) {
        const errorMessage = geolocationError.code === geolocationError.PERMISSION_DENIED
          ? t("locationDenied")
          : geolocationError.code === geolocationError.POSITION_UNAVAILABLE
            ? t("locationFailed")
            : t("locationFailed");
        setMessage(errorMessage);
        showToast(errorMessage);
      } else {
        const errorMessage = error instanceof Error && error.message ? localizeAttendanceError(error.message, t) : t("checkinFailed");
        setMessage(errorMessage);
        showToast(errorMessage);
      }
      setBusy(false);
      submittingRef.current = false;
      setScannerResetKey((k) => k + 1);
    }
  }

  function startScanner() {
    if (busy) return;
    clearResetTimer();
    setMessage("");
    setSuccess(false);
    setScanSuccess(false);
    setGpsAccuracy(null);
    setScanning(true);
  }

  return (
    <div className="member-attendance">
      <section className="team-edit-form check-in-panel">
        <div className="attendance-rate"><strong>{attendanceRate}%</strong><span>{t("yourAttendance")}</span></div>
        <h2>{t("scan")}</h2>
        <p>{t("scanHint")}</p>
        <div className="attendance-qr-reader" style={{ minHeight: 320 }}>
          {scanning && (
            <QrScannerView
              key={scannerResetKey}
              active={scanning}
              busy={busy}
              success={scanSuccess}
              onDecode={(value) => { void submitCheckIn(value); }}
              onError={(msg) => { if (mountedRef.current) { setMessage(msg); setSuccess(false); setScanSuccess(false); showToast(msg); } }}
              labels={{
                starting: t("cameraStarting"),
                searching: t("cameraSearching"),
                holdStill: t("cameraHoldStill"),
                verifying: t("cameraVerifying"),
                success: t("attendanceRecorded"),
                noRearCamera: t("noRearCamera"),
                insecure: t("cameraInsecure"),
                unsupported: t("cameraUnsupported"),
                permissionDenied: t("cameraPermissionDenied"),
                notReadable: t("cameraNotReadable"),
                genericError: t("cameraGenericError"),
              }}
            />
          )}
        </div>
        {!scanning && <button className="button button-primary" type="button" onClick={startScanner} disabled={busy}>{busy ? t("checkingIn") : t("cameraScan")}</button>}
        {scanning && !busy && !scanSuccess && <button className="button button-secondary" type="button" onClick={() => void stopScanner()}>{t("cancel")}</button>}
        {gpsAccuracy != null && busy && <p className="form-message" role="status">±{Math.round(gpsAccuracy)} m</p>}
        {message && <p className={success ? "form-message" : "form-error"} role="status">{message}</p>}
        <p className="empty-note">{t("cameraHelp")}</p>
      </section>
      <section className="team-edit-form">
        <h2>{t("history")}</h2>
        <div className="user-admin-list">{records.map((record) => <article className="user-admin-row" key={record.id}>
          <div className="user-admin-identity"><strong>{record.session.title}</strong><span>{record.checkedInAt ? new Date(record.checkedInAt).toLocaleString(locale) : t("noCheckinTime")}</span></div>
          <div className="user-admin-status"><span>{record.status.toLowerCase()}</span></div>
        </article>)}
          {!records.length && <p className="empty-note">{t("historyEmpty")}</p>}
        </div>
      </section>
    </div>
  );
}
