"use client";

import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  GAPS_VISIBLE_TO,
  GAPS_VISIBLE_TO_LABELS,
  PAY_MAX_LAKH,
  PROFILE_VISIBILITIES,
  PROFILE_VISIBILITY_LABELS,
  REQUESTS_FROM,
  REQUESTS_FROM_LABELS,
  RIDE_REMINDERS,
} from "@/lib/schemas/constants";
import type { ProfileVisibility, UserSettings } from "@/lib/schemas";
import { FieldError, useSettingsDraft } from "./settings-draft";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/** The prototype's privacy line: a shield and one muted sentence. */
export function PrivacyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[0.78rem] text-muted">
      <ShieldCheck {...ICON} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Current and expected pay, in lakh a year (handoff 12c). Private: never on a profile or sent to a company. */
export function PayFields() {
  const { draft, set, editable, errors } = useSettingsDraft();
  const field = (key: "currentPay" | "expectedPay", label: string) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`acc-${key}`} className="text-[0.82rem] font-semibold">
        {label} <em className="font-normal not-italic text-muted">optional</em>
      </label>
      <div className="flex min-h-11 min-w-0 items-center overflow-hidden rounded-md border border-line-strong bg-bg focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
        <span aria-hidden="true" className="px-2.5 text-[0.84rem] text-muted">
          ₹
        </span>
        <input
          id={`acc-${key}`}
          inputMode="decimal"
          autoComplete="off"
          value={draft[key]}
          onChange={(e) => set({ [key]: e.target.value.replace(/[^0-9.]/g, "").slice(0, 6) })}
          disabled={!editable}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={errors[key] ? `acc-${key}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent py-[9px] pr-1 text-right text-[0.9rem] text-ink outline-none disabled:opacity-70"
        />
        <span className="whitespace-nowrap px-2.5 text-[0.84rem] text-muted">lakh a year</span>
      </div>
      <FieldError id={`acc-${key}-error`} message={errors[key]} />
    </div>
  );
  return (
    <>
      <div className="grid gap-x-4 gap-y-3.5 min-[760px]:grid-cols-2">
        {field("currentPay", "Current pay")}
        {field("expectedPay", "Expected pay")}
      </div>
      <PrivacyLine>
        Never on your profile and never sent to companies, not even when you apply. Only you see it, here and in your download. Later we will
        use it only to mark roles that pay below what you expect. Leave it empty if you prefer. Up to {PAY_MAX_LAKH} lakh.
      </PrivacyLine>
    </>
  );
}

/** Prototype v44's words for each choice (gap list item 35); canViewProfile enforces them. */
const VISIBILITY_NOTES: Record<ProfileVisibility, string> = {
  signed_in: "Anyone signed in to CareerMetro, and your connections, can open your profile link.",
  line: "People aiming at the same role, and your connections, can open your profile link.",
  connections: "Only your connections can open your profile link; everyone else sees a not-found page. The default for new accounts.",
  only_me: "Hidden from everyone, connections included: your link shows a not-found page.",
};

const GAPS_NOTES: Record<(typeof GAPS_VISIBLE_TO)[number], string> = {
  nobody: "Nobody sees your gaps, connections included. Companies never see gaps, whatever you choose.",
  connections: "Only your connections see the skills you are still working on. Companies never see gaps.",
  profile: "Everyone who can open your profile sees your gaps. Companies still never see them.",
};

const REQUESTS_NOTES: Record<(typeof REQUESTS_FROM)[number], string> = {
  anyone: "Anyone who can find you or open your profile can ask to connect. People you block never can.",
  nobody: "Nobody can ask to connect with you. You can still send requests yourself.",
};

const SEG = "inline-flex flex-wrap gap-0.5 self-start rounded-[22px] bg-surface-2 p-[3px]";
const SEG_OPTION =
  "inline-flex min-h-11 cursor-pointer items-center rounded-full px-3.5 text-[0.82rem] font-[550] text-muted peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-[0_1px_2px_var(--shadow)] peer-checked:ring-1 peer-checked:ring-line-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent";

const PARTS: { key: keyof UserSettings & `show${string}`; label: string; hint?: string }[] = [
  { key: "showExperience", label: "Experience", hint: "Job titles, employers and dates. Lines from your resume never show." },
  { key: "showEducation", label: "Education" },
  { key: "showSkills", label: "Skills you have" },
  { key: "showCertifications", label: "Certifications" },
  { key: "showTargetRole", label: "The role you are aiming for", hint: "Off by default: it tells people you are looking. Companies you let find you see it either way." },
];

/** Who can open the profile, what it shows, gaps and connection requests (handoff 12c and 12j Privacy, prototype v44). */
export function PrivacyFields() {
  const { draft, setSetting, editable, errors } = useSettingsDraft();
  const s = draft.settings;
  // A save from before the choice existed has none; the old switch then says which it is.
  const gaps = s.gapsVisibleTo ?? (s.showGaps ? "profile" : "nobody");
  // The page fills it from Network's settings; "anyone" is the column's default.
  const requests = s.requestsFrom ?? "anyone";
  return (
    <>
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={!editable}>
        <legend className="mb-1.5 text-[0.82rem] font-semibold">Who can open your profile</legend>
        <div className={SEG}>
          {PROFILE_VISIBILITIES.map((v) => (
            <label key={v} className="relative">
              <input
                type="radio"
                name="acc-visibility"
                value={v}
                checked={s.visibility === v}
                onChange={() => setSetting("visibility", v)}
                aria-describedby={v === "line" ? "acc-visibility-note acc-line-hint" : "acc-visibility-note"}
                className="peer sr-only"
              />
              <span className={SEG_OPTION}>
                {PROFILE_VISIBILITY_LABELS[v]}
              </span>
            </label>
          ))}
        </div>
        <small id="acc-visibility-note" className="text-[0.78rem] text-muted">
          {VISIBILITY_NOTES[s.visibility]}
        </small>
        <small className="text-[0.78rem] text-muted">Companies you apply to always see what you send with that application.</small>
        <small id="acc-line-hint" className="text-[0.78rem] text-muted">
          &ldquo;People on your line&rdquo; shows your profile to people whose target role is the same as yours.
        </small>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col" disabled={!editable}>
        <legend className="mb-1 text-[0.82rem] font-semibold">On your profile</legend>
        <small className="mb-1 text-[0.78rem] text-muted">Your name and headline always show to people who can see your profile.</small>
        {PARTS.map((p) => (
          <Switch key={p.key} checked={s[p.key]} onChange={(on) => setSetting(p.key, on)} disabled={!editable} hint={p.hint}>
            {p.label}
          </Switch>
        ))}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={!editable}>
        <legend className="mb-1.5 text-[0.82rem] font-semibold">Your gaps show to</legend>
        <div className={SEG}>
          {GAPS_VISIBLE_TO.map((v) => (
            <label key={v} className="relative">
              <input
                type="radio"
                name="acc-gaps"
                value={v}
                checked={gaps === v}
                onChange={() => {
                  setSetting("gapsVisibleTo", v);
                  setSetting("showGaps", v === "profile");
                }}
                aria-describedby="acc-gaps-note"
                className="peer sr-only"
              />
              <span className={SEG_OPTION}>
                {GAPS_VISIBLE_TO_LABELS[v]}
              </span>
            </label>
          ))}
        </div>
        <small id="acc-gaps-note" className="text-[0.78rem] text-muted">
          {GAPS_NOTES[gaps]}
        </small>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={!editable}>
        <legend className="mb-1.5 text-[0.82rem] font-semibold">Connection requests from</legend>
        <div className={SEG}>
          {REQUESTS_FROM.map((v) => (
            <label key={v} className="relative">
              <input
                type="radio"
                name="acc-requests"
                value={v}
                checked={requests === v}
                onChange={() => setSetting("requestsFrom", v)}
                aria-describedby="acc-requests-note"
                className="peer sr-only"
              />
              <span className={SEG_OPTION}>{REQUESTS_FROM_LABELS[v]}</span>
            </label>
          ))}
        </div>
        <small id="acc-requests-note" className="text-[0.78rem] text-muted">
          {REQUESTS_NOTES[requests]}
        </small>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col" disabled={!editable}>
        <legend className="mb-1 text-[0.82rem] font-semibold">Companies</legend>
        <Switch
          checked={s.companiesCanFind}
          onChange={(on) => setSetting("companiesCanFind", on)}
          disabled={!editable}
          hint="Verified companies can find you when they search from one of their open jobs. They see your target role, your city if you gave one, the parts of your profile switched on above and how your skills match that job (target role and match even when switched off above), never your goals or gaps. They can search by your name, role and current employer, and narrow a search by experience, target role, city and proved skills. Your current employer never finds you. Never your email, phone, pay, notice period or resume. They can only send you a message request, which you accept or delete. Off by default; turning it off takes you out of their searches at once."
        >
          Let companies find me
        </Switch>
      </fieldset>
      <FieldError id="acc-settings-error" message={errors.settings} />
      <PrivacyLine>Email, phone, pay, notice period and lines from your resume are never on your profile, whatever you choose here.</PrivacyLine>
      <PrivacyLine>
        {s.companiesCanFind
          ? "Companies you block never find you, and every search and profile view by a company is recorded."
          : "Companies can't find you. They see only the applications you send them, and only what each one shares."}
      </PrivacyLine>
    </>
  );
}

/**
 * "Who sees what" (prototype v44, gap list item 35): what anyone signed in and your connections can do, by the rules
 * the app enforces. Two rows differ from the prototype on purpose: there is no switch for message requests yet, so
 * anyone who can reach you may send one; and nobody is ever shown who you are connected to, only a count of the
 * people you both know on Network.
 */
const WHO_SEES_WHAT: { what: string; anyone: string; connections: string }[] = [
  { what: "Find you by name", anyone: "Only with “Let people find me”", connections: "Always" },
  { what: "Open your profile", anyone: "As set in “Who can open your profile”", connections: "Unless you picked “Only you”" },
  { what: "See your gaps", anyone: "Only with “Everyone who can open your profile”", connections: "Unless you pick “Nobody”, or your profile is set to “Only you”" },
  { what: "Ask to connect", anyone: "Unless you pick “Nobody”", connections: "Already connected" },
  { what: "Message you", anyone: "One message request, which you accept or delete", connections: "Chat freely" },
  { what: "See who you are connected to", anyone: "Never, only how many people you both know", connections: "Never, only how many people you both know" },
];

export function WhoSeesWhat() {
  return (
    <details className="rounded-[14px] border border-line" data-who-sees-what>
      <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-[0.86rem] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
        Who sees what
      </summary>
      <table className="w-full border-collapse border-t border-line text-left text-[0.8rem] [overflow-wrap:anywhere]">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-3.5 py-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-muted">
              What
            </th>
            <th scope="col" className="px-3.5 py-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-muted">
              Anyone signed in
            </th>
            <th scope="col" className="px-3.5 py-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-muted">
              Your connections
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {WHO_SEES_WHAT.map((r) => (
            <tr key={r.what}>
              <th scope="row" className="px-3.5 py-2 align-top font-semibold">
                {r.what}
              </th>
              <td className="px-3.5 py-2 align-top text-muted">{r.anyone}</td>
              <td className="px-3.5 py-2 align-top text-muted">{r.connections}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const REMINDER_LABELS: Record<(typeof RIDE_REMINDERS)[number], string> = {
  "18:30": "18:30",
  "19:30": "19:30",
  "20:30": "20:30",
  "21:30": "21:30",
  off: "Off",
};

/** Notification choices, kept for when email is on (pending item 21). Nothing is sent yet. */
export function NotificationFields() {
  const { draft, setSetting, editable } = useSettingsDraft();
  const s = draft.settings;
  return (
    <>
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        These apply once CareerMetro starts sending email. Nothing is sent yet; we keep your choices for then.
      </p>
      <label className="flex max-w-[320px] flex-col gap-1.5">
        <span className="text-[0.82rem] font-semibold">Ride reminder</span>
        <select
          value={s.rideReminder}
          onChange={(e) => setSetting("rideReminder", e.target.value as UserSettings["rideReminder"])}
          disabled={!editable}
          className="min-h-11 rounded-md border border-line-strong bg-bg px-3 text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70"
        >
          {RIDE_REMINDERS.map((r) => (
            <option key={r} value={r}>
              {REMINDER_LABELS[r]}
            </option>
          ))}
        </select>
        <small className="text-[0.78rem] text-muted">One email on days you haven&apos;t ridden, India time.</small>
      </label>
      {/* v44 gap list item 38: English is the only language, so nothing is stored. */}
      <label className="flex max-w-[320px] flex-col gap-1.5">
        <span className="text-[0.82rem] font-semibold">Language</span>
        <select
          defaultValue="en"
          disabled={!editable}
          className="min-h-11 rounded-md border border-line-strong bg-bg px-3 text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70"
        >
          <option value="en">English</option>
          <option value="hi" disabled>
            Hindi (coming later)
          </option>
        </select>
      </label>
      <div className="flex flex-col">
        <Switch checked={s.emailCompanyMessages} onChange={(on) => setSetting("emailCompanyMessages", on)} disabled={!editable}>
          Messages from companies, by email too
        </Switch>
        <Switch checked={s.emailWeeklySummary} onChange={(on) => setSetting("emailWeeklySummary", on)} disabled={!editable}>
          Weekly summary email
        </Switch>
      </div>
    </>
  );
}
