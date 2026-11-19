"use client";

import { useEffect, useRef, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";
import { useTranslations } from "next-intl";

type GpsState = "idle" | "acquiring" | "ready" | "error";

function getCameraErrorMessage(error: unknown, fallback: string) {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Camera permission was denied. Allow camera access in your browser settings and try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is in use by another app or could not be started. Close other camera apps and try again.";
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") return "The rear camera is unavailable. Please try again.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
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

export function ScanAttendanceClient() {
  const showToast = useAppToast();
  const t = useTranslations("site.attendance");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const submittingRef = useRef(false);

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
      } catch {}
      try { scanner.clear(); } catch {}
      scannerRef.current = null;
    }
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

  async function startScanner() {
    if (scanning || busy) return;
    setMessage("");
    setSuccess(false);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setMessage("Camera access requires a secure connection (HTTPS).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera access is not available in this browser.");
      return;
    }
    try {
      await stopScanner();
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("scan-qr-reader", { verbose: false });
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: { ideal: "environment" } },
        { fps: 10, qrbox: (viewfinderWidth, viewfinderHeight) => {
          const size = Math.min(viewfinderWidth, viewfinderHeight, 260);
          const edge = Math.max(180, Math.floor(size * 0.8));
          return { width: edge, height: edge };
        } },
        (value) => {
          void submitCheckIn(value);
        },
        () => undefined,
      );
    } catch (error) {
      await stopScanner();
      const errorMessage = getCameraErrorMessage(error, t("cameraFailed"));
      setMessage(errorMessage);
      showToast(errorMessage);
    }
  }

  useEffect(() => () => { void stopScanner(); }, []);

  return (
    <section className="team-edit-form check-in-panel">
      <h2>{t("scan")}</h2>
      <p>{t("scanHint")}</p>
      <div id="scan-qr-reader" className="attendance-qr-reader" style={{ minHeight: 280 }} />
      {!scanning && <button className="button button-primary" type="button" onClick={() => void startScanner()} disabled={busy}>{busy ? t("checkingIn") : t("cameraScan")}</button>}
      {gpsState === "acquiring" && gpsAccuracy != null && <p className="form-message" role="status">Current GPS accuracy: ±{Math.round(gpsAccuracy)} m. Waiting for a better fix…</p>}
      {message && <p className={success ? "form-message" : "form-error"} role="status">{message}</p>}
      <p className="empty-note">{t("cameraHelp")}</p>
    </section>
  );
}
