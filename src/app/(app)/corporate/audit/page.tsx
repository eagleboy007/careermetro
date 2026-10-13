import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { CompanyAudit } from "@/components/corporate/audit-view";
import { exampleAudit } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { AUDIT_ERROR_TEXT, companyAudit } from "@/lib/corporate/audit";

export const metadata: Metadata = { title: "Audit · Corporate · CareerMetro", robots: { index: false } };

/*
 * The company's audit view (dev/corporate-plan.md build step 7), Recruiter admins only: read from the person's live
 * company role on every request. `?before=` is a time and a line id, nothing about a person. Without accounts (the
 * example preview) it shows an example.
 */
async function Audit({ searchParams }: PageProps<"/corporate/audit">) {
  await connection();
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) {
    return <CompanyAudit view={exampleAudit} olderHref={null} note={<p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Example company. Nothing here is real.</p>} />;
  }
  const r = await companyAudit(account.id, { before: (await searchParams).before });
  if (!r.ok) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-3">
        <h1 className="text-[1.7rem] font-semibold leading-[1.1]">You can&apos;t open the audit</h1>
        <p className="text-muted">{AUDIT_ERROR_TEXT[r.error]}</p>
        <Link href="/corporate" className="inline-flex min-h-11 items-center self-start text-ink underline underline-offset-2">
          Open Corporate
        </Link>
      </div>
    );
  }
  return <CompanyAudit view={r.view} olderHref={r.view.next ? `/corporate/audit?before=${encodeURIComponent(r.view.next)}` : null} />;
}

export default function AuditPage(props: PageProps<"/corporate/audit">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Audit {...props} />
    </Suspense>
  );
}
