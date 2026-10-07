import type { Metadata } from "next";
import { DraftNotice } from "@/components/roles/draft-notice";
import { RoleCard } from "@/components/roles/role-card";
import { SiteHeader } from "@/components/site/site-header";
import { roleViews } from "@/lib/role-view";

// Not indexed until domain experts have reviewed the profiles.
export const metadata: Metadata = {
  title: "Roles · CareerMetro",
  description: "The skills and certifications employers ask for in each role, measured on public job postings.",
  robots: { index: false },
};

export default function RolesPage() {
  const postings = roleViews.reduce((sum, r) => sum + (r.postingsAnalysed ?? 0), 0);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-20">
      <SiteHeader />
      <section className="flex max-w-2xl flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">{roleViews.length} roles</p>
        <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl">What each role asks for</h1>
        <p className="text-lg text-muted">
          The skills and certifications employers want, and how often they appear in {postings.toLocaleString("en-IN")} public
          job postings.
        </p>
      </section>
      <DraftNotice />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {roleViews.map((r) => (
          <li key={r.slug} className="flex">
            <RoleCard role={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}
