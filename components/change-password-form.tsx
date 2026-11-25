"use client";

import React, { FormEvent, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, CheckCircle2, Circle } from "lucide-react";

function Requirement({ met, label }: { met: boolean; label: string }) {
  const Icon = met ? CheckCircle2 : Circle;
  return (
    <li className={`password-requirement${met ? " is-met" : ""}`}>
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations("site.changePassword");
  const { update } = useSession();
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const requirements = useMemo(() => ([
    { key: "length", met: newPassword.length >= 12, label: t("reqLength") },
    { key: "upper", met: /[A-Z]/.test(newPassword), label: t("reqUpper") },
    { key: "lower", met: /[a-z]/.test(newPassword), label: t("reqLower") },
    { key: "number", met: /[0-9]/.test(newPassword), label: t("reqNumber") },
  ]), [newPassword, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess(false);

    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const nextPassword = String(form.get("newPassword") ?? "");

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: nextPassword }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(typeof result.error === "string" && result.error ? result.error : t("error"));
        return;
      }

      const data = (await response.json().catch(() => null)) as { sessionTransition?: string | null } | null;
      setSuccess(true);
      if (data?.sessionTransition) {
        await update({ sessionTransition: data.sessionTransition });
      } else {
        await update();
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="change-password-form" onSubmit={submit} noValidate={false}>
      <div className="change-password-card">
        <div className="login-field">
          <label htmlFor="currentPassword">{t("current")}</label>
          <div className="login-input-wrap">
            <input
              id="currentPassword"
              type={showCurrent ? "text" : "password"}
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={busy}
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowCurrent((v) => !v)}
              aria-label={showCurrent ? t("hidePassword") : t("showPassword")}
              aria-pressed={showCurrent}
            >
              {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="login-field">
          <label htmlFor="newPassword">{t("new")}</label>
          <div className="login-input-wrap">
            <input
              id="newPassword"
              type={showNew ? "text" : "password"}
              name="newPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby="password-requirements"
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowNew((v) => !v)}
              aria-label={showNew ? t("hidePassword") : t("showPassword")}
              aria-pressed={showNew}
            >
              {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="password-requirements" id="password-requirements" aria-live="polite">
            <p className="password-requirements-title">{t("requirementsTitle")}</p>
            <ul className="password-requirements-list">
              {requirements.map((req) => <Requirement key={req.key} met={req.met} label={req.label} />)}
            </ul>
          </div>
        </div>

        {error && <p className="form-error change-password-feedback" role="alert">{error}</p>}
        {success && <p className="form-message change-password-feedback is-success" role="status">{t("success")}</p>}

        <button className="button button-primary button-large form-submit change-password-submit" disabled={busy}>
          {busy ? t("saving") : t("submit")}
        </button>
      </div>
    </form>
  );
}
