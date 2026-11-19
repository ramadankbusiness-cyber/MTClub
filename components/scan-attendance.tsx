"use client";

import { useEffect, useRef, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";
import { useTranslations } from "next-intl";

export function ScanAttendanceClient() {
  const showToast = useAppToast();
  const t = useTranslations("site.attendance");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
      } catch {}
      try { scanner.clear(); } catch {}
      scannerRef.current = null;
    }
  }

  async function submitCheckIn(token: string) {
    setBusy(true);
    setScanning(false);
    setMessage(t("locationGetting"));
    await stopScanner();
    if (!("geolocation" in navigator)) {
      const errorMessage = t("locationUnavailable");
      setMessage(errorMessage);
      setSuccess(false);
      setBusy(false);
      return;
    }
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
      });
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
      const geolocationError = error as GeolocationPositionError;
      if (typeof geolocationError?.code === "number") {
        const errorMessage = geolocationError.code === geolocationError.PERMISSION_DENIED
          ? t("locationDenied")
          : t("locationFailed");
        setMessage(errorMessage);
        showToast(errorMessage);
      } else {
        const errorMessage = error instanceof Error && error.message ? error.message : t("checkinFailed");
        setMessage(errorMessage);
        showToast(errorMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    setMessage("");
    setSuccess(false);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await stopScanner();
      const scanner = new Html5Qrcode("scan-qr-reader");
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, (value) => {
        void submitCheckIn(value);
      }, () => undefined);
    } catch {
      setScanning(false);
      await stopScanner();
      const errorMessage = t("cameraFailed");
      setMessage(errorMessage);
      showToast(errorMessage);
    }
  }

  useEffect(() => () => { void stopScanner(); }, []);

  return (
    <section className="team-edit-form check-in-panel">
      <h2>{t("scan")}</h2>
      <p>{t("scanHint")}</p>
      <div id="scan-qr-reader" className="attendance-qr-reader" />
      {!scanning && <button className="button button-primary" type="button" onClick={() => void startScanner()} disabled={busy}>{busy ? t("checkingIn") : t("cameraScan")}</button>}
      {message && <p className={success ? "form-message" : "form-error"} role="status">{message}</p>}
      <p className="empty-note">{t("cameraHelp")}</p>
    </section>
  );
}
