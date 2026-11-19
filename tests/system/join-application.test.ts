import { describe, expect, it } from "vitest";
import { CLUB_COMMITTEES } from "../../data/committees";
import { joinApplicationSchema } from "../../lib/schemas";

describe("membership application committees", () => {
  const application = {
    name: "Test Applicant",
    email: "applicant@example.com",
    academicNumber: "20260001",
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
});
