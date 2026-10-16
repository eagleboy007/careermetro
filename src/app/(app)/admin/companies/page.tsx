import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CompanyReview } from "@/components/admin/company-review";
import { JobCheckReview } from "@/components/admin/job-check-review";
import { AdminNav } from "@/components/admin/admin-nav";
import { PageLoading } from "@/components/app/page-loading";
import { companiesForReview } from "@/lib/admin/companies";
import { currentAdmin } from "@/lib/admin/server";
import { jobChecksForReview } from "@/lib/me/job-email-check";
import { reviewCompanyAction, reviewJobCheckAction } from "./actions";

export const metadata: Metadata = { title: "Company review · CareerMetro", robots: { index: false } };

/**
 * CareerMetro's company review (dev/corporate-plan.md, call B), for admins only (src/lib/admin/access.ts). The proxy
 * answers not-found to everyone else before anything renders; this checks again, as every action does.
 */
async function Review() {
  await connection();
  const admin = await currentAdmin();
  if (!admin) notFound();
  const [companies, checks] = await Promise.all([companiesForReview(), jobChecksForReview()]);
  return (
    <div className="flex flex-col gap-[18px]">
      <AdminNav current="companies" />
      <CompanyReview companies={companies} review={reviewCompanyAction} />
      <JobCheckReview checks={checks} review={reviewJobCheckAction} />
    </div>
  );
}

export default function AdminCompaniesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Review />
    </Suspense>
  );
}
