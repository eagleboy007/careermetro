"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { CertificateInput, CertificateResult } from "@/lib/proofs/result";

const input =
  "min-w-0 rounded-md border border-line bg-bg px-3 py-[9px] text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70";

export type CertificateOption = { id: string; name: string; issuer: string };

/**
 * "Add a certificate" for one goal (dev/proof-plan.md): only certificates that prove the goal's skill, the credential
 * ID, dates, the name as printed and the issuer's verify link. `onSave` is the server action; it checks everything
 * again. Without it (design page, example data) the form says nothing is saved.
 */
export function CertificateForm({
  goalId,
  goalName,
  certificates,
  renew = false,
  onSave,
  onCancel,
}: {
  goalId: string;
  goalName: string;
  certificates: CertificateOption[];
  renew?: boolean;
  onSave?: (input: CertificateInput) => Promise<CertificateResult>;
  /** Closes the form; without it there is no Cancel button (design page). */
  onCancel?: () => void;
}) {
  const id = useId();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CertificateResult | null>(null);
  const [expires, setExpires] = useState(true);
  const [issued, setIssued] = useState("");
  const done = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const badField = result?.status === "invalid" ? result.field : undefined;
  /** Marks the input the last error is about and ties the message to it. */
  const field = (name: string) =>
    badField === name
      ? { "aria-invalid": true as const, "aria-describedby": `${id}-result` }
      : {};

  // The form is replaced by the result; move focus to it so the Save button's focus isn't lost and it is read out.
  useEffect(() => {
    if (result?.status === "filled") done.current?.focus();
    if (badField)
      formRef.current
        ?.querySelector<HTMLElement>(`[name="${badField}"]`)
        ?.focus();
  }, [result, badField]);

  function submit(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? "").trim();
    const data: CertificateInput = {
      goalId,
      certId: text("certId"),
      credentialId: text("credentialId"),
      issuedOn: text("issuedOn"),
      expiresOn: expires ? text("expiresOn") || null : null,
      nameOnCertificate: text("nameOnCertificate"),
      url: text("url"),
      confirmed: form.get("confirmed") === "on",
    };
    if (!onSave) {
      setResult({
        status: "refused",
        message: "This is example data, so nothing is saved.",
      });
      return;
    }
    start(async () => setResult(await onSave(data)));
  }

  if (result?.status === "filled") {
    return (
      <div
        ref={done}
        tabIndex={-1}
        role="status"
        className="flex flex-col gap-1 rounded-[14px] bg-good-soft px-3 py-2.5 text-[0.86rem] focus:outline-2 focus:outline-accent"
      >
        <b className="font-semibold">
          {goalName} is proved. Your train moves to the next stop.
        </b>
        <span className="text-[0.8rem] text-muted">
          {result.label === "verified"
            ? "Verified: the issuer confirmed this certificate."
            : "Uploaded: we have your verify link, but couldn't check it with the issuer yet. It still fills the goal."}
        </span>
      </div>
    );
  }

  const error = result && result.status !== "held" ? result.message : null;
  return (
    <form
      ref={formRef}
      // onSubmit, not action: a form action resets every field after it runs, which would empty the form on a refusal.
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      aria-label={`Add a certificate for ${goalName}`}
      className="flex flex-col gap-3 rounded-[14px] bg-surface-2 px-3 py-3"
    >
      {renew && (
        <p className="text-[0.84rem]">
          Your certificate has expired. Add the renewed one to fill the gap
          again.
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-cert`} className="text-[0.82rem] font-semibold">
          Certificate
        </label>
        <select
          id={`${id}-cert`}
          name="certId"
          {...field("certId")}
          required
          defaultValue=""
          className={input}
        >
          <option value="" disabled>
            Pick the certificate
          </option>
          {certificates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.issuer})
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">Credential ID</span>
          <input
            name="credentialId"
            {...field("credentialId")}
            required
            minLength={3}
            maxLength={120}
            autoComplete="off"
            className={input}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">
            Your name as printed
          </span>
          <input
            name="nameOnCertificate"
            {...field("nameOnCertificate")}
            required
            maxLength={120}
            autoComplete="name"
            className={input}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">Date issued</span>
          <input
            name="issuedOn"
            {...field("issuedOn")}
            type="date"
            required
            // Today in India, like the server, read when the field is used: the page can be prerendered, where reading the clock isn't allowed.
            onFocus={(e) =>
              (e.currentTarget.max = new Date().toLocaleDateString("en-CA", {
                timeZone: "Asia/Kolkata",
              }))
            }
            value={issued}
            onChange={(e) => setIssued(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[0.82rem] font-semibold">Expiry date</span>
          <input
            name="expiresOn"
            {...field("expiresOn")}
            type="date"
            required={expires}
            disabled={!expires}
            min={issued || undefined}
            className={input}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[0.84rem]">
        <input
          type="checkbox"
          checked={!expires}
          onChange={(e) => setExpires(!e.target.checked)}
          className="size-4 accent-ink"
        />
        It never expires
      </label>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[0.82rem] font-semibold">Verify link</span>
        <input
          name="url"
          type="url"
          required
          maxLength={500}
          placeholder="https://www.credly.com/badges/…"
          aria-invalid={badField === "url" ? true : undefined}
          aria-describedby={
            badField === "url" ? `${id}-result ${id}-url` : `${id}-url`
          }
          className={input}
        />
        <small id={`${id}-url`} className="text-[0.78rem] text-muted">
          From Credly, Microsoft Learn, AWS, Coursera or the issuer&apos;s own
          verify page.
        </small>
      </label>
      <label className="flex items-start gap-2 text-[0.84rem]">
        <input
          name="confirmed"
          {...field("confirmed")}
          type="checkbox"
          required
          className="mt-0.5 size-4 accent-ink"
        />
        This certificate is mine and the details are true.
      </label>
      <p
        id={`${id}-result`}
        role="status"
        className={`text-[0.84rem] ${error ? "text-bad" : result?.status === "held" ? "text-ink" : "sr-only"}`}
      >
        {error ?? (result?.status === "held" ? result.message : "")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-accent px-3.5 py-1.5 text-[0.84rem] font-medium text-on-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save certificate"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[0.84rem] font-semibold"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
