"use client";

import React from "react";

import { useEffect, useRef, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";
import { useTranslations } from "next-intl";
import { getCameraErrorMessage, listAvailableCameras, stopMediaTracksInContainer } from "@/lib/attendance-camera";

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
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const activeStartIdRef = useRef(0);
  const opLockRef = useRef(Promise.resolve());
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);

  const isActiveStart = (startId: number) => mountedRef.current && activeStartIdRef.current === startId;

  async function stopScannerInstance(scanner: import("html5-qrcode").Html5Qrcode) {
    try { if (scanner.isScanning) await scanner.stop(); } catch {}
    try { scanner.clear(); } catch {}
    try { stopMediaTracksInContainer("scan-qr-reader"); } catch {}
  }

  function stopScanner() {
    const stopId = ++activeStartIdRef.current;
    const op = opLockRef.current.then(async () => {
      const scanner = scannerRef.current;
      if (scanner) {
        if (scannerRef.current === scanner) scannerRef.current = null;
        await stopScannerInstance(scanner);
      } else {
        try { stopMediaTracksInContainer("scan-qr-reader"); } catch {}
      }
      if (mountedRef.current && activeStartIdRef.current === stopId) setScanning(false);
    }).catch(() => {
      try { stopMediaTracksInContainer("scan-qr-reader"); } catch {}
      if (mountedRef.current && activeStartIdRef.current === stopId) setScanning(false);
    });
    opLockRef.current = op;
    return op;
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
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setMessage(getCameraErrorMessage(new DOMException("Insecure context", "SecurityError")));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera access is not available in this browser.");
      return;
    }

    const startId = ++activeStartIdRef.current;
    const op = opLockRef.current.then(async () => {
      if (!isActiveStart(startId)) return;
      const previous = scannerRef.current;
      scannerRef.current = null;
      if (previous) await stopScannerInstance(previous);
      if (!isActiveStart(startId)) return;

      const { Html5Qrcode } = await import("html5-qrcode");
      if (!isActiveStart(startId)) return;

      const scanner = new Html5Qrcode("scan-qr-reader", { verbose: false });
      scannerRef.current = scanner;
      if (mountedRef.current) setScanning(true);

      const config = {
        fps: 10,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const size = Math.min(viewfinderWidth, viewfinderHeight, 260);
          const edge = Math.max(180, Math.floor(size * 0.8));
          return { width: edge, height: edge };
        },
      };
      const onDecode = (value: string) => {
        if (!isActiveStart(startId) || scannerRef.current !== scanner) return;
        void submitCheckIn(value);
      };
      const onFailure = () => undefined;

      const attempts: Array<string | { facingMode: string } | { facingMode: { exact: string } }> = [];
      if (selectedCameraId) {
        attempts.push(selectedCameraId);
      } else {
        attempts.push({ facingMode: "environment" });
        attempts.push({ facingMode: "user" });
      }

      let started = false;
      let lastError: unknown = null;
      for (const camera of attempts) {
        if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
        try {
          await scanner.start(camera as unknown as string | MediaTrackConstraints, config, onDecode, onFailure);
          if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
          started = true;
          break;
        } catch (err) {
          lastError = err;
          if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
          try { stopMediaTracksInContainer("scan-qr-reader"); } catch {}
          const name = err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name) : "";
          if (selectedCameraId && !/OverconstrainedError|NotFoundError|NotReadableError/i.test(name + " " + (err instanceof Error ? err.message : String(err)))) {
            throw err;
          }
        }
      }

      if (!started) {
        const available = await listAvailableCameras();
        if (mountedRef.current && available.length) {
          setCameras(available);
          if (!selectedCameraId) setSelectedCameraId(available[0].id);
        }
        for (const cam of available) {
          if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
          try {
            await scanner.start(cam.id, config, onDecode, onFailure);
            if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
            if (mountedRef.current) setSelectedCameraId(cam.id);
            started = true;
            break;
          } catch (err) {
            lastError = err;
            if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
            try { stopMediaTracksInContainer("scan-qr-reader"); } catch {}
          }
        }
        if (!started) throw lastError ?? new Error("Camera could not be started");
      }

      if (!isActiveStart(startId)) { await stopScannerInstance(scanner); return; }
      const available = await listAvailableCameras();
      if (mountedRef.current && isActiveStart(startId) && available.length) setCameras(available);
    }).catch(async (error) => {
      if (!isActiveStart(startId)) return;
      const scanner = scannerRef.current;
      if (scanner) {
        if (scannerRef.current === scanner) scannerRef.current = null;
        await stopScannerInstance(scanner);
      }
      if (mountedRef.current && isActiveStart(startId)) {
        setScanning(false);
        const errorMessage = getCameraErrorMessage(error);
        setMessage(errorMessage);
        showToast(errorMessage);
      }
    }).finally(() => {
      if (mountedRef.current && activeStartIdRef.current === startId && !scannerRef.current) {
        setScanning(false);
      }
    });
    opLockRef.current = op.catch(() => undefined);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopScanner();
    };
  }, []);

  return (
    <section className="team-edit-form check-in-panel">
      <h2>{t("scan")}</h2>
      <p>{t("scanHint")}</p>
      {cameras.length > 1 && (
        <label style={{ display: "grid", gap: 4, maxWidth: 420, width: "100%" }}>
          <span>Camera</span>
          <select value={selectedCameraId} onChange={(e) => setSelectedCameraId(e.target.value)} disabled={scanning || busy}>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      <div id="scan-qr-reader" className="attendance-qr-reader" style={{ minHeight: 280 }} />
      {!scanning && <button className="button button-primary" type="button" onClick={() => void startScanner()} disabled={busy}>{busy ? t("checkingIn") : t("cameraScan")}</button>}
      {scanning && !busy && <button className="button button-secondary" type="button" onClick={() => void stopScanner()}>Stop camera</button>}
      {gpsState === "acquiring" && gpsAccuracy != null && <p className="form-message" role="status">Current GPS accuracy: ±{Math.round(gpsAccuracy)} m. Waiting for a better fix…</p>}
      {message && <p className={success ? "form-message" : "form-error"} role="status">{message}</p>}
      <p className="empty-note">{t("cameraHelp")}</p>
    </section>
  );
}
