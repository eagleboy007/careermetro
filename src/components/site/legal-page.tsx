import { SiteHeader } from "@/components/site/site-header";

/*
 * The privacy notice and the terms (launch-readiness (c) 4). Plain sections under one heading, as on /grievances.
 * While `draft` is set the page says it is a draft waiting for legal review; both pages sit behind the preview gate in
 * src/proxy.ts until Milin's legal adviser approves the wording (launch-readiness (b) 8).
 */

export type LegalSection = { id: string; heading: string; body: React.ReactNode };

export function LegalPage({ title, intro, updated, draft, sections }: { title: string; intro: string; updated: string; draft: boolean; sections: LegalSection[] }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold leading-[1.05]">{title}</h1>
          <p className="text-muted">{intro}</p>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Last updated {updated}</p>
          {draft && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-[0.86rem]">
              This is a draft while we test CareerMetro. Our legal adviser reviews the wording before anyone outside the test group uses the app.
            </p>
          )}
        </section>
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="flex scroll-mt-6 flex-col gap-3">
            <h2 id={`${s.id}-h`} className="text-xl font-semibold">
              {s.heading}
            </h2>
            <div className="flex flex-col gap-3 text-[0.95rem] leading-relaxed [&_li]:pl-1 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">{s.body}</div>
          </section>
        ))}
      </div>
    </main>
  );
}
