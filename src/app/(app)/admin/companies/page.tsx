import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CompanyReview } from "@/components/admin/company-review";
import { AdminNav } from "@/components/admin/admin-nav";
import { PageLoading } from "@/components/app/page-loading";
import { companiesForReview } from "@/lib/admin/companies";
import { currentAdmin } from "@/lib/admin/server";
import { reviewCompanyAction } from "./actions";

export const metadata: Metadata = { title: "Company review · CareerMetro", robots: { index: false } };

/**
 * CareerMetro's company review (dev/corporate-plan.md, call B), for admins only (src/lib/admin/access.ts). The proxy
 * answers not-found to everyone else before anything renders; this checks again, as every action does.
 */
async function Review() {
  await connection();
  const admin = await currentAdmin();
  if (!admin) notFound();
  return (
    <div className="flex flex-col gap-[18px]">
      <AdminNav current="companies" />
      <CompanyReview companies={await companiesForReview()} review={reviewCompanyAction} />
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
