"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const SESSION_KEY = "mtc-splash-seen";

export function SplashScreen() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try { seen = window.sessionStorage.getItem(SESSION_KEY) === "1"; } catch { seen = false; }
    if (seen) return;

    setVisible(true);
    try { window.sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const holdMs = reduced ? 120 : 900;
    const fadeMs = reduced ? 0 : 420;

    const t1 = window.setTimeout(() => setLeaving(true), holdMs);
    const t2 = window.setTimeout(() => setVisible(false), holdMs + fadeMs);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  if (!visible) return null;

  return (
    <div className={`splash-screen${leaving ? " is-leaving" : ""}`} role="status" aria-label="MT Club loading" aria-live="polite">
      <div className="splash-bg" aria-hidden="true">
        <div className="splash-grid" />
        <div className="splash-glow splash-glow-a" />
        <div className="splash-glow splash-glow-b" />
      </div>
      <div className="splash-content">
        <div className="splash-logo-wrap">
          <div className="splash-ring" aria-hidden="true" />
          <Image src="/mt-logo.png" alt="MT Club" width={88} height={88} priority className="splash-logo" />
        </div>
        <div className="splash-wordmark">
          <span className="splash-name">MT Club</span>
          <span className="splash-tag">Medical Technology</span>
        </div>
        <div className="splash-robot" aria-hidden="true">
          <Image src="/robot-error.png" alt="" width={64} height={64} className="splash-robot-img" />
        </div>
      </div>
    </div>
  );
}
