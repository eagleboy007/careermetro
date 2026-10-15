"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { checkUsernameAction } from "@/app/(app)/settings/actions";
import { normalUsername, USERNAME_MESSAGES, usernameProblem } from "@/lib/account/username";
import { HEADLINE_MAX, PERSON_CITIES, USERNAME_CHANGE_DAYS, USERNAME_MAX, USERNAME_REDIRECT_DAYS } from "@/lib/schemas/constants";
import { FieldError, useSettingsDraft } from "./settings-draft";

const input =
  "min-h-11 min-w-0 rounded-md border border-line-strong bg-bg px-3 py-[9px] text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70";

type Hint = { tone: "ok" | "bad" | "plain"; text: string };

const RULES = `Lowercase letters, numbers and hyphens. You can change it once every ${USERNAME_CHANGE_DAYS} days; your old link keeps working for ${USERNAME_REDIRECT_DAYS} days.`;

/**
 * Username (careermetro.com/u/<username>) with an availability check as the person types, and the optional headline
 * (handoff 12c, Profile basics). The check is a server action, so the name never goes into a URL; the server checks
 * again on save. `lockedUntil` is the date the username can next change, when that is still ahead.
 */
export function ProfileLinkFields({ lockedUntil }: { lockedUntil: string | null }) {
  const { draft, saved, set, editable, errors } = useSettingsDraft();
  const name = normalUsername(draft.username);
  const [remote, setRemote] = useState<{ name: string; hint: Hint } | null>(null);

  const local: Hint | null = !name
    ? saved.username
      ? null
      : { tone: "plain", text: `Pick a username for your profile link. ${RULES}` }
    : name === saved.username
      ? { tone: "ok", text: `Yours. ${RULES}` }
      : usernameProblem(name)
        ? { tone: "bad", text: USERNAME_MESSAGES[usernameProblem(name)!] }
        : null;

  const needsCheck = !local && !!name;
  useEffect(() => {
    if (!editable || !needsCheck) return;
    // An answer for a name the person has since changed is dropped.
    let live = true;
    const timer = setTimeout(async () => {
      const r = await checkUsernameAction(name).catch(() => null);
      if (!live || !r) return;
      const hint: Hint =
        r.state === "available"
          ? { tone: "ok", text: `Available. After you save, the next change is possible in ${USERNAME_CHANGE_DAYS} days.` }
          : r.state === "yours"
            ? { tone: "ok", text: `Yours. ${RULES}` }
            : r.state === "taken"
              ? { tone: "bad", text: "Taken. Try another." }
              : r.state === "invalid"
                ? { tone: "bad", text: r.message }
                : { tone: "plain", text: "We'll check it when you save." };
      setRemote({ name, hint });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, editable, needsCheck]);

  const hint: Hint = local ?? (remote?.name === name ? remote.hint : { tone: "plain", text: "Checking…" });
  const shown = errors.username ? { tone: "bad" as const, text: errors.username } : hint;
  const locked = !!lockedUntil && !!saved.username;

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5 min-[760px]:col-span-2">
        <label htmlFor="acc-username" className="text-[0.82rem] font-semibold">
          Username
        </label>
        <div className="flex min-h-11 min-w-0 items-stretch overflow-hidden rounded-md border border-line-strong bg-bg focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
          <span aria-hidden="true" className="grid place-items-center border-r border-line bg-surface-2 px-1.5 font-mono text-[0.7rem] text-muted min-[760px]:px-2.5 min-[760px]:text-[0.78rem]">
            careermetro.com/u/
          </span>
          <input
            id="acc-username"
            value={draft.username}
            onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={USERNAME_MAX}
            disabled={!editable || locked}
            aria-invalid={shown.tone === "bad" ? true : undefined}
            aria-describedby="acc-username-hint"
            className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[0.86rem] text-ink outline-none disabled:opacity-70"
          />
        </div>
        <small id="acc-username-hint" aria-live="polite" className={`text-[0.78rem] ${shown.tone === "bad" ? "text-bad" : "text-muted"}`}>
          {locked ? `Yours. You can change it again on ${lockedUntil}. Your old link keeps working for ${USERNAME_REDIRECT_DAYS} days after a change.` : shown.text}
        </small>
        {saved.username && (
          <Link href={`/u/${saved.username}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.84rem] font-[550] text-ink underline underline-offset-2">
            <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
            Open your profile link
          </Link>
        )}
      </div>
      <label className="flex min-w-0 flex-col gap-1.5 min-[760px]:col-span-2">
        <span className="text-[0.82rem] font-semibold">
          Headline <em className="font-normal not-italic text-muted">optional</em>
        </span>
        <input
          id="acc-headline"
          value={draft.headline}
          onChange={(e) => set({ headline: e.target.value })}
          maxLength={HEADLINE_MAX}
          disabled={!editable}
          aria-invalid={errors.headline ? true : undefined}
          aria-describedby={errors.headline ? "acc-headline-error" : "acc-headline-hint"}
          className={input}
        />
        <FieldError id="acc-headline-error" message={errors.headline} />
        {!errors.headline && (
          <small id="acc-headline-hint" className="text-[0.78rem] text-muted">
            One line under your name. {HEADLINE_MAX} characters. No email address or phone number.
          </small>
        )}
      </label>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[0.82rem] font-semibold">
          City <em className="font-normal not-italic text-muted">optional</em>
        </span>
        <select
          id="acc-city"
          value={draft.city}
          onChange={(e) => set({ city: e.target.value })}
          disabled={!editable}
          aria-invalid={errors.city ? true : undefined}
          aria-describedby={errors.city ? "acc-city-error" : "acc-city-hint"}
          className={input}
        >
          <option value="">Not given</option>
          {PERSON_CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <FieldError id="acc-city-error" message={errors.city} />
        {!errors.city && (
          <small id="acc-city-hint" className="text-[0.78rem] text-muted">
            Not on your profile. Only companies you let find you see it, and can search by it.
          </small>
        )}
      </label>
    </>
  );
}
