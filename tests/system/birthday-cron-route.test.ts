import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  dispatchBirthdayNotifications: vi.fn(async () => ({ processed: 1, sent: 1, failed: 0, skipped: 0 })),
}));

vi.mock("@/lib/birthdays", () => ({
  dispatchBirthdayNotifications: mocks.dispatchBirthdayNotifications,
}));

import { GET, POST } from "@/app/api/cron/birthdays/route";

const SECRET = "test-cron-secret-that-is-at-least-32-chars";

function req(method: "GET" | "POST", auth?: string) {
  return new NextRequest("http://localhost/api/cron/birthdays", {
    method,
    headers: auth ? { authorization: auth } : undefined,
  });
}

describe("birthday cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
  });

  it("authenticated GET succeeds and uses birthday processing", async () => {
    const res = await GET(req("GET", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ processed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(mocks.dispatchBirthdayNotifications).toHaveBeenCalledTimes(1);
  });

  it("missing authorization returns 401 for GET and does not dispatch", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
    expect(mocks.dispatchBirthdayNotifications).not.toHaveBeenCalled();
  });

  it("invalid authorization returns 401 for GET and does not dispatch", async () => {
    const res = await GET(req("GET", "Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(mocks.dispatchBirthdayNotifications).not.toHaveBeenCalled();
  });

  it("missing authorization returns 401 for POST and does not dispatch", async () => {
    const res = await POST(req("POST"));
    expect(res.status).toBe(401);
    expect(mocks.dispatchBirthdayNotifications).not.toHaveBeenCalled();
  });

  it("POST behavior remains intact when authenticated", async () => {
    const res = await POST(req("POST", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ processed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(mocks.dispatchBirthdayNotifications).toHaveBeenCalledTimes(1);
  });

  it("GET does not bypass CRON_SECRET when missing or too short", async () => {
    delete process.env.CRON_SECRET;
    const missing = await GET(req("GET", `Bearer ${SECRET}`));
    expect(missing.status).toBe(401);

    process.env.CRON_SECRET = "short-secret";
    const short = await GET(req("GET", "Bearer short-secret"));
    expect(short.status).toBe(401);
    expect(mocks.dispatchBirthdayNotifications).not.toHaveBeenCalled();
  });
});
