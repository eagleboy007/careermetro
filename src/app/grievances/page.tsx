import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { GRIEVANCE_OFFICER } from "@/lib/grievance";
import { CHAT_REPORT_REASON_LABELS } from "@/lib/inbox/types";
import { junctionEnabled } from "@/lib/preview";
import { JUNCTION_REPORT_REASON_LABELS, JUNCTION_REPORT_REASONS } from "@/lib/schemas/constants";
import { ACKNOWLEDGE_WITHIN_HOURS, APPEAL_DECIDE_DAYS, APPEAL_WITHIN_DAYS, DECIDE_WITHIN_HOURS, GAC_APPEAL_DAYS } from "@/lib/schemas/legal-timings";

export const metadata: Metadata = { title: "Grievances · CareerMetro" };

/** Hours as the page says them: "72 hours", or whole days from a week up ("15 days"). */
const inWords = (hours: number) => (hours >= 168 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`);

/**
 * Who handles complaints and how fast (India's IT Rules 2021). The contact lives in src/lib/grievance.ts and every
 * deadline in src/lib/schemas/legal-timings.ts. The lines about Junction's posts and comments (FR-61: the reasons, the
 * author's appeal) show only while JUNCTION_ENABLED is "1"; they are drafts until the lawyer signs off.
 */
export default function GrievancesPage() {
  const officer = GRIEVANCE_OFFICER;
  const junction = junctionEnabled();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold leading-[1.05]">Grievances</h1>
          <p className="text-muted">
            If something on CareerMetro worries you, such as a message, a profile or a post, use Report on it, or write to our Grievance Officer.
          </p>
        </section>

        <section aria-labelledby="officer-h" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5">
          <h2 id="officer-h" className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
            Grievance Officer
          </h2>
          <p className="font-semibold">{officer.name}</p>
          <p>
            <a href={`mailto:${officer.email}`} className="underline underline-offset-2">
              {officer.email}
            </a>
          </p>
          {officer.placeholder && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-[0.8rem] text-muted">
              We are still setting up this contact while we test. It is confirmed here before members can message each other or post.
            </p>
          )}
        </section>

        <section aria-labelledby="how-h" className="flex flex-col gap-3">
          <h2 id="how-h" className="text-xl font-semibold">
            What happens to a complaint
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
            <li>We confirm we have your complaint within {inWords(ACKNOWLEDGE_WITHIN_HOURS)}.</li>
            <li>If you ask us to remove something that breaks our rules or the law, we act on it within {inWords(DECIDE_WITHIN_HOURS.harassment)}.</li>
            <li>
              If you, or someone acting for you, report content that shows you nude, partly nude or in a sexual act, or that impersonates you (including edited
              or morphed images), we remove or disable it within {inWords(DECIDE_WITHIN_HOURS.intimate_or_impersonation)}.
            </li>
            {junction && <li>Anything harmful to a child, or sexual content involving a child, is removed within {inWords(DECIDE_WITHIN_HOURS.child_safety)}.</li>}
            <li>Any other complaint gets a decision within {inWords(DECIDE_WITHIN_HOURS.other)}, and we tell you what we did.</li>
            <li>The person you report is not told who reported them.</li>
            {junction && (
              <li>
                If we hide your post or comment, you see why and can appeal from Junction within {APPEAL_WITHIN_DAYS} days. We decide an appeal within{" "}
                {APPEAL_DECIDE_DAYS} days.
              </li>
            )}
            <li>
              If you disagree with the decision, you can appeal to the Government&apos;s Grievance Appellate Committee within {GAC_APPEAL_DAYS} days, at{" "}
              <a href="https://gac.gov.in" className="underline underline-offset-2" rel="noopener noreferrer">
                gac.gov.in
              </a>
              .
            </li>
          </ul>
        </section>

        <section aria-labelledby="reasons-h" className="flex flex-col gap-3">
          <h2 id="reasons-h" className="text-xl font-semibold">
            What you can report
          </h2>
          <p className="text-muted">Pick the closest reason when you use Report, or name it when you write to us:</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
            {(junction ? JUNCTION_REPORT_REASONS.map((r) => JUNCTION_REPORT_REASON_LABELS[r]) : Object.values(CHAT_REPORT_REASON_LABELS)).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p className="text-muted">
            When you write, say what it is (a link to the message, profile{junction ? ", post or comment" : " or job"} helps), why it worries you, and how
            we can reach you.
          </p>
        </section>
      </div>
    </main>
  );
}
