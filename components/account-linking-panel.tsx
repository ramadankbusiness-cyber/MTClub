"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type Status = {
  googleLinked: boolean;
  googleEmail?: string | null;
  telegramLinked: boolean;
  telegramUsername?: string | null;
  complete: boolean;
};

export function AccountLinkingPanel({ locale, initialStatus, googleStatus }: { locale: string; initialStatus: Status; googleStatus?: string }) {
  const t = useTranslations("site.accountLinking");
  const { update } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState<"google" | "telegram" | "refresh" | null>(null);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const googleMessage = useMemo(() => {
    if (!googleStatus) return "";
    const map: Record<string, string> = {
      linked: "",
      cancelled: t("googleCancelled"),
      failed: t("googleFailed"),
      invalid_state: t("googleInvalidState"),
      already_linked: t("googleAlreadyLinked"),
      already_linked_self: t("googleAlreadyLinkedSelf"),
      not_configured: t("googleNotConfigured"),
    };
    return map[googleStatus] ?? t("googleFailed");
  }, [googleStatus, t]);

  useEffect(() => {
    if (googleMessage) setError(googleMessage);
  }, [googleMessage]);

  const refreshStatus = useCallback(async (silent = false) => {
    if (!silent) setBusy("refresh");
    try {
      const res = await fetch("/api/account-linking/status", { cache: "no-store" });
      if (!res.ok) throw new Error("status");
      const data = await res.json() as Status;
      setStatus(data);
      if (data.complete) {
        setMessage(t("allLinked"));
        setError("");
        await update();
        router.replace("/dashboard");
        router.refresh();
      }
      return data;
    } catch {
      if (!silent) setError(t("statusRefreshFailed"));
      return null;
    } finally {
      if (!silent) setBusy(null);
    }
  }, [router, t, update]);

  useEffect(() => {
    if (status.complete || status.telegramLinked) return;
    const id = window.setInterval(() => { void refreshStatus(true); }, 5000);
    return () => window.clearInterval(id);
  }, [refreshStatus, status.complete, status.telegramLinked]);

  useEffect(() => {
    if (googleStatus === "linked") {
      void refreshStatus(true);
    }
  }, [googleStatus, refreshStatus]);

  async function generateTelegramLink() {
    setBusy("telegram");
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/account-linking/telegram/token", { method: "POST" });
      const data = await res.json().catch(() => null) as { deepLink?: string; error?: string } | null;
      if (!res.ok || !data?.deepLink) {
        if (res.status === 503) setError(t("telegramNotConfigured"));
        else setError(t("telegramTokenFailed"));
        return;
      }
      setTelegramDeepLink(data.deepLink);
      setMessage(t("telegramLinkReady"));
    } catch {
      setError(t("telegramTokenFailed"));
    } finally {
      setBusy(null);
    }
  }

  function startGoogle() {
    setBusy("google");
    setError("");
    setMessage("");
    const returnTo = `/${locale}/account-linking`;
    window.location.href = `/api/account-linking/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  }

  const missingText = !status.googleLinked && !status.telegramLinked ? t("missingBoth")
    : !status.googleLinked ? t("missingGoogle")
    : !status.telegramLinked ? t("missingTelegram")
    : t("allLinked");

  return (
    <div className="account-linking-shell">
      <div className={`account-linking-banner ${status.complete ? "is-complete" : "is-warning"}`} role="status" aria-live="polite">
        <strong>{missingText}</strong>
        <span>{t("lockedNotice")}</span>
      </div>

      {error && <p className="form-message account-linking-message is-error" role="alert">{error}</p>}
      {message && <p className="form-message account-linking-message is-success" role="status">{message}</p>}

      <div className="account-linking-grid">
        <article className={`account-linking-card ${status.googleLinked ? "is-linked" : "is-missing"}`}>
          <div className="account-linking-card-head">
            <div>
              <p className="eyebrow">Google</p>
              <h2>{t("googleTitle")}</h2>
            </div>
            <span className={`account-linking-state ${status.googleLinked ? "is-linked" : "is-missing"}`}>
              {status.googleLinked ? t("linked") : t("notLinked")}
            </span>
          </div>
          <p className="account-linking-desc">{t("googleDesc")}</p>
          {status.googleLinked ? (
            <p className="account-linking-detail">{status.googleEmail ? t("googleLinkedAs", { email: status.googleEmail }) : t("linked")}</p>
          ) : (
            <button className="button button-primary" type="button" onClick={startGoogle} disabled={busy === "google"}>
              {busy === "google" ? t("checking") : t("linkGoogle")}
            </button>
          )}
        </article>

        <article className={`account-linking-card ${status.telegramLinked ? "is-linked" : "is-missing"}`}>
          <div className="account-linking-card-head">
            <div>
              <p className="eyebrow">Telegram</p>
              <h2>{t("telegramTitle")}</h2>
            </div>
            <span className={`account-linking-state ${status.telegramLinked ? "is-linked" : "is-missing"}`}>
              {status.telegramLinked ? t("linked") : t("notLinked")}
            </span>
          </div>
          <p className="account-linking-desc">{t("telegramDesc")}</p>
          {status.telegramLinked ? (
            <p className="account-linking-detail">
              {status.telegramUsername ? t("telegramLinkedAs", { username: status.telegramUsername }) : t("linked")}
            </p>
          ) : (
            <div className="account-linking-actions">
              <button className="button button-primary" type="button" onClick={() => void generateTelegramLink()} disabled={busy === "telegram"}>
                {busy === "telegram" ? t("checking") : t("linkTelegram")}
              </button>
              {telegramDeepLink && (
                <a className="button button-secondary" href={telegramDeepLink} target="_blank" rel="noopener noreferrer">
                  {t("openTelegram")}
                </a>
              )}
            </div>
          )}
          {!status.telegramLinked && telegramDeepLink && <p className="account-linking-detail">{t("telegramAwaiting")}</p>}
        </article>
      </div>

      <div className="account-linking-footer">
        <button className="button button-secondary" type="button" onClick={() => void refreshStatus()} disabled={busy === "refresh"}>
          {busy === "refresh" ? t("checking") : t("refreshStatus")}
        </button>
        {status.complete && (
          <button className="button button-primary" type="button" onClick={() => { void refreshStatus(); }}>
            {t("continue")}
          </button>
        )}
      </div>

      <section className="account-linking-why">
        <h2>{t("whyTitle")}</h2>
        <p>{t("whyBody")}</p>
      </section>
    </div>
  );
}
