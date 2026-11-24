"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAppToast } from "@/components/app-toast-provider";
import { QrScannerView } from "@/components/qr-scanner";

type GpsState = "idle" | "acquiring" | "ready" | "error";

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
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function stopScanner() {
    setScanning(false);
  }

  async function submitCheckIn(token: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setSuccess(false);
    setGpsState("acquiring");
    setGpsAccuracy(null);
    setMessage(t("locationGetting"));
    await stopScanner();

    if (typeof window !== "undefined" && !window.isSecureContext) {
      const errorMessage = "Location and camera require a secure connection (HTTPS).";
      setMessage(errorMessage);
      setGpsState("error");
      setBusy(false);
      submittingRef.current = false;
      return;
    }
    if (!("geolocation" in navigator)) {
      const errorMessage = t("locationUnavailable");
      setMessage(errorMessage);
      setGpsState("error");
      setBusy(false);
      submittingRef.current = false;
      return;
    }

    try {
      const position = await acquireBestPosition((accuracy) => {
        setGpsAccuracy(accuracy);
        setMessage(`Getting GPS fix… current accuracy ±${Math.round(accuracy)} m`);
      });
      setGpsAccuracy(position.coords.accuracy);
      setGpsState("ready");
      if (position.coords.accuracy > 75) {
        const errorMessage = `GPS accuracy is ±${Math.round(position.coords.accuracy)} m, which is not reliable enough yet. Move to an open area and retry.`;
        setMessage(errorMessage);
        setSuccess(false);
        setBusy(false);
        submittingRef.current = false;
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("checkinFailed"));
      setSuccess(true);
      setMessage(t("confirmed", { status: result.record?.status === "PRESENT" ? t("present") : result.record?.status === "LATE" ? t("late") : String(result.record?.status ?? "").toLowerCase() }));
    } catch (error) {
      setSuccess(false);
      setGpsState("error");
      const geolocationError = error as GeolocationPositionError;
      if (typeof geolocationError?.code === "number" && geolocationError.code > 0) {
        const errorMessage = geolocationError.code === geolocationError.PERMISSION_DENIED
          ? "Location permission was denied. Enable location access for this site and try again."
          : geolocationError.code === geolocationError.POSITION_UNAVAILABLE
            ? "Your device could not determine a reliable location. Move to an open area and try again."
            : "Getting your location took too long. Move to an open area and try again.";
        setMessage(errorMessage);
        showToast(errorMessage);
      } else {
        const errorMessage = error instanceof Error && error.message ? error.message : t("checkinFailed");
        setMessage(errorMessage);
        showToast(errorMessage);
      }
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }

  function startScanner() {
    if (busy) return;
    setMessage("");
    setSuccess(false);
    setScanning(true);
  }

  return (
    <section className="team-edit-form check-in-panel">
      <h2>{t("scan")}</h2>
      <p>{t("scanHint")}</p>
      <div className="attendance-qr-reader" style={{ minHeight: 280 }}>
        {scanning && (
          <QrScannerView
            active={scanning}
            busy={busy}
            onDecode={(value) => { void submitCheckIn(value); }}
            onError={(msg) => { if (mountedRef.current) { setScanning(false); setMessage(msg); setSuccess(false); showToast(msg); } }}
            labels={{
              starting: t("cameraStarting"),
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
      {scanning && !busy && <button className="button button-secondary" type="button" onClick={() => void stopScanner()}>{t("cancel")}</button>}
      {gpsState === "acquiring" && gpsAccuracy != null && <p className="form-message" role="status">Current GPS accuracy: ±{Math.round(gpsAccuracy)} m. Waiting for a better fix…</p>}
      {message && <p className={success ? "form-message" : "form-error"} aria-live="polite">{message}</p>}
      <p className="empty-note">{t("cameraHelp")}</p>
    </section>
  );
}
