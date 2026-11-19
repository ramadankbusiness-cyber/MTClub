import { describe, expect, it } from "vitest";
import { CLUB_COMMITTEES } from "../../data/committees";
import { joinApplicationSchema, normalizeEgyptianPhone } from "../../lib/schemas";

describe("membership application", () => {
  const application = {
    name: "Test Applicant",
    email: "applicant@example.com",
    academicNumber: "20260001",
    phone: "01012345678",
    message: "I would like to join the club.",
  };

  it("uses the seven committees in their canonical order", () => {
    expect(CLUB_COMMITTEES).toEqual(["OC", "HR", "PR", "Tech", "Logistics", "Media", "First Aid"]);
  });

  it("requires one to three allowed committees", () => {
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC"] }).success).toBe(true);
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["Tech", "Media", "OC"] }).success).toBe(true);
    expect(joinApplicationSchema.safeParse({ ...application, committees: [] }).success).toBe(false);
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC", "HR", "PR", "Tech"] }).success).toBe(false);
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC", "Unknown"] }).success).toBe(false);
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC", "OC"] }).success).toBe(false);
  });

  it("requires and normalizes a valid Egyptian phone number", () => {
    expect(normalizeEgyptianPhone("01012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("+201012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("201012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone(" 010-1234-5678 ")).toBe("+201012345678");

    const local = joinApplicationSchema.safeParse({ ...application, committees: ["OC"], phone: "01123456789" });
    expect(local.success).toBe(true);
    if (local.success) expect(local.data.phone).toBe("+201123456789");

    const intl = joinApplicationSchema.safeParse({ ...application, committees: ["OC"], phone: "+201223456789" });
    expect(intl.success).toBe(true);
    if (intl.success) expect(intl.data.phone).toBe("+201223456789");

    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC"], phone: "" }).success).toBe(false);
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC"], phone: "12345" }).success).toBe(false);
    expect(joinApplicationSchema.safeParse({ ...application, committees: ["OC"], phone: "+15551234567" }).success).toBe(false);
  });
});
