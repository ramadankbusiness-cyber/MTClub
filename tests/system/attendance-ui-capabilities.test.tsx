// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const scannerMock = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  clear: vi.fn(() => undefined),
  isScanning: false,
}));
const Html5QrcodeMock = vi.hoisted(() => vi.fn(function () { return scannerMock; }));

vi.mock("html5-qrcode", () => ({ Html5Qrcode: Html5QrcodeMock }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (key === "confirmed") return `confirmed ${String(vars?.status ?? "")}`;
    if (key === "checkIns") return `${String(vars?.count ?? 0)} check-ins`;
    if (key === "lateAfterShort") return `${String(vars?.minutes ?? 0)}m`;
    return key;
  },
  useLocale: () => "en",
}));
vi.mock("@/components/app-toast-provider", () => ({ useAppToast: () => vi.fn() }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => <div data-testid="qr" /> }));
vi.mock("@/components/zone-capture", () => ({ default: () => <div /> }));
vi.mock("@/components/committee-select", () => ({ CommitteeSelect: () => <select /> }));
vi.mock("@/data/committees", () => ({ getCommitteeLabel: (n: string) => n }));

import { AttendanceTools } from "@/components/attendance-tools";

describe("attendance UI role capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scannerMock.isScanning = false;
    scannerMock.start.mockImplementation(async () => { scannerMock.isScanning = true; });
    scannerMock.stop.mockImplementation(async () => { scannerMock.isScanning = false; });
    scannerMock.clear.mockImplementation(() => undefined);
    Html5QrcodeMock.mockImplementation(function () { return scannerMock; });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) }, configurable: true });
  });
  afterEach(() => cleanup());

  it("renders ADMIN personal self-check-in and history plus admin management", async () => {
    render(<AttendanceTools
      role="ADMIN"
      initialSessions={[{ id: "s1", title: "Session 1", startsAt: new Date().toISOString(), endsAt: new Date().toISOString(), lateAfterMinutes: 10, qrMode: "ROTATING", committee: null, zone: null, centerLat: null, centerLng: null, radiusMeters: null, locationAccuracy: null, placeName: null, recordCount: 0 } as any]}
      committees={[]}
      members={[]}
      records={[{ id: "r1", status: "PRESENT", checkedInAt: new Date().toISOString(), session: { title: "Past Session" } }]}
      attendanceRate={100}
      userRole="ADMIN"
      userCommitteeId={null}
    />);

    expect(screen.queryByText("yourAttendance")).not.toBeNull();
    expect(screen.queryByText("Past Session")).not.toBeNull(); // personal history
    expect(screen.queryByText("sessions")).not.toBeNull(); // admin management
  });

  it("initializes camera on scan and cleans up on unmount", async () => {
    const { unmount } = render(<AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={[]} attendanceRate={0} />);
    const btn = screen.getByRole("button", { name: "cameraScan" });
    fireEvent.click(btn);
    await waitFor(() => expect(Html5QrcodeMock).toHaveBeenCalled());
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalled());
    scannerMock.isScanning = true;
    unmount();
    await waitFor(() => expect(scannerMock.stop).toHaveBeenCalled());
    expect(scannerMock.clear).toHaveBeenCalled();
  });

  it("stops and clears scanner if start resolves after cancellation/unmount", async () => {
    let resolveStart: (() => void) | null = null;
    scannerMock.start.mockImplementationOnce(() => new Promise<void>((resolve) => { scannerMock.isScanning = true; resolveStart = resolve; }));
    const { unmount } = render(<AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={[]} attendanceRate={0} />);
    fireEvent.click(screen.getByRole("button", { name: "cameraScan" }));
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalled());
    unmount(); // cancels active start
    // resolve the in-flight start after cancellation
    resolveStart?.();
    await waitFor(() => expect(scannerMock.stop).toHaveBeenCalled());
    await waitFor(() => expect(scannerMock.clear).toHaveBeenCalled());
  });

  it("ignores stale decode callbacks after stop", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: "no" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={[]} attendanceRate={0} />);
    fireEvent.click(screen.getByRole("button", { name: "cameraScan" }));
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalled());
    const onDecode = scannerMock.start.mock.calls[0][2] as (value: string) => void;
    // stop scanner
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    await waitFor(() => expect(scannerMock.stop).toHaveBeenCalled());
    fetchMock.mockClear();
    onDecode("stale-token");
    // give microtasks a chance
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("handles repeated start/stop without duplicate active scanner instances", async () => {
    render(<AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={[]} attendanceRate={0} />);
    const scanBtn = screen.getByRole("button", { name: "cameraScan" });
    fireEvent.click(scanBtn);
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    await waitFor(() => expect(scannerMock.stop).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "cameraScan" }));
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalledTimes(2));
    // only one Html5Qrcode instance should be active at a time; each start creates one instance
    expect(Html5QrcodeMock).toHaveBeenCalledTimes(2);
  });

  it("stops acquired media tracks on partial startup failure", async () => {
    const trackStop = vi.fn();
    scannerMock.start.mockImplementationOnce(async () => {
      const container = document.getElementById("attendance-qr-reader");
      const video = document.createElement("video");
      (video as any).srcObject = { getTracks: () => [{ stop: trackStop }] };
      container?.appendChild(video);
      throw new Error("start failed");
    });
    render(<AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={[]} attendanceRate={0} />);
    fireEvent.click(screen.getByRole("button", { name: "cameraScan" }));
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalled());
    await waitFor(() => expect(trackStop).toHaveBeenCalled());
  });

  it("completes cleanup even if scanner stop/clear throw", async () => {
    scannerMock.stop.mockImplementationOnce(async () => { throw new Error("stop failed"); });
    scannerMock.clear.mockImplementationOnce(() => { throw new Error("clear failed"); });
    render(<AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={[]} attendanceRate={0} />);
    fireEvent.click(screen.getByRole("button", { name: "cameraScan" }));
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    // should recover and allow a new start
    await waitFor(() => expect(screen.queryByRole("button", { name: "cameraScan" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "cameraScan" }));
    await waitFor(() => expect(scannerMock.start).toHaveBeenCalledTimes(2));
  });
});
