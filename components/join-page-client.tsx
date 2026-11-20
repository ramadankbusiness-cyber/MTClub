"use client";

import { JoinForm } from "@/components/join-form";
import { SectionHeading } from "@/components/section-heading";
import { useSite } from "@/components/site-provider";

export function JoinPageClient() {
  const { text } = useSite();
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro join-intro">
        <SectionHeading eyebrow={text.join.eyebrow} title={text.join.title} lead={text.join.lead} />
        <JoinForm />
      </section>
    </main>
  );
}
