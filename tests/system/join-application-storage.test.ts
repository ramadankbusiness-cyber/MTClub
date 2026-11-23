import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const insertSingle = vi.fn();
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const dupLimit = vi.fn();
  const dupGte = vi.fn(() => ({ limit: dupLimit }));
  const dupEq = vi.fn(() => ({ gte: dupGte }));
  const dupSelect = vi.fn(() => ({ eq: dupEq }));

  const adminOrder = vi.fn();
  const adminContains = vi.fn(() => ({ order: adminOrder }));
  const adminSelect = vi.fn(() => ({ order: adminOrder, contains: adminContains }));

  const from = vi.fn((table: string) => {
    if (table !== "join_applications") throw new Error(`unexpected table ${table}`);
    return { insert, select: (cols: string) => {
      // used by both duplicate check and admin select
      if (cols.includes("committees")) return adminSelect(cols);
      return dupSelect(cols);
    } };
  });

  return {
    from, insert, insertSelect, insertSingle,
    dupSelect, dupEq, dupGte, dupLimit,
    adminSelect, adminOrder, adminContains,
    createClient: vi.fn(() => ({ from })),
    requirePermission: vi.fn(),
    createImmediateNotification: vi.fn(async () => undefined),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/notification-delivery", () => ({ createImmediateNotification: mocks.createImmediateNotification }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));

import { POST as JOIN_POST } from "@/app/api/join/route";
import { GET as ADMIN_GET } from "@/app/api/admin/applications/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }

describe("join application storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "secret";
    mocks.dupLimit.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: { id: 1 }, error: null });
    mocks.adminOrder.mockResolvedValue({ data: [], error: null });
    mocks.adminContains.mockReturnValue({ order: mocks.adminOrder });
  });

  it("inserts only canonical join_applications columns", async () => {
    const body = {
      name: "Test Applicant",
      email: "applicant@example.com",
      academicNumber: "20260001",
      phone: "01012345678",
      committees: ["OC"],
      message: "I would like to join the club.",
    };
    const res = await (JOIN_POST as any)(req("http://localhost/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect(res.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toEqual({
      name: "Test Applicant",
      email: "applicant@example.com",
      phone: "+201012345678",
      academic_number: "20260001",
      committees: ["OC"],
      message: "I would like to join the club.",
      created_at: expect.any(String),
    });
    expect(inserted).not.toHaveProperty("phone_number");
    expect(inserted).not.toHaveProperty("academicNumber");
    expect(inserted).not.toHaveProperty("submitted_at");
  });

  it("duplicate check queries canonical columns only", async () => {
    const body = {
      name: "Test Applicant",
      email: "applicant@example.com",
      academicNumber: "20260001",
      phone: "01012345678",
      committees: ["OC"],
      message: "I would like to join the club.",
    };
    await (JOIN_POST as any)(req("http://localhost/api/join", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    // first select call is duplicate check
    expect(mocks.dupSelect).toHaveBeenCalledWith("id, email, phone, academic_number, created_at");
  });

  it("admin GET selects canonical columns and returns compatible academicNumber alias", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.adminOrder.mockResolvedValue({
      data: [{ id: 1, name: "A", email: "a@b.com", phone: "+201012345678", academic_number: "20260001", committees: ["OC"], message: "hi", created_at: "2026-01-01T00:00:00.000Z" }],
      error: null,
    });

    const res = await (ADMIN_GET as any)(req("http://localhost/api/admin/applications"));
    expect(res.status).toBe(200);
    expect(mocks.adminSelect).toHaveBeenCalledWith("id, name, email, phone, academic_number, committees, message, created_at");
    const body = await res.json();
    expect(body.applications[0]).toEqual(expect.objectContaining({
      phone: "+201012345678",
      academicNumber: "20260001",
    }));
  });
});
