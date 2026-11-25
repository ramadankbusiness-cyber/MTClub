"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";

const SESSION_KEY = "mtc-splash-seen";

export function SplashScreen() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;

    let t1: number | undefined;
    let t2: number | undefined;
    let failSafe: number | undefined;

    try {
      setVisible(true);
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // ignore storage failures; fail-open
      }

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const holdMs = reduced ? 80 : 720;
      const fadeMs = reduced ? 0 : 280;

      t1 = window.setTimeout(() => setLeaving(true), holdMs);
      t2 = window.setTimeout(() => setVisible(false), holdMs + fadeMs);
      failSafe = window.setTimeout(() => setVisible(false), 2400);
    } catch {
      setVisible(false);
    }

    return () => {
      if (t1 != null) window.clearTimeout(t1);
      if (t2 != null) window.clearTimeout(t2);
      if (failSafe != null) window.clearTimeout(failSafe);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`splash-screen${leaving ? " is-leaving" : ""}`} role="status" aria-label="MT Club" aria-live="polite">
      <div className="splash-content">
        <div className="splash-logo-wrap">
          <Image src="/mt-logo.png" alt="MT Club" width={72} height={72} priority className="splash-logo" />
        </div>
        <p className="splash-wordmark">
          <span className="splash-name">MT Club</span>
          <span className="splash-tag">Medical Technology</span>
        </p>
        <div className="splash-loader" aria-hidden="true">
          <span className="splash-loader-bar" />
        </div>
      </div>
    </div>
  );
}
