export type CameraErrorKind =
  | "not-allowed"
  | "not-found"
  | "not-readable"
  | "overconstrained"
  | "security"
  | "aborted"
  | "insecure"
  | "unsupported"
  | "unknown";

export function classifyCameraError(error: unknown): CameraErrorKind {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const haystack = `${name} ${message}`.toLowerCase();

  if (haystack.includes("notallowederror") || haystack.includes("permissiondeniederror") || haystack.includes("permission denied") || haystack.includes("permission dismissed")) {
    return "not-allowed";
  }
  if (haystack.includes("notfounderror") || haystack.includes("devicesnotfounderror") || haystack.includes("requested device not found") || haystack.includes("no camera")) {
    return "not-found";
  }
  if (haystack.includes("notreadableerror") || haystack.includes("trackstarterror") || haystack.includes("could not start video source") || haystack.includes("device in use")) {
    return "not-readable";
  }
  if (haystack.includes("overconstrainederror") || haystack.includes("constraintnotsatisfiederror") || haystack.includes("overconstrained")) {
    return "overconstrained";
  }
  if (haystack.includes("securityerror") || haystack.includes("secure context") || haystack.includes("https")) {
    return "security";
  }
  if (haystack.includes("aborterror") || haystack.includes("aborted") || haystack.includes("the play() request was interrupted")) {
    return "aborted";
  }
  return "unknown";
}

export function getCameraErrorMessage(error: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera access requires a secure connection (HTTPS). Open this page over HTTPS and try again.";
  }
  const kind = classifyCameraError(error);
  switch (kind) {
    case "not-allowed":
      return "Camera permission was denied. Allow camera access for this site in your browser settings, reload the page, then try again.";
    case "not-found":
      return "No camera was found on this device. Connect a camera or try a different device.";
    case "not-readable":
      return "The camera could not be started. It may be in use by another app. Close other camera apps/tabs and try again.";
    case "overconstrained":
      return "The selected camera is unavailable. Try another camera or reload and try again.";
    case "security":
      return "Camera access was blocked by browser security settings. Use HTTPS and allow camera access for this site.";
    case "aborted":
      return "Camera startup was interrupted. Please try again.";
    default:
      return "Camera could not be started. Check camera permissions, close other camera apps, and try again.";
  }
}

export async function listAvailableCameras(): Promise<Array<{ id: string; label: string }>> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d, idx) => ({ id: d.deviceId, label: d.label || `Camera ${idx + 1}` }));
  } catch {
    return [];
  }
}

export function stopMediaTracksInContainer(containerId: string) {
  if (typeof document === "undefined") return;
  const container = document.getElementById(containerId);
  if (!container) return;
  const videos = Array.from(container.querySelectorAll("video"));
  for (const video of videos) {
    const srcObject = video.srcObject;
    if (srcObject && typeof (srcObject as MediaStream).getTracks === "function") {
      for (const track of (srcObject as MediaStream).getTracks()) {
        try { track.stop(); } catch {}
      }
    }
    try { video.srcObject = null; } catch {}
  }
}
