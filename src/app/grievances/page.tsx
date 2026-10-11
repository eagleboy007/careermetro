import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { GRIEVANCE_OFFICER } from "@/lib/grievance";

export const metadata: Metadata = { title: "Grievances · CareerMetro" };

/** Who handles complaints and how fast (India's IT Rules 2021). The contact lives in src/lib/grievance.ts. */
export default function GrievancesPage() {
  const officer = GRIEVANCE_OFFICER;
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
              This is a placeholder contact while we test. The officer&apos;s name goes here before members can message each other or post.
            </p>
          )}
        </section>

        <section aria-labelledby="how-h" className="flex flex-col gap-3">
          <h2 id="how-h" className="text-xl font-semibold">
            What happens to a complaint
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
            <li>We confirm we have it within 24 hours.</li>
            <li>We decide on it and tell you what we did within 15 days.</li>
            <li>Content that shows someone in a private or intimate way without consent, or pretends to be someone, comes down within 24 hours of a report.</li>
            <li>The person you report is not told who reported them.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
