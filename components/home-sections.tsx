"use client";

import React from "react";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Hammer, Users, type LucideIcon } from "lucide-react";
import { features as featureMeta } from "@/data/site";
import { useSite } from "./site-provider";

const icons: Record<string, LucideIcon> = { sparkles: BookOpen, hammer: Hammer, users: Users };

export function HomeContent({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const { text, language } = useSite();
  const home = text.home as typeof text.home & { intro?: string };
  const Arrow = language === "ar" ? ArrowLeft : ArrowRight;
  return (
    <>
      <section className="hero-section">
        <div className="hero-glow hero-glow-a" />
        <div className="hero-glow hero-glow-b" />
        <div className="hero-content">
          <p className="status-pill"><span className="status-dot" />{home.badge}</p>
          <h1>{home.title}</h1>
          <p className="hero-lead">{home.lead}</p>
          {home.intro ? <p className="hero-lead">{home.intro}</p> : null}
          {!isAuthenticated && (
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/join">{home.become}<Arrow size={17} aria-hidden="true" /></Link>
              <Link className="button button-secondary button-large" href="/events">{home.eventsButton}</Link>
            </div>
          )}
        </div>
      </section>

      <section className="content-section what-section">
        <div className="section-heading">
          <p className="eyebrow">{home.whatEyebrow}</p>
          <h2>{home.whatTitle}</h2>
        </div>
        <div className="feature-grid">
          {home.features.map((feature, index) => {
            const Icon = icons[featureMeta[index].icon];
            return (
              <article className="feature-card" key={feature.title}>
                <div className="icon-tile"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      {!isAuthenticated && (
        <section className="content-section cta-section">
          <div className="cta-panel">
            <div>
              <p className="eyebrow">{home.ctaEyebrow}</p>
              <h2>{home.ctaTitle}</h2>
              <p>{home.ctaText}</p>
            </div>
            <Link className="button button-secondary button-large" href="/join">{home.ctaButton}<Arrow size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      )}
    </>
  );
}
