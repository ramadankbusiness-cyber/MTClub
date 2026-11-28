"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";

export function ProfileForm({ initialName, email, initialPhone, initialPhoto, initialDateOfBirth = "" }: { initialName: string; email: string; initialPhone: string | null; initialPhoto: string | null; initialDateOfBirth?: string }) {
  const t = useTranslations("site.pages.profileForm");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth);
  const [photoUrl, setPhotoUrl] = useState(initialPhoto);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: phone || null, dateOfBirth: dateOfBirth || null }),
    });
    const result = await response.json();
    setMessage(response.ok ? t("saved") : result.error ?? t("saveError"));
    setBusy(false);
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    const data = new FormData();
    data.set("photo", file);
    const response = await fetch("/api/profile/photo", { method: "POST", body: data });
    const result = await response.json();
    if (response.ok) {
      setPhotoUrl(result.photoUrl);
      setMessage(t("photoUpdated"));
    } else {
      setMessage(result.error ?? t("photoError"));
    }
    setBusy(false);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const result = await response.json();
    setMessage(response.ok ? t("passwordUpdated") : result.error ?? t("passwordError"));
    if (response.ok) {
      setCurrentPassword("");
      setNewPassword("");
    }
    setBusy(false);
  }

  return (
    <div className="profile-layout">
      <form className="team-edit-form profile-form" onSubmit={saveProfile}>
        <h2>{t("details")}</h2>
        <div className="profile-photo-row"><div className="profile-photo">{photoUrl ? <Image src={photoUrl} alt={t("yourProfile")} fill sizes="88px" unoptimized /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div><label>{t("profilePhoto")}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void uploadPhoto(event.target.files?.[0])} /><small>{t("photoHint")}</small></label></div>
        <label>{t("name")}<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required /></label>
        <label>{t("email")}<input value={email} readOnly /></label>
        <label>{t("phone")}<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} /></label>
        <label>{t("dateOfBirth")}<input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} max={new Date().toISOString().slice(0,10)} /><small>{t("dateOfBirthHint")}</small></label>
        <button className="button button-primary" type="submit" disabled={busy}>{t("save")}</button>
      </form>
      <form className="team-edit-form profile-form" onSubmit={changePassword}>
        <h2>{t("password")}</h2>
        <label>{t("currentPassword")}<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
        <label>{t("newPassword")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required /><small>{t("passwordHint")}</small></label>
        <button className="button button-primary" type="submit" disabled={busy}>{t("updatePassword")}</button>
      </form>
      {message && <p className="form-message profile-message" role="status">{message}</p>}
    </div>
  );
}
