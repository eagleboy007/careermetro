"use client";

import { ShieldCheck } from "lucide-react";
import { useSyncExternalStore } from "react";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

const STANDALONE = "(display-mode: standalone)";
const subscribe = (change: () => void) => {
  const query = window.matchMedia(STANDALONE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const installed = () => window.matchMedia(STANDALONE).matches;

/**
 * Settings > Add from your phone (handoff 12c with C21): how to send a job to "Add a job you found" from Android's
 * share sheet, or by copy and Paste on an iPhone, whose share sheet lists no websites. "Ready on your Android phone"
 * shows only when this page runs as the installed app: a browser can't tell whether the app is installed elsewhere.
 */
export function ShareFromPhone() {
  const ready = useSyncExternalStore(subscribe, installed, () => false);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.88rem] text-muted">
        See a job in any app, send it to CareerMetro. It opens &quot;Add a job you found&quot; filled in; you check it and save. We get only what the app
        shares: the link and its text.
      </p>
      <div className="grid gap-3 min-[760px]:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-[14px] border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="mr-auto text-[0.92rem] font-semibold">Android</b>
            {ready && <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">Ready on your Android phone</span>}
          </div>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[0.84rem]">
            <li>
              Open CareerMetro in Chrome and choose <b className="font-semibold">Add to Home screen</b> (or Install app) from the browser menu.
            </li>
            <li>
              In any app, open a job and tap <b className="font-semibold">Share</b>. CareerMetro is in the list.
            </li>
            <li>
              Check the company and title, then <b className="font-semibold">Save to My jobs</b>.
            </li>
          </ol>
          <small className="text-[0.78rem] text-muted">Works from the installed app only. Signed out? You sign in first, and the shared job is still there.</small>
        </div>
        <div className="flex flex-col gap-2 rounded-[14px] border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="mr-auto text-[0.92rem] font-semibold">iPhone</b>
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted">copy, then paste</span>
          </div>
          <p className="text-[0.84rem]">iPhone&apos;s Share sheet doesn&apos;t list websites, so there is one more tap:</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[0.84rem]">
            <li>
              In the job app, tap Share and <b className="font-semibold">Copy link</b> (or select and copy the description).
            </li>
            <li>
              Open CareerMetro and tap <b className="font-semibold">Paste</b> in &quot;Add a job you found&quot;. Your phone asks you to allow the paste the first
              time.
            </li>
            <li>
              Check the company and title, then <b className="font-semibold">Save to My jobs</b>.
            </li>
          </ol>
          <small className="text-[0.78rem] text-muted">Add CareerMetro to your Home Screen from Safari&apos;s Share sheet to keep it one tap away.</small>
        </div>
      </div>
      <small className="flex items-start gap-1.5 text-[0.78rem] text-muted">
        <ShieldCheck {...ICON} className="mt-0.5 shrink-0" />
        <span>
          We never read your clipboard or other apps on our own. Only what you share or paste reaches us, and it stays yours: never shown to companies, never
          used to find roles for anyone else.
        </span>
      </small>
    </div>
  );
}
