"use client";

import { Building2, Check, Mail, PenLine, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { CompanyPageDetails, CorporateActions, OrgType, SignupDetails } from "@/lib/corporate/types";
import { DOMAIN_TAKEN_TEXT, ORG_ABOUT_MAX_CHARS, ORG_INDUSTRIES, ORG_SIZES, ORG_TYPE_LABELS, ORG_TYPES } from "@/lib/schemas/constants";
import { AntiScamLine, fieldClass, ghostSm, hintClass, ICON, inputClass, labelClass, TestCodeBox } from "./parts";

const STEPS = ["Company", "Verify", "Company page", "Review"] as const;

const EMPTY: SignupDetails = { type: "company", legalName: "", name: "", website: "", workEmail: "", size: "", city: "" };
const EMPTY_PAGE: CompanyPageDetails = { about: "", industry: "", offices: "", gstinOrCin: "" };

/**
 * Organization sign-up (handoff 12f, C8): Company, Verify, Company page, Review. The person becomes the company's
 * first Recruiter admin; their own account stays hidden from it. Without `actions` (the /design page) nothing is sent.
 */
export function OrgSignupForm({ actions, firstName, initial = EMPTY, startAt = 0 }: { actions?: CorporateActions; firstName?: string; initial?: SignupDetails; startAt?: number }) {
  const [step, setStep] = useState(startAt);
  const rootRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(startAt);
  // A new step replaces the form that had focus: move focus to the new step's heading, or the step itself. The code
  // step focuses its own field.
  useEffect(() => {
    if (step === shownStep.current) return;
    shownStep.current = step;
    if (step === 1) return;
    const card = rootRef.current?.querySelector<HTMLElement>("[data-step]");
    const target = card?.querySelector<HTMLElement>("h2, h3") ?? card;
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  }, [step]);
  const [details, setDetails] = useState<SignupDetails>(initial);
  const [page, setPage] = useState<CompanyPageDetails>(EMPTY_PAGE);
  const [testCode, setTestCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [secondAdmin, setSecondAdmin] = useState("");
  const [invited, setInvited] = useState(false);
  const [pending, start] = useTransition();
  const errorId = useId();
  const domain = details.workEmail.split("@")[1]?.trim().toLowerCase() ?? "";

  const set = (key: keyof SignupDetails) => (e: { target: { value: string } }) => setDetails((d) => ({ ...d, [key]: e.target.value }));
  const setP = (key: keyof CompanyPageDetails) => (e: { target: { value: string } }) => setPage((p) => ({ ...p, [key]: e.target.value }));
  const run = (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    start(fn);
  };

  const sendCode = () =>
    run(async () => {
      if (!actions) return;
      const r = await actions.startSignup(details);
      if (!r.ok) {
        setTaken(!!r.taken);
        setError(r.error);
        return;
      }
      setTaken(false);
      setTestCode(r.testCode ?? null);
      setCode("");
      setStep(1);
    });

  const verify = () =>
    run(async () => {
      if (!actions) return;
      const r = await actions.finishSignup(details, code);
      if (!r.ok) return setError(r.error);
      setTestCode(null);
      setStep(2);
    });

  const ask = () =>
    run(async () => {
      if (!actions) return;
      const r = await actions.askForAccess(details.workEmail);
      if (!r.ok) return setError(r.error);
      setTaken(false);
      setNotice("Request sent to the company's Recruiter admins. Once one of them gives you a role, open Corporate and confirm your work email.");
    });

  const invite = () =>
    run(async () => {
      if (!actions) return;
      const message = await actions.inviteAdmin(secondAdmin);
      if (message) return setError(message);
      setInvited(true);
      setNotice("Access is waiting for them. They sign in with their own CareerMetro account, open Corporate and confirm this work email with a code.");
    });

  const sendForReview = () =>
    run(async () => {
      if (!actions) return;
      const message = await actions.savePage(page);
      if (message) return setError(message);
      setStep(3);
    });

  const errorBox = error && (
    <p id={errorId} role="alert" className="text-sm text-bad">
      {taken ? DOMAIN_TAKEN_TEXT : error}
    </p>
  );
  const described = error ? errorId : undefined;

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">For employers · free during the beta</span>
        <h1 className="mt-1.5 text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Set up your company on CareerMetro</h1>
        <p className="mt-1.5 text-[0.95rem] text-muted">You become its first Recruiter admin. Your own CareerMetro account stays as it is, and your company never sees it.</p>
      </div>

      <ol aria-label="Steps" className="grid grid-cols-4 gap-2">
        {STEPS.map((name, i) => (
          <li key={name} aria-current={i === step ? "step" : undefined} className="flex flex-col gap-1.5">
            <span className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} aria-hidden="true" />
            <span className={`text-[0.74rem] font-medium ${i === step ? "text-ink" : "text-muted"}`}>
              {name}
              {i < step && <span className="sr-only">, done</span>}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card label="Step 1 of 4">
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[0.82rem] font-semibold">This is a</legend>
              <div className="flex flex-wrap gap-2">
                {ORG_TYPES.map((t) => (
                  <label key={t} className={`${ghostSm} cursor-pointer has-[:checked]:bg-surface-2 has-[:checked]:font-semibold`}>
                    <input type="radio" name="type" value={t} checked={details.type === t} onChange={() => setDetails((d) => ({ ...d, type: t as OrgType }))} className="accent-ink" />
                    {ORG_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Row>
              <label className={labelClass}>
                Registered name
                <input name="legalName" value={details.legalName} onChange={set("legalName")} required maxLength={160} className={fieldClass} aria-describedby={described} />
                <span className={hintClass}>As on your incorporation or GST papers.</span>
              </label>
              <label className={labelClass}>
                Name candidates see
                <input name="name" value={details.name} onChange={set("name")} required maxLength={80} className={fieldClass} aria-describedby={described} />
              </label>
            </Row>
            <Row>
              <label className={labelClass}>
                Website
                <input name="website" value={details.website} onChange={set("website")} required inputMode="url" placeholder="https://" maxLength={200} className={fieldClass} aria-describedby={described} />
              </label>
              <label className={labelClass}>
                Your work email
                <input name="workEmail" type="email" autoComplete="email" value={details.workEmail} onChange={set("workEmail")} required maxLength={254} className={fieldClass} aria-describedby={described} />
                <span className={hintClass}>On your company&apos;s domain. Gmail and other personal addresses can&apos;t confirm a company.</span>
              </label>
            </Row>
            <Row>
              <label className={labelClass}>
                Company size
                <select name="size" value={details.size} onChange={set("size")} required className={fieldClass}>
                  <option value="">Choose</option>
                  {ORG_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Head office city
                <input name="city" value={details.city} onChange={set("city")} required maxLength={60} className={fieldClass} aria-describedby={described} />
              </label>
            </Row>
            {errorBox}
            {taken && (
              <div>
                <button type="button" onClick={ask} disabled={pending || !actions} className={ghostSm}>
                  <Send {...ICON} />
                  Ask for access
                </button>
              </div>
            )}
            {notice && (
              <p role="status" className="text-sm text-muted">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || !actions}>
                <Mail {...ICON} />
                Continue
              </Button>
              <span className="text-[0.82rem] text-muted">Next we send a code to your work email.</span>
            </div>
          </form>
        </Card>
      )}

      {step === 1 && (
        <Card label={`Step 2 of 4 · verify ${domain}`}>
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <h2 className="text-[1.1rem] font-semibold [overflow-wrap:anywhere]">Enter the code we sent to {details.workEmail}</h2>
            <p className="text-[0.86rem] text-muted">It works for 10 minutes. After 5 wrong tries, wait 15 minutes and send a new one.</p>
            {testCode && <TestCodeBox code={testCode} />}
            <label className={labelClass}>
              Code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={described}
                className={`${fieldClass} max-w-[220px] font-mono text-lg tracking-[0.3em]`}
              />
            </label>
            {errorBox}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || !actions}>
                Verify
              </Button>
              <button type="button" onClick={sendCode} disabled={pending} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
                Send a new code
              </button>
              <button type="button" onClick={() => setStep(0)} disabled={pending} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
                Change details
              </button>
            </div>
            <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.84rem] text-muted">
              Once the domain is verified, anyone you add later confirms with a code to their own <b className="font-semibold text-ink">@{domain}</b> email. Personal email addresses never get Corporate access.
            </p>
          </form>
        </Card>
      )}

      {step === 2 && (
        <Card label="Step 3 of 4 · company page">
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              sendForReview();
            }}
          >
            <p className="text-[0.86rem] text-muted">All optional. You can change these later. A logo comes with the company profile page.</p>
            <label className={labelClass}>
              About the company
              <textarea name="about" value={page.about} onChange={setP("about")} maxLength={ORG_ABOUT_MAX_CHARS} rows={3} className={fieldClass} />
              <span className={hintClass}>
                Up to {ORG_ABOUT_MAX_CHARS} characters ({ORG_ABOUT_MAX_CHARS - page.about.length} left). Candidates read this on every job.
              </span>
            </label>
            <Row>
              <label className={labelClass}>
                Industry
                <select name="industry" value={page.industry} onChange={setP("industry")} className={fieldClass}>
                  <option value="">Choose</option>
                  {ORG_INDUSTRIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Offices
                <input name="offices" value={page.offices} onChange={setP("offices")} maxLength={120} placeholder="Pune, Bengaluru" className={fieldClass} />
              </label>
            </Row>
            <label className={labelClass}>
              <span>
                GSTIN or CIN <span className="font-normal text-muted">(optional)</span>
              </span>
              <input name="gstinOrCin" value={page.gstinOrCin} onChange={setP("gstinOrCin")} maxLength={24} className={`${fieldClass} font-mono`} />
              <span className={hintClass}>Helps us check the company faster. Never shown to anyone.</span>
            </label>
            <div className={labelClass}>
              <label htmlFor="second-admin">Invite a second Recruiter admin</label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="second-admin"
                  type="email"
                  value={secondAdmin}
                  onChange={(e) => setSecondAdmin(e.target.value)}
                  placeholder={`name@${domain}`}
                  disabled={invited}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button type="button" onClick={invite} disabled={pending || invited || !secondAdmin.trim() || !actions} className={ghostSm}>
                  {invited ? <Check {...ICON} /> : <Send {...ICON} />}
                  {invited ? "Invited" : "Send invite"}
                </button>
              </div>
              <span className={hintClass}>Every company keeps at least two admins so it is never locked out. You have 14 days.</span>
            </div>
            {errorBox}
            {notice && (
              <p role="status" className="text-sm text-muted">
                {notice}
              </p>
            )}
            <div>
              <Button type="submit" disabled={pending || !actions}>
                Send for review
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 3 && (
        <Card label="Step 4 of 4">
          <h2 className="text-[1.15rem] font-semibold">Thanks{firstName ? `, ${firstName}` : ""}. We check every new company by hand before its jobs go live.</h2>
          <ul className="flex flex-col gap-2.5">
            <Tick done title="Domain verified" detail={`${domain}, by code to your work email`} />
            <Tick done={!!(page.about || page.industry || page.offices)} title="Company page" detail={page.about || page.industry || page.offices ? "Shown to candidates after review" : "Not added yet. You can add it from Corporate."} />
            <Tick done={invited} title="Second Recruiter admin" detail={invited ? "Invited. They confirm with a code to their work email." : "Not invited yet · needed within 14 days"} />
            <Tick done={false} title="Review by CareerMetro" detail="We check the company exists, the domain belongs to it and you work there" />
          </ul>
          <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.84rem] text-muted">
            <PenLine {...ICON} className="mt-0.5 shrink-0" />
            While you wait, you can set up your team. Jobs go live after the review.
          </p>
          <AntiScamLine />
          <div>
            <Link href="/corporate" className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90">
              <Building2 {...ICON} />
              Open Corporate
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section data-step aria-label={label} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 focus:outline-none min-[760px]:p-6">
      <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">{label}</span>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 min-[640px]:grid-cols-2">{children}</div>;
}

function Tick({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${done ? "bg-accent text-on-accent" : "border border-line"}`}>
        {done && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
      </span>
      <span className="flex flex-col">
        <b className="text-[0.9rem] font-semibold">
          {title}
          <span className="sr-only">{done ? ", done" : ", not yet"}</span>
        </b>
        <small className="text-[0.8rem] text-muted [overflow-wrap:anywhere]">{detail}</small>
      </span>
    </li>
  );
}
