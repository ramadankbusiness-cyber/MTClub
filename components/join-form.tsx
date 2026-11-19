"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";
import { committeeDetails, type ClubCommittee } from "@/data/committees";
import { joinApplicationSchema } from "@/lib/schemas";
import { useSite } from "./site-provider";
import { useAppToast } from "@/components/app-toast-provider";
import { CommitteeSelect } from "@/components/committee-select";

type FormFields = { name: string; email: string; academicNumber: string; committees: ClubCommittee[]; message: string };
const initialForm: FormFields = { name: "", email: "", academicNumber: "", committees: [], message: "" };

export function JoinForm() {
  const { text, language } = useSite();
  const showToast = useAppToast();
  const [form, setForm] = useState<FormFields>(initialForm);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    const parsed = joinApplicationSchema.safeParse(form);
    if (!parsed.success) {
      const committeeIssue = parsed.error.issues.some((issue) => issue.path[0] === "committees");
      const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === "email");
      const academicIssue = parsed.error.issues.some((issue) => issue.path[0] === "academicNumber");
      setErrorMessage(
        academicIssue ? (text.join.academicRequired ?? text.join.required) :
        emailIssue ? text.join.invalidEmail :
        committeeIssue ? text.join.committeeLimit :
        text.join.required,
      );
      return;
    }
    if (parsed.data.committees.length < 1 || parsed.data.committees.length > 3) {
      setErrorMessage(text.join.committeeLimit);
      return;
    }

    setStatus("sending");
    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) throw new Error("Join request failed");
      setForm(initialForm);
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage(text.join.error);
      showToast(text.join.error);
    }
  }

  function removeCommittee(value: ClubCommittee) {
    setForm((current) => ({ ...form, committees: current.committees.filter((committee) => committee !== value) }));
  }

  function update(field: "name" | "email" | "academicNumber" | "message", value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  if (status === "success") {
    return <div className="success-panel" role="status"><span className="success-mark" aria-hidden="true">✓</span><h2>{text.join.successTitle}</h2><p>{text.join.successText}</p></div>;
  }

  return (
    <form className="join-form" onSubmit={handleSubmit} noValidate>
      <label>{text.join.name}<input autoComplete="name" name="name" value={form.name} onChange={(event) => update("name", event.target.value)} required maxLength={100} /></label>
      <label>{text.join.email}<input autoComplete="email" name="email" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required maxLength={254} /></label>
      <label>{text.join.academicNumber ?? "Academic number"}<input autoComplete="off" name="academicNumber" type="text" value={form.academicNumber} onChange={(event) => update("academicNumber", event.target.value)} required maxLength={64} /></label>
      <div className="join-committee-field">
        <label htmlFor="join-committee">{text.join.interest}</label>
        <CommitteeSelect
          id="join-committee"
          mode="multi"
          valueField="name"
          value={form.committees as string[]}
          onChange={(v) => setForm({ ...form, committees: v as ClubCommittee[] })}
          required={form.committees.length === 0}
          placeholder={text.join.select}
        />
        <span className="join-committee-hint" id="join-committee-hint">{text.join.committeeHint}</span>
        {!!form.committees.length && <ul className="join-committee-pills" aria-label={text.committeeUi.selected}>
          {form.committees.map((committee) => {
            const detail = committeeDetails[committee];
            const label = language === "ar" ? detail?.nameAr ?? committee : committee;
            return (
              <li key={committee}>
                <span>{label}</span>
                <button type="button" aria-label={text.committeeUi.remove.replace("{committee}", committee)} onClick={() => removeCommittee(committee)}><X size={14} aria-hidden="true" /></button>
              </li>
            );
          })}
        </ul>}
      </div>
      <label>{text.join.message}<textarea name="message" rows={5} value={form.message} onChange={(event) => update("message", event.target.value)} placeholder={text.join.messageHint} required maxLength={2000} /></label>
      {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      <button className="button button-primary button-large form-submit" type="submit" disabled={status === "sending"}>
        {status === "sending" ? text.join.submitting : text.join.submit}<span aria-hidden="true">{language === "ar" ? "↖" : "↗"}</span>
      </button>
    </form>
  );
}
