"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
export type QrScannerStatus = "idle" | "starting" | "scanning" | "detected" | "success" | "error";

type Props = {
  onDecode: (value: string) => void;
  onError?: (message: string) => void;
  active: boolean;
  busy?: boolean;
  className?: string;
  labels?: {
    starting?: string;
    noRearCamera?: string;
    insecure?: string;
    unsupported?: string;
    permissionDenied?: string;
    notReadable?: string;
    genericError?: string;
  };
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string; cornerPoints?: Point[]; boundingBox?: DOMRectReadOnly; format?: string }>>;
};

type ZXingControls = { stop: () => void };

function isRearCameraLabel(label: string) {
  const l = label.toLowerCase();
  return /back|rear|environment|world|trasera|arri(?:è|e)re|r(?:ü|u)ck|posteriore|traseira|задн|后置|背面|후면/.test(l);
}
function isFrontCameraLabel(label: string) {
  const l = label.toLowerCase();
  return /front|user|face|facetime|selfie|frontal|avant|vorder|anteriore|передн|前置|前面|전면/.test(l);
}

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch {}
  }
}

function stopVideoElement(video: HTMLVideoElement | null) {
  if (!video) return;
  const src = video.srcObject;
  if (src && typeof (src as MediaStream).getTracks === "function") {
    for (const track of (src as MediaStream).getTracks()) {
      try { track.stop(); } catch {}
    }
  }
  try { video.pause(); } catch {}
  try { video.srcObject = null; } catch {}
  try { video.removeAttribute("src"); video.load(); } catch {}
}

async function waitForVideoReady(video: HTMLVideoElement, isCancelled: () => boolean) {
  if (video.readyState >= 2 && video.videoWidth > 0) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onError);
      window.clearInterval(timer);
    };
    const onReady = () => { if (video.videoWidth > 0 || video.readyState >= 2) { cleanup(); resolve(); } };
    const onError = () => { cleanup(); reject(new Error("Video failed to load.")); };
    const timer = window.setInterval(() => {
      if (isCancelled()) { cleanup(); reject(new DOMException("Aborted", "AbortError")); return; }
      if (video.readyState >= 2 && video.videoWidth > 0) { cleanup(); resolve(); }
    }, 100);
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("error", onError);
  });
}

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  if (!BD) return null;
  try { return new BD({ formats: ["qr_code"] }); } catch {
    try { return new BD(); } catch { return null; }
  }
}

function normalizeCorners(corners: Point[] | undefined, bbox?: DOMRectReadOnly | null): Point[] | null {
  if (corners && corners.length >= 4) return corners.slice(0, 4).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  if (bbox && bbox.width > 0 && bbox.height > 0) {
    return [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
      { x: bbox.x, y: bbox.y + bbox.height },
    ];
  }
  return null;
}

// Estimate 4th corner from ZXing QR result points (3 finder patterns: BL, TL, TR)
function cornersFromResultPoints(points: Array<{ getX?: () => number; getY?: () => number; x?: number; y?: number }> | undefined): Point[] | null {
  if (!points || points.length < 3) return null;
  const p = points.map((pt) => ({ x: Number(pt.getX?.() ?? pt.x ?? 0), y: Number(pt.getY?.() ?? pt.y ?? 0) }));
  if (p.length === 4) return p;
  if (p.length === 3) {
    // ZXing QR: order is typically bottomLeft, topLeft, topRight
    const [bl, tl, tr] = p;
    const br = { x: tr.x + (bl.x - tl.x), y: tr.y + (bl.y - tl.y) };
    return [tl, tr, br, bl];
  }
  return null;
}

function mapPointToOverlay(p: Point, video: HTMLVideoElement, overlayW: number, overlayH: number): Point {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(overlayW / vw, overlayH / vh);
  const drawnW = vw * scale;
  const drawnH = vh * scale;
  const offsetX = (overlayW - drawnW) / 2;
  const offsetY = (overlayH - drawnH) / 2;
  return { x: p.x * scale + offsetX, y: p.y * scale + offsetY };
}

async function pickRearCameraDeviceId(): Promise<{ deviceId: string | null; hasVideoInput: boolean; hasRear: boolean }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { deviceId: null, hasVideoInput: false, hasRear: false };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === "videoinput");
    if (videoInputs.length === 0) return { deviceId: null, hasVideoInput: false, hasRear: false };
    const rear = videoInputs.find((d) => isRearCameraLabel(d.label));
    if (rear) return { deviceId: rear.deviceId, hasVideoInput: true, hasRear: true };
    const nonFront = videoInputs.find((d) => d.deviceId && !isFrontCameraLabel(d.label));
    if (nonFront) return { deviceId: nonFront.deviceId, hasVideoInput: true, hasRear: !isFrontCameraLabel(nonFront.label) };
    return { deviceId: null, hasVideoInput: true, hasRear: false };
  } catch {
    return { deviceId: null, hasVideoInput: false, hasRear: false };
  }
}

export function QrScannerView({ onDecode, onError, active, busy = false, className, labels }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<ZXingControls | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const startIdRef = useRef(0);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  const lastSeenRef = useRef(0);
  const lastCornersRef = useRef<Point[] | null>(null);
  const lastValueRef = useRef<string | null>(null);
  const successUntilRef = useRef(0);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<QrScannerStatus>("idle");
  const [statusText, setStatusText] = useState<string>("");

  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const setStatusSafe = useCallback((s: QrScannerStatus, text = "") => {
    if (!mountedRef.current) return;
    setStatus(s);
    setStatusText(text);
  }, []);

  const clearOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const drawOverlay = useCallback((corners: Point[] | null, mode: "tracking" | "success") => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(1, Math.floor(w * dpr));
    const bh = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!corners || corners.length < 4) return;

    const pts = corners.map((p) => mapPointToOverlay(p, video, w, h));
    const color = mode === "success" ? "#22D3EE" : "#06B6D4";
    const glow = mode === "success" ? "rgba(34,211,238,0.55)" : "rgba(6,182,212,0.35)";

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = mode === "success" ? "rgba(34,211,238,0.12)" : "rgba(6,182,212,0.07)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    const baseLen = 22;
    const thickness = 3.5;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      const prev = pts[(i + 3) % 4];
      const next = pts[(i + 1) % 4];
      const v1 = { x: prev.x - p.x, y: prev.y - p.y };
      const v2 = { x: next.x - p.x, y: next.y - p.y };
      const d1 = Math.hypot(v1.x, v1.y) || 1;
      const d2 = Math.hypot(v2.x, v2.y) || 1;
      const l1 = Math.min(baseLen, d1 * 0.38);
      const l2 = Math.min(baseLen, d2 * 0.38);
      const p1 = { x: p.x + (v1.x / d1) * l1, y: p.y + (v1.y / d1) * l1 };
      const p2 = { x: p.x + (v2.x / d2) * l2, y: p.y + (v2.y / d2) * l2 };
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const stopTracks = useCallback(() => {
    if (rafRef.current != null) { try { cancelAnimationFrame(rafRef.current); } catch {} rafRef.current = null; }
    const zxing = zxingControlsRef.current;
    zxingControlsRef.current = null;
    if (zxing) { try { zxing.stop(); } catch {} }
    const stream = streamRef.current;
    streamRef.current = null;
    stopStream(stream);
    stopVideoElement(videoRef.current);
  }, []);

  const hardCleanup = useCallback(() => {
    stopTracks();
    lastCornersRef.current = null;
    lastValueRef.current = null;
    lastSeenRef.current = 0;
    successUntilRef.current = 0;
    clearOverlay();
  }, [clearOverlay, stopTracks]);

  const stop = useCallback(async () => {
    startIdRef.current += 1;
    activeRef.current = false;
    hardCleanup();
    if (mountedRef.current) setStatusSafe("idle");
  }, [hardCleanup, setStatusSafe]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startIdRef.current += 1;
      activeRef.current = false;
      hardCleanup();
    };
  }, [hardCleanup]);

  const emitDetection = useCallback((value: string, corners: Point[] | null, startId: number) => {
    if (startIdRef.current !== startId || !mountedRef.current) return;
    const now = performance.now();
    lastSeenRef.current = now;
    if (corners) lastCornersRef.current = corners;
    if (corners) drawOverlay(corners, "tracking");
    if (mountedRef.current) setStatusSafe("detected");

    if (value && value !== lastValueRef.current) {
      lastValueRef.current = value;
      successUntilRef.current = now + 700;
      drawOverlay(lastCornersRef.current ?? corners, "success");
      if (mountedRef.current) setStatusSafe("success");
      window.setTimeout(() => {
        if (startIdRef.current !== startId || !mountedRef.current) return;
        onDecodeRef.current(value);
      }, 200);
    }
  }, [drawOverlay, setStatusSafe]);

  useEffect(() => {
    if (!active) { void stop(); return; }

    const startId = ++startIdRef.current;
    activeRef.current = true;
    setStatusSafe("starting", labels?.starting ?? "Starting rear camera…");

    const isCancelled = () => startIdRef.current !== startId || !mountedRef.current;

    const run = async () => {
      hardCleanup();
      if (isCancelled()) return;

      if (!window.isSecureContext) {
        throw Object.assign(new Error(labels?.insecure ?? "Camera requires a secure connection (HTTPS)."), { name: "SecurityError" });
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error(labels?.unsupported ?? "Camera access is not available in this browser."), { name: "NotSupportedError" });
      }

      let stream: MediaStream | null = null;
      let lastErr: unknown = null;

      const attempt = async (constraints: MediaStreamConstraints) => {
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        if (isCancelled()) { stopStream(s); throw new DOMException("Aborted", "AbortError"); }
        return s;
      };

      // 1) ideal environment
      try {
        stream = await attempt({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) { lastErr = e; }

      // verify not front
      if (stream) {
        const t = stream.getVideoTracks()[0];
        const settings = t?.getSettings?.() as MediaTrackSettings & { facingMode?: string; deviceId?: string };
        const lbl = t?.label || "";
        const facing = settings?.facingMode;
        if ((facing === "user" || isFrontCameraLabel(lbl)) && !(facing === "environment" || isRearCameraLabel(lbl))) {
          stopStream(stream); stream = null;
        }
      }

      // 2) exact environment
      if (!stream && !isCancelled()) {
        try { stream = await attempt({ video: { facingMode: { exact: "environment" } }, audio: false }); } catch (e) { lastErr = e; }
      }

      // 3) enumerate and pick rear-labeled / non-front device
      if (!stream && !isCancelled()) {
        const pick = await pickRearCameraDeviceId();
        if (pick.deviceId) {
          try { stream = await attempt({ video: { deviceId: { exact: pick.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
          catch (e) { lastErr = e; }
        }
        if (!stream && pick.hasVideoInput && !pick.hasRear) {
          throw Object.assign(new Error(labels?.noRearCamera ?? "No rear camera was found on this device."), { name: "NotFoundError", code: "no-rear-camera" });
        }
      }

      // 4) last resort: get video but reject if clearly front
      if (!stream && !isCancelled()) {
        try {
          const s = await attempt({ video: true, audio: false });
          const t = s.getVideoTracks()[0];
          const settings = t?.getSettings?.() as MediaTrackSettings & { facingMode?: string; deviceId?: string };
          const lbl = t?.label || "";
          const facing = settings?.facingMode;
          const looksFront = facing === "user" || isFrontCameraLabel(lbl);
          const looksRear = facing === "environment" || isRearCameraLabel(lbl);
          if (looksFront && !looksRear) {
            stopStream(s);
            throw Object.assign(new Error(labels?.noRearCamera ?? "No rear camera was found on this device."), { name: "NotFoundError", code: "no-rear-camera" });
          }
          stream = s;
        } catch (e) {
          if ((e as unknown as { code?: string })?.code === "no-rear-camera") throw e;
          lastErr = e;
        }
      }

      if (!stream) throw lastErr || new Error(labels?.genericError ?? "Unable to start rear camera.");
      if (isCancelled()) { stopStream(stream); return; }

      // final rear-camera guard: never silently fall back to front camera
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() as MediaTrackSettings & { facingMode?: string; deviceId?: string };
      const lbl = track?.label || "";
      const facing = settings?.facingMode;
      const looksFront = facing === "user" || isFrontCameraLabel(lbl);
      const looksRear = facing === "environment" || isRearCameraLabel(lbl);
      if (looksFront && !looksRear) {
        stopStream(stream);
        throw Object.assign(new Error(labels?.noRearCamera ?? "No rear camera was found on this device."), { name: "NotFoundError", code: "no-rear-camera" });
      }
      if (!looksRear) {
        const pick = await pickRearCameraDeviceId();
        const currentDeviceId = settings?.deviceId;
        const matchesKnownRear = !!(pick.hasRear && pick.deviceId && currentDeviceId && pick.deviceId === currentDeviceId);
        if (!matchesKnownRear) {
          stopStream(stream);
          throw Object.assign(new Error(labels?.noRearCamera ?? "No rear camera was found on this device."), { name: "NotFoundError", code: "no-rear-camera" });
        }
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopStream(stream); streamRef.current = null; throw new Error(labels?.genericError ?? "Scanner video element not ready."); }

      video.muted = true;
      video.defaultMuted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("muted", "true");
      video.setAttribute("autoplay", "true");
      video.setAttribute("playsinline", "true");
      (video.style as CSSStyleDeclaration & { webkitPlaysInline?: string }).webkitPlaysInline = "true";
      video.srcObject = stream;

      await waitForVideoReady(video, isCancelled);
      if (isCancelled()) { stopStream(stream); return; }
      try { await video.play(); } catch { /* autoplay may have already started */ }
      if (isCancelled()) return;

      setStatusSafe("scanning");
      lastValueRef.current = null;
      successUntilRef.current = 0;

      const detector = getBarcodeDetector();
      detectorRef.current = detector;

      if (detector) {
        const detectLoop = async () => {
          if (isCancelled() || !activeRef.current) return;
          const v = videoRef.current;
          const now = performance.now();
          if (successUntilRef.current > now) {
            drawOverlay(lastCornersRef.current, "success");
            rafRef.current = requestAnimationFrame(() => { void detectLoop(); });
            return;
          }
          if (v && v.readyState >= 2 && v.videoWidth > 0 && !busyRef.current) {
            try {
              const barcodes = await detector.detect(v);
              const qr = barcodes.find((b) => !b.format || String(b.format).toLowerCase() === "qr_code") ?? barcodes[0];
              if (qr?.rawValue) {
                const corners = normalizeCorners(qr.cornerPoints, qr.boundingBox);
                emitDetection(qr.rawValue, corners, startId);
              } else if (qr && qr.cornerPoints) {
                const corners = normalizeCorners(qr.cornerPoints, qr.boundingBox);
                if (corners) { lastSeenRef.current = now; lastCornersRef.current = corners; drawOverlay(corners, "tracking"); setStatusSafe("detected"); }
              } else {
                if (now - lastSeenRef.current > 350) { lastCornersRef.current = null; clearOverlay(); if (mountedRef.current && !isCancelled()) setStatusSafe("scanning"); }
                else if (lastCornersRef.current) drawOverlay(lastCornersRef.current, "tracking");
              }
            } catch {
              if (now - lastSeenRef.current > 500) { clearOverlay(); lastCornersRef.current = null; }
            }
          } else {
            if (now - lastSeenRef.current > 500) { clearOverlay(); lastCornersRef.current = null; }
          }
          rafRef.current = requestAnimationFrame(() => { void detectLoop(); });
        };
        rafRef.current = requestAnimationFrame(() => { void detectLoop(); });
      } else {
        // Fallback: @zxing/browser on existing video element (no new stream)
        try {
          const { BrowserQRCodeReader } = await import("@zxing/browser");
          if (isCancelled()) return;
          const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120 });
          const controls = await reader.decodeFromVideoElement(video, (result, _err, ctrl) => {
            if (isCancelled()) { try { ctrl.stop(); } catch {} return; }
            const now = performance.now();
            if (successUntilRef.current > now) { drawOverlay(lastCornersRef.current, "success"); return; }
            if (result) {
              const text = result.getText?.();
              const pts = cornersFromResultPoints(result.getResultPoints?.() as unknown as Array<{ getX?: () => number; getY?: () => number; x?: number; y?: number }> | undefined);
              if (text) emitDetection(text, pts, startId);
              else if (pts) { lastSeenRef.current = now; lastCornersRef.current = pts; drawOverlay(pts, "tracking"); setStatusSafe("detected"); }
            } else {
              if (now - lastSeenRef.current > 400) { lastCornersRef.current = null; clearOverlay(); if (mountedRef.current && !isCancelled()) setStatusSafe("scanning"); }
              else if (lastCornersRef.current) drawOverlay(lastCornersRef.current, "tracking");
            }
          });
          if (isCancelled()) { try { controls.stop(); } catch {} return; }
          zxingControlsRef.current = controls as ZXingControls;
        } catch (e) {
          // If zxing fallback fails, show clear error
          throw e;
        }
      }
    };

    run().catch((err) => {
      if (isCancelled()) return;
      hardCleanup();
      let msg = labels?.genericError ?? "Unable to start rear camera.";
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name) : "";
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
      if (code === "no-rear-camera") msg = labels?.noRearCamera ?? "No rear camera was found on this device.";
      else if (name === "NotAllowedError" || name === "PermissionDeniedError") msg = labels?.permissionDenied ?? "Camera permission was denied. Allow rear camera access and try again.";
      else if (name === "NotFoundError" || name === "DevicesNotFoundError") msg = labels?.noRearCamera ?? "No rear camera was found on this device.";
      else if (name === "NotReadableError" || name === "TrackStartError") msg = labels?.notReadable ?? "The rear camera is in use by another app. Close it and try again.";
      else if (name === "SecurityError") msg = labels?.insecure ?? "Camera requires a secure connection (HTTPS).";
      else if (name === "NotSupportedError") msg = labels?.unsupported ?? "Camera access is not available in this browser.";
      else if (err instanceof Error && err.message) msg = err.message;
      setStatusSafe("error", msg);
      onErrorRef.current?.(msg);
    });

    return () => { startIdRef.current += 1; activeRef.current = false; hardCleanup(); };
  }, [active]);

  return (
    <div className={className ?? "qr-scanner-shell"} data-status={status} aria-label="QR scanner">
      <video ref={videoRef} className="qr-scanner-video" muted autoPlay playsInline />
      <canvas ref={overlayRef} className="qr-scanner-overlay" />
      <div className="qr-scanner-hud" aria-hidden="true">
        <div className="qr-scanner-frame" />
        {status === "scanning" && !busy && <div className="qr-scanner-sweep" />}
        {status === "starting" && <div className="qr-scanner-status">{statusText || labels?.starting || "Starting rear camera…"}</div>}
        {status === "error" && statusText && <div className="qr-scanner-status qr-scanner-status-error">{statusText}</div>}
      </div>
    </div>
  );
}
