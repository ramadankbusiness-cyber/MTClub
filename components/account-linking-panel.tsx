"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

function GoogleBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" focusable="false">
      <path fill="#4285F4" d="M23.49 12.27c0-.85-.07-1.64-.21-2.41H12v4.56h6.44a5.51 5.51 0 0 1-2.39 3.62v2.99h3.86c2.26-2.08 3.58-5.15 3.58-8.76Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.86-2.99c-1.07.72-2.44 1.15-4.09 1.15-3.15 0-5.82-2.13-6.77-4.99H1.24v3.09A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.23 14.26A7.21 7.21 0 0 1 4.86 12c0-.79.14-1.55.37-2.26V6.65H1.24A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.24 5.35l3.99-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.79l3.44-3.44C17.95 1.18 15.24 0 12 0 7.31 0 3.25 2.69 1.24 6.65l3.99 3.09c.95-2.86 3.62-4.99 6.77-4.99Z" />
    </svg>
  );
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" focusable="false" fill="currentColor">
      <path d="M21.94 4.43a1.5 1.5 0 0 0-1.54-.26L2.7 10.86a1.5 1.5 0 0 0 .1 2.82l4.56 1.5 1.77 5.46a1.5 1.5 0 0 0 2.56.56l2.47-2.94 4.56 3.35a1.5 1.5 0 0 0 2.35-.91l2.27-14.64a1.5 1.5 0 0 0-.4-1.63ZM9.27 14.33l8.26-6.7-6.57 7.93-.33 2.86-1.36-4.09Z" />
    </svg>
  );
}

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
            <button
              className="account-linking-provider-btn account-linking-google-btn"
              type="button"
              onClick={startGoogle}
              disabled={busy === "google"}
            >
              <span className="account-linking-provider-icon" aria-hidden="true"><GoogleBrandIcon /></span>
              <span className="account-linking-provider-label">{busy === "google" ? t("checking") : t("linkGoogle")}</span>
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
              <button
                className="account-linking-provider-btn account-linking-telegram-btn"
                type="button"
                onClick={() => void generateTelegramLink()}
                disabled={busy === "telegram"}
              >
                <span className="account-linking-provider-icon" aria-hidden="true"><TelegramBrandIcon /></span>
                <span className="account-linking-provider-label">{busy === "telegram" ? t("checking") : t("linkTelegram")}</span>
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
