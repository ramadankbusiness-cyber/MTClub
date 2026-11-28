"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { emitPointsUpdated } from "./points-indicator";
import { useAppToast } from "@/components/app-toast-provider";
import { QrScannerView } from "@/components/qr-scanner";

type GpsState = "idle" | "acquiring" | "ready" | "error";

function localizeAttendanceError(message: string, t: (key: string) => string) {
  const m = message.toLowerCase();
  if (m.includes("already checked in")) return t("alreadyCheckedIn");
  if (m.includes("invalid or has expired")) return t("invalidQr");
  if (m.includes("session is not open") || m.includes("not open for attendance")) return t("sessionNotOpen");
  if (m.includes("not eligible to check in")) return t("notEligible");
  if (m.includes("away from the allowed area") || m.includes("outside")) return t("outsideArea");
  return message;
}

async function acquireBestPosition(onUpdate: (accuracy: number) => void): Promise<GeolocationPosition> {
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
      (error) => finish(error),
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    const timer = window.setTimeout(() => finish(), maxWaitMs);
  });
}

export function ScanAttendanceClient() {
  const t = useTranslations("site.attendance");
  const showToast = useAppToast();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scannerResetKey, setScannerResetKey] = useState(0);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
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
      setGpsState("idle");
      setGpsAccuracy(null);
      submittingRef.current = false;
    }, delayMs);
  }

  async function stopScanner() {
    clearResetTimer();
    setScanning(false);
    setBusy(false);
    setScanSuccess(false);
    setGpsState("idle");
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
    setGpsState("acquiring");
    setGpsAccuracy(null);
    setMessage(t("locationGetting"));

    if (typeof window !== "undefined" && !window.isSecureContext) {
      const errorMessage = t("cameraInsecure");
      setMessage(errorMessage);
      setGpsState("error");
      setBusy(false);
      submittingRef.current = false;
      setScannerResetKey((k) => k + 1);
      return;
    }
    if (!("geolocation" in navigator)) {
      const errorMessage = t("locationUnavailable");
      setMessage(errorMessage);
      setGpsState("error");
      setBusy(false);
      submittingRef.current = false;
      setScannerResetKey((k) => k + 1);
      return;
    }

    try {
      const position = await acquireBestPosition((accuracy) => {
        if (!mountedRef.current) return;
        setGpsAccuracy(accuracy);
        setMessage(`±${Math.round(accuracy)} m`);
      });
      if (!mountedRef.current) return;
      setGpsAccuracy(position.coords.accuracy);
      setGpsState("ready");
      if (position.coords.accuracy > 75) {
        const errorMessage = `±${Math.round(position.coords.accuracy)} m`;
        setMessage(errorMessage);
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
          token,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
          deviceId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? t("checkinFailed"));
      if (!mountedRef.current) return;
      setSuccess(true);
      setScanSuccess(true);
      emitPointsUpdated();
      const statusLabel = result.record?.status === "PRESENT" ? t("present") : result.record?.status === "LATE" ? t("late") : String(result.record?.status ?? "").toLowerCase();
      setMessage(t("confirmed", { status: statusLabel }));
      setBusy(false);
      submittingRef.current = false;
      resetForNextScan(2600);
    } catch (error) {
      if (!mountedRef.current) return;
      setSuccess(false);
      setScanSuccess(false);
      setGpsState("error");
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
    setGpsState("idle");
    setGpsAccuracy(null);
    setScanning(true);
  }

  return (
    <section className="team-edit-form check-in-panel">
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
              fullscreen: t("fullscreen"),
              exitFullscreen: t("exitFullscreen"),
            }}
          />
        )}
      </div>
      {!scanning && <button className="button button-primary" type="button" onClick={startScanner} disabled={busy}>{busy ? t("checkingIn") : t("cameraScan")}</button>}
      {scanning && !busy && !scanSuccess && <button className="button button-secondary" type="button" onClick={() => void stopScanner()}>{t("cancel")}</button>}
      {gpsState === "acquiring" && gpsAccuracy != null && <p className="form-message" role="status">±{Math.round(gpsAccuracy)} m</p>}
      {message && <p className={success ? "form-message" : "form-error"} aria-live="polite">{message}</p>}
      <p className="empty-note">{t("cameraHelp")}</p>
    </section>
  );
}
