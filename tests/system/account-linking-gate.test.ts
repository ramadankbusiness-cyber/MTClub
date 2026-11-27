import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));

// We need to mock getCurrentUser inside auth-guards module by mocking its dependencies.
// Easier: mock @/lib/auth-guards for requirePermission? No, we want to test it. Instead mock prisma and auth.
import { requirePermission, isAccountLinkingComplete } from "@/lib/auth-guards";

describe("account linking gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks API access when both integrations missing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const { prisma } = await import("@/lib/prisma");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u1", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: null, telegramUserId: null });
    const res = await requirePermission("dashboard.view");
    expect("error" in res && res.status).toBe(403);
    expect("error" in res && res.error).toContain("Account linking required");
  });

  it("blocks when missing Google only", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const { prisma } = await import("@/lib/prisma");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: null, telegramUserId: "tg1" });
    const res = await requirePermission("dashboard.view");
    expect("error" in res && res.status).toBe(403);
  });

  it("blocks when missing Telegram only", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const { prisma } = await import("@/lib/prisma");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u1", role: "LEADER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g1", telegramUserId: null });
    const res = await requirePermission("dashboard.view");
    expect("error" in res && res.status).toBe(403);
  });

  it("allows access when both integrations linked", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const { prisma } = await import("@/lib/prisma");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u1", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g1", telegramUserId: "tg1" });
    const res = await requirePermission("dashboard.view");
    expect("user" in res).toBe(true);
  });

  it("allows linking endpoints with allowIncompleteLinking", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const { prisma } = await import("@/lib/prisma");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "u1", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: null, telegramUserId: null });
    const res = await requirePermission("profile.read.own", { allowIncompleteLinking: true });
    expect("user" in res).toBe(true);
  });

  it("admin and leader accounts are also gated", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const { prisma } = await import("@/lib/prisma");
    for (const role of ["ADMIN", "LEADER"] as const) {
      (prisma.user.findUnique as any).mockResolvedValue({ id: "u1", role, committeeId: role === "LEADER" ? "c1" : null, isActive: true, mustChangePassword: false, googleSubject: null, telegramUserId: null });
      const res = await requirePermission("dashboard.view");
      expect("error" in res && res.status).toBe(403);
    }
  });

  it("blocks new user missing both integrations", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "new-user" } });
    const { prisma } = await import("@/lib/prisma");
    (prisma.user.findUnique as any).mockResolvedValue({ id: "new-user", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: null, telegramUserId: null });
    const res = await requirePermission("dashboard.view");
    expect("error" in res && res.status).toBe(403);
  });

  it("isAccountLinkingComplete helper works", () => {
    expect(isAccountLinkingComplete(null)).toBe(false);
    expect(isAccountLinkingComplete({ googleSubject: "g", telegramUserId: null })).toBe(false);
    expect(isAccountLinkingComplete({ googleSubject: null, telegramUserId: "t" })).toBe(false);
    expect(isAccountLinkingComplete({ googleSubject: "g", telegramUserId: "t" })).toBe(true);
  });
});
