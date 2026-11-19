"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type DbCommittee = {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  type?: string;
};

export type CommitteeSelectValue = string | string[] | null;

interface CommitteeSelectProps {
  committees?: DbCommittee[];
  value: CommitteeSelectValue;
  onChange: (value: CommitteeSelectValue) => void;
  mode?: "single" | "multi";
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  showAll?: boolean;
  allLabel?: string;
  valueField?: "id" | "key" | "name";
  name?: string;
  id?: string;
  autoFocus?: boolean;
  includeMTC?: boolean;
  maxSelections?: number;
}

export function CommitteeSelect({
  committees: committeesProp,
  value,
  onChange,
  mode = "single",
  placeholder,
  disabled = false,
  required = false,
  showAll = false,
  allLabel,
  valueField = "id",
  name,
  id,
  autoFocus,
  includeMTC = false,
  maxSelections,
}: CommitteeSelectProps) {
  const t = useTranslations("site");
  const locale = useLocale();
  const [committees, setCommittees] = useState<DbCommittee[]>(committeesProp ?? []);
  const [loading, setLoading] = useState(!committeesProp || committeesProp.length === 0);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const fetchCommittees = (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    setError("");
    fetch(`/api/committees${includeMTC ? "?includeMTC=true" : ""}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load committees");
        return r.json();
      })
      .then((data) => {
        if (cancelledRef?.current) return;
        setCommittees(Array.isArray(data?.committees) ? data.committees : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelledRef?.current) return;
        if (committeesProp && committeesProp.length > 0) {
          setCommittees(committeesProp);
          setError("");
        } else {
          setError(t("committeeUi.loadFailed"));
        }
        setLoading(false);
      });
  };

  useEffect(() => {
    if (committeesProp && committeesProp.length > 0) {
      setCommittees(committeesProp);
      setLoading(false);
      setError("");
      return;
    }
    const cancelled = { current: false };
    fetchCommittees(cancelled);
    return () => {
      cancelled.current = true;
    };
  }, [committeesProp, includeMTC, t]);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const retryLoad = () => fetchCommittees();

  const labelFor = (c: DbCommittee) => {
    if (c.key === "mtc") return "MTC";
    return locale === "ar" ? c.nameAr : c.name;
  };

  const mtc = committees.find((c) => c.key === "mtc");
  const regular = committees.filter((c) => c.key !== "mtc");
  const valueArray = mode === "multi" ? (Array.isArray(value) ? value : value ? [String(value)] : []) : [];
  const currentSingle = value === null || value === undefined ? "" : String(value);

  const regularOptions = useMemo(() => regular.map((c) => ({ value: c[valueField] as string, label: labelFor(c) })), [regular, valueField, locale]);
  const mtcOption = mtc ? { value: mtc[valueField] as string, label: labelFor(mtc) } : null;
  const allOptions = [...(includeMTC && mtcOption ? [mtcOption] : []), ...regularOptions];
  const selectedLabels = valueArray.map((v) => allOptions.find((o) => o.value === v)?.label ?? v);

  const handleSingleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value);
  };

  const toggleMultiValue = (optionValue: string) => {
    const selected = valueArray.includes(optionValue);
    if (selected) {
      onChange(valueArray.filter((v) => v !== optionValue));
      return;
    }
    const limit = maxSelections ?? 3;
    if (valueArray.length >= limit) return;
    onChange([...valueArray, optionValue]);
  };

  if (error) {
    return (
      <div className="committee-select-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={retryLoad}>
          {t("committeeUi.retry")}
        </button>
      </div>
    );
  }

  if (!loading && committees.length === 0) {
    return (
      <div className="committee-select-empty" role="status">
        <p>{t("committeeUi.empty")}</p>
        <button type="button" onClick={retryLoad}>
          {t("committeeUi.retry")}
        </button>
      </div>
    );
  }

  if (mode === "single") {
    return (
      <label className="committee-select-wrap" data-testid="committee-select">
        {placeholder && <span className="committee-select-placeholder">{placeholder}</span>}
        <select
          id={id}
          name={name}
          value={currentSingle}
          onChange={handleSingleChange}
          disabled={disabled || loading}
          required={required && !loading}
          autoFocus={autoFocus}
          dir={locale === "ar" ? "rtl" : "ltr"}
        >
          {showAll && <option value="">{allLabel ?? t("committeeUi.all")}</option>}
          {!showAll && !currentSingle && <option value="" disabled hidden>{placeholder ?? t("committeeUi.chooseCommittee")}</option>}
          {includeMTC && mtc && (
            <optgroup label={locale === "ar" ? "هيدات النادي" : "Club heads"}>
              <option value={mtc[valueField] as string}>{labelFor(mtc)}</option>
            </optgroup>
          )}
          {regularOptions.length > 0 && (includeMTC && mtc
            ? <optgroup label={locale === "ar" ? "اللجان" : "Committees"}>{regularOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>
            : regularOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)
          )}
        </select>
        {loading && <span className="committee-select-loading">{t("committeeUi.loading")}</span>}
      </label>
    );
  }

  const limit = maxSelections ?? 3;
  const triggerLabel = selectedLabels.length
    ? selectedLabels.join(locale === "ar" ? "، " : ", ")
    : (placeholder ?? t("committeeUi.chooseCommittee"));

  return (
    <div className="committee-select-wrap committee-select-dropdown" data-testid="committee-select" ref={rootRef}>
      <button
        id={id}
        type="button"
        className="committee-select-trigger"
        onClick={() => !disabled && !loading && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || loading}
        disabled={disabled || loading}
      >
        <span className={`committee-select-trigger-label${selectedLabels.length ? "" : " is-placeholder"}`}>{triggerLabel}</span>
        <span className="committee-select-trigger-caret" aria-hidden="true">▾</span>
      </button>
      <input
        tabIndex={-1}
        aria-hidden="true"
        className="committee-select-hidden-input"
        name={name}
        value={valueArray.join(",")}
        onChange={() => undefined}
        required={required && valueArray.length === 0}
      />
      {open && (
        <div className="committee-select-menu" role="listbox" aria-multiselectable="true" dir={locale === "ar" ? "rtl" : "ltr"}>
          <p className="committee-select-menu-hint">{t("committeeUi.chooseLimit")}</p>
          {includeMTC && mtcOption && (
            <button
              type="button"
              role="option"
              aria-selected={valueArray.includes(mtcOption.value)}
              className={`committee-select-option${valueArray.includes(mtcOption.value) ? " is-selected" : ""}`}
              disabled={!valueArray.includes(mtcOption.value) && valueArray.length >= limit}
              onClick={() => toggleMultiValue(mtcOption.value)}
            >
              <span>{mtcOption.label}</span>
              <span className="committee-select-check" aria-hidden="true">{valueArray.includes(mtcOption.value) ? "✓" : ""}</span>
            </button>
          )}
          {regularOptions.map((option) => {
            const selected = valueArray.includes(option.value);
            const atLimit = !selected && valueArray.length >= limit;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`committee-select-option${selected ? " is-selected" : ""}${atLimit ? " is-disabled" : ""}`}
                disabled={atLimit}
                onClick={() => toggleMultiValue(option.value)}
              >
                <span>{option.label}</span>
                <span className="committee-select-check" aria-hidden="true">{selected ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      )}
      {loading && <span className="committee-select-loading">{t("committeeUi.loading")}</span>}
    </div>
  );
}
