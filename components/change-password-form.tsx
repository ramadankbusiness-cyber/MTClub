"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";

export function ChangePasswordForm() {
  const t = useTranslations("site.changePassword");
  const { update } = useSession();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        newPassword: form.get("newPassword"),
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("error"));
      return;
    }
    const data = (await response.json().catch(() => null)) as { sessionTransition?: string | null } | null;
    if (data?.sessionTransition) {
      await update({ sessionTransition: data.sessionTransition });
    } else {
      await update();
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label>{t("current")}<input type="password" name="currentPassword" autoComplete="current-password" placeholder={t("current")} required /></label>
      <label>{t("new")}<input type="password" name="newPassword" autoComplete="new-password" minLength={12} placeholder={t("new")} required /></label>
      <p className="form-footnote">{t("rules")}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-large form-submit" disabled={busy}>{busy ? t("saving") : t("submit")}</button>
    </form>
  );
}
