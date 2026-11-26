// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HomeContent } from "@/components/home-sections";

const en = {
  home: {
    badge: "Badge", title: "Title", lead: "Lead", become: "Become a member", eventsButton: "See events",
    whatEyebrow: "W", whatTitle: "What", features: [{ title: "F1", description: "D1" }, { title: "F2", description: "D2" }, { title: "F3", description: "D3" }],
    ctaEyebrow: "YOUR NEXT CHAPTER", ctaTitle: "Ready to be part of it?", ctaText: "Membership is free and open to everyone who loves learning.", ctaButton: "Join MT Club",
  },
};
const ar = {
  home: {
    badge: "B", title: "T", lead: "L", become: "كن عضوًا", eventsButton: "شاهد الفعاليات",
    whatEyebrow: "W", whatTitle: "What", features: [{ title: "F1", description: "D1" }, { title: "F2", description: "D2" }, { title: "F3", description: "D3" }],
    ctaEyebrow: "المكان يتّسع لك", ctaTitle: "جاهز تكون جزءًا منّا؟", ctaText: "العضوية مجانية ومفتوحة لكل اللي بيحب يتعلم.", ctaButton: "انضم إلى نادي MT",
  },
};

let lang: "en" | "ar" = "en";
vi.mock("@/components/site-provider", () => ({
  useSite: () => ({ language: lang, text: lang === "ar" ? ar : en }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/data/site", () => ({
  features: [{ icon: "sparkles" }, { icon: "hammer" }, { icon: "users" }],
}));

describe("Home membership CTA visibility", () => {
  afterEach(() => cleanup());
  it("shows CTA for unauthenticated English visitors", () => {
    lang = "en";
    render(<HomeContent isAuthenticated={false} />);
    expect(screen.getByText("YOUR NEXT CHAPTER")).toBeTruthy();
    expect(screen.getByText("Ready to be part of it?")).toBeTruthy();
    expect(screen.getByText("Join MT Club")).toBeTruthy();
  });

  it("hides CTA completely for authenticated English users", () => {
    lang = "en";
    render(<HomeContent isAuthenticated />);
    expect(screen.queryByText("YOUR NEXT CHAPTER")).toBeNull();
    expect(screen.queryByText("Ready to be part of it?")).toBeNull();
    expect(screen.queryByText("Join MT Club")).toBeNull();
    expect(screen.queryByText("Membership is free and open to everyone who loves learning.")).toBeNull();
  });

  it("shows CTA for unauthenticated Arabic visitors", () => {
    lang = "ar";
    render(<HomeContent isAuthenticated={false} />);
    expect(screen.getByText("المكان يتّسع لك")).toBeTruthy();
    expect(screen.getByText("جاهز تكون جزءًا منّا؟")).toBeTruthy();
    expect(screen.getByText("انضم إلى نادي MT")).toBeTruthy();
  });

  it("hides CTA completely for authenticated Arabic users", () => {
    lang = "ar";
    render(<HomeContent isAuthenticated />);
    expect(screen.queryByText("المكان يتّسع لك")).toBeNull();
    expect(screen.queryByText("جاهز تكون جزءًا منّا؟")).toBeNull();
    expect(screen.queryByText("انضم إلى نادي MT")).toBeNull();
  });
});
