import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CertificationList } from "@/components/roles/certification-list";
import { DraftNotice } from "@/components/roles/draft-notice";
import { RoleSkillList } from "@/components/roles/role-skill-list";
import { SiteHeader } from "@/components/site/site-header";
import { getRoleView, roleViews } from "@/lib/role-view";

export function generateStaticParams() {
  return roleViews.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: PageProps<"/roles/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const role = getRoleView(slug);
  // The not-found page streams inside Suspense, after its own metadata could apply, so the title is set here.
  if (!role) return { title: "Page not found · CareerMetro", robots: { index: false } };
  return {
    title: `${role.title} · CareerMetro`,
    description: `Skills and certifications employers ask for in ${role.title} roles.`,
    robots: role.reviewed ? undefined : { index: false },
  };
}

// params are read inside Suspense. With cacheComponents, reading them outside it works at build time but fails
// when the page is regenerated at runtime (a revalidatePath on "/roles/[slug]" or "/" layout), which showed as a 500.
export default function RolePage({ params }: PageProps<"/roles/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-20">
      <SiteHeader />
      <Suspense fallback={<p role="status" className="text-sm text-muted">Loading role…</p>}>
        <Role params={params} />
      </Suspense>
    </main>
  );
}

async function Role({ params }: { params: PageProps<"/roles/[slug]">["params"] }) {
  const { slug } = await params;
  const role = getRoleView(slug);
  if (!role) notFound();

  return (
    <>
      <section className="flex max-w-2xl flex-col gap-4">
        <Link href="/roles" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          All roles
        </Link>
        <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl">{role.title}</h1>
        <p className="font-mono text-xs uppercase tracking-wider text-muted">
          {role.experience}
          {role.postingsAnalysed !== null && ` · ${role.postingsAnalysed} postings analysed`}
        </p>
      </section>
      {!role.reviewed && <DraftNotice />}

      <section aria-labelledby="required" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="required" className="text-2xl font-semibold">
            Core skills
          </h2>
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Share of postings that ask for it</p>
        </div>
        <RoleSkillList skills={role.required} />
      </section>

      {role.niceToHave.length > 0 && (
        <section aria-labelledby="nice" className="flex flex-col gap-4">
          <h2 id="nice" className="text-2xl font-semibold">
            Good to have
          </h2>
          <RoleSkillList skills={role.niceToHave} />
        </section>
      )}

      <section aria-labelledby="certs" className="flex flex-col gap-4">
        <h2 id="certs" className="text-2xl font-semibold">
          Certifications
        </h2>
        <CertificationList certifications={role.certifications} />
      </section>

      <section aria-labelledby="sources" className="flex flex-col gap-2 border-t border-line pt-6 text-sm text-muted">
        <h2 id="sources" className="font-mono text-xs uppercase tracking-wider">
          Sources · updated {role.updatedOn}
        </h2>
        <ul className="flex flex-col gap-1">
          {role.sources.map((s) => (
            <li key={s.description}>
              {s.url ? (
                <a href={s.url} className="underline underline-offset-2 hover:text-ink">
                  {s.description}
                </a>
              ) : (
                s.description
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
