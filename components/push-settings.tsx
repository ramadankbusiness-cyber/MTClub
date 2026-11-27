"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAppToast } from "@/components/app-toast-provider";

function decodeKey(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PushSettings() {
  const showToast = useAppToast();
  const t = useTranslations("site.notifications");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled && subscription) setEnabled(true);
      } catch {
        // Ignore status check failures; user can still attempt to enable.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function enablePush() {
    setBusy(true);
    setMessage("");
    try {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext) {
        setMessage(t("pushSecureContextRequired"));
        return;
      }
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPermission("unsupported");
        setMessage(t("pushUnsupported"));
        return;
      }

      const currentPermission = Notification.permission;
      setPermission(currentPermission);
      if (currentPermission === "denied") {
        setMessage(t("pushDeniedHelp"));
        return;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setMessage(t("pushNotConfiguredClient"));
        console.warn("[PushSettings] Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
        return;
      }

      // Request permission before any async service-worker work so the browser
      // still treats this as a direct user gesture.
      let permissionToUse: NotificationPermission = currentPermission;
      if (permissionToUse === "default") {
        try {
          permissionToUse = await Notification.requestPermission();
        } catch (error) {
          console.error("[PushSettings] Permission request failed", { name: (error as Error)?.name });
          const fallback = Notification.permission;
          setPermission(fallback);
          setMessage(fallback === "denied" ? t("pushDeniedHelp") : t("pushPermissionDismissed"));
          return;
        }
        setPermission(permissionToUse);
        if (permissionToUse === "denied") {
          setMessage(t("pushDeniedHelp"));
          return;
        }
        if (permissionToUse !== "granted") {
          setMessage(t("pushPermissionDismissed"));
          return;
        }
      }

      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      } catch (error) {
        console.error("[PushSettings] Service worker registration failed", { name: (error as Error)?.name });
        setMessage(t("pushServiceWorkerError"));
        return;
      }

      const existing = await registration.pushManager.getSubscription().catch(() => null);
      const subscription = existing ?? await (async () => {
        try {
          return await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodeKey(key) as BufferSource,
          });
        } catch (error) {
          console.error("[PushSettings] Push subscription failed", { name: (error as Error)?.name, message: (error as Error)?.message });
          throw new Error("push_subscribe_failed");
        }
      })();

      let response: Response;
      try {
        response = await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch (error) {
        console.error("[PushSettings] Subscription persistence request failed", { name: (error as Error)?.name });
        setMessage(t("pushPersistFailed"));
        return;
      }

      if (!response.ok) {
        let detail = "";
        try { const result = await response.json(); detail = typeof result?.error === "string" ? result.error : ""; } catch {}
        console.error("[PushSettings] Subscription persistence failed", { status: response.status, detail });
        setMessage(t("pushPersistFailed"));
        return;
      }

      setEnabled(true);
      setPermission(Notification.permission);
      setMessage(existing ? t("pushAlreadyEnabled") : t("pushEnabled"));
    } catch (error) {
      if ((error as Error)?.message === "push_subscribe_failed") {
        setMessage(t("pushSubscribeFailed"));
        return;
      }
      console.error("[PushSettings] Unexpected push enable failure", { name: (error as Error)?.name, message: (error as Error)?.message });
      const errorMessage = t("pushErrorGeneric");
      setMessage(errorMessage);
      showToast(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  const isAppleMobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = isStandaloneDisplay();
  const blocked = permission === "denied";

  return (
    <div className="push-settings">
      <button className="button button-secondary" type="button" onClick={() => void enablePush()} disabled={busy || enabled || permission === "unsupported"}>
        {busy ? t("pushEnabling") : enabled ? t("pushEnabled") : t("pushEnable")}
      </button>
      {isAppleMobile && !installed && <p className="empty-note">{t("pushIosInstallHint")}</p>}
      {blocked && !message && <p className="form-message" role="status">{t("pushDeniedHelp")}</p>}
      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  );
}
