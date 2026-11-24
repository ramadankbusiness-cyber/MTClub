import { describe, expect, it } from "vitest";
import { classifyCameraError, getCameraErrorMessage } from "@/lib/attendance-camera";

describe("attendance camera error handling", () => {
  it("classifies common camera errors separately", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toBe("not-allowed");
    expect(classifyCameraError({ name: "PermissionDeniedError" })).toBe("not-allowed");
    expect(classifyCameraError({ name: "NotFoundError" })).toBe("not-found");
    expect(classifyCameraError({ name: "DevicesNotFoundError" })).toBe("not-found");
    expect(classifyCameraError({ name: "NotReadableError" })).toBe("not-readable");
    expect(classifyCameraError({ name: "TrackStartError" })).toBe("not-readable");
    expect(classifyCameraError({ name: "OverconstrainedError" })).toBe("overconstrained");
    expect(classifyCameraError({ name: "ConstraintNotSatisfiedError" })).toBe("overconstrained");
    expect(classifyCameraError({ name: "SecurityError" })).toBe("security");
    expect(classifyCameraError({ name: "AbortError" })).toBe("aborted");
  });

  it("classifies string/html5-qrcode shaped errors", () => {
    expect(classifyCameraError("NotAllowedError: Permission denied")).toBe("not-allowed");
    expect(classifyCameraError(new Error("Could not start video source"))).toBe("not-readable");
    expect(classifyCameraError("The play() request was interrupted by a new load request")).toBe("aborted");
  });

  it("returns actionable messages and does not misreport unknown errors as permission denial", () => {
    expect(getCameraErrorMessage({ name: "NotAllowedError" })).toMatch(/permission was denied/i);
    expect(getCameraErrorMessage({ name: "NotFoundError" })).toMatch(/No camera was found/i);
    expect(getCameraErrorMessage({ name: "NotReadableError" })).toMatch(/in use by another app/i);
    expect(getCameraErrorMessage({ name: "OverconstrainedError" })).toMatch(/selected camera is unavailable/i);
    expect(getCameraErrorMessage({ name: "SecurityError" })).toMatch(/security/i);
    expect(getCameraErrorMessage({ name: "AbortError" })).toMatch(/interrupted/i);
    expect(getCameraErrorMessage(new Error("something weird"))).toMatch(/Camera could not be started/i);
    expect(getCameraErrorMessage(new Error("something weird"))).not.toMatch(/Allow camera access for this site in your browser settings, then reload/i);
  });
});
