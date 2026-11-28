"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { useSession } from "next-auth/react";
import { useSite } from "./site-provider";

type Anim = "up" | "down" | null;

export const POINTS_UPDATED_EVENT = "mtclub:points-updated";

export function emitPointsUpdated(balance?: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(POINTS_UPDATED_EVENT, { detail: { balance } }));
}

export function PointsIndicator() {
  const { data: session, status } = useSession();
  const { text } = useSite();
  const [balance, setBalance] = useState<number | null>(null);
  const [anim, setAnim] = useState<Anim>(null);
  const lastBalanceRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const animTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const applyBalance = useCallback((next: number, allowAnim: boolean) => {
    if (!mountedRef.current) return;
    const prev = lastBalanceRef.current;
    if (prev === next) return;
    const shouldAnimate = allowAnim && initializedRef.current && prev !== null && prev !== next;
    lastBalanceRef.current = next;
    setBalance(next);
    if (shouldAnimate) {
      const prefersReduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!prefersReduced) {
        setAnim(next > prev ? "up" : "down");
        if (animTimerRef.current) window.clearTimeout(animTimerRef.current);
        animTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) setAnim(null);
        }, 700);
      }
    }
    initializedRef.current = true;
  }, []);

  const fetchBalance = useCallback(async (allowAnim = false) => {
    if (status !== "authenticated" || !session?.user?.id) return;
    try {
      const res = await fetch("/api/profile/points/balance", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (typeof data?.balance === "number" && Number.isFinite(data.balance)) {
        applyBalance(data.balance, allowAnim);
      }
    } catch {
      // ignore transient fetch failures
    }
  }, [status, session?.user?.id, applyBalance]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (animTimerRef.current) window.clearTimeout(animTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      setBalance(null);
      setAnim(null);
      lastBalanceRef.current = null;
      initializedRef.current = false;
      return;
    }
    void fetchBalance(false); // initial load - no animation
  }, [status, fetchBalance]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ balance?: number }>).detail;
      if (typeof detail?.balance === "number" && Number.isFinite(detail.balance)) {
        applyBalance(detail.balance, true);
      } else {
        void fetchBalance(true);
      }
    };
    const onFocus = () => { void fetchBalance(true); };
    const onVis = () => { if (document.visibilityState === "visible") void fetchBalance(true); };
    window.addEventListener(POINTS_UPDATED_EVENT, onUpdate as EventListener);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener(POINTS_UPDATED_EVENT, onUpdate as EventListener);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status, fetchBalance, applyBalance]);

  if (status !== "authenticated" || balance === null) return null;

  const nav = text.nav as typeof text.nav & { points?: string; pointsBalanceAria?: string };
  const label = nav.pointsBalanceAria || "Points balance";
  const pointsText = nav.points || "Points";

  return (
    <div
      className={`points-indicator${anim ? ` points-indicator--${anim}` : ""}`}
      aria-label={`${label}: ${balance}`}
      title={`${pointsText}: ${balance}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Star className="points-indicator__icon" size={15} aria-hidden="true" />
      <span className="points-indicator__value">{balance.toLocaleString()}</span>
    </div>
  );
}
