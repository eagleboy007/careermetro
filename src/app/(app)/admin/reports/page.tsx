import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ReportReview } from "@/components/admin/report-review";
import { PageLoading } from "@/components/app/page-loading";
import { removalsInForce } from "@/lib/admin/removals";
import { reportsForReview } from "@/lib/admin/reports";
import { currentAdmin } from "@/lib/admin/server";
import { reportRemovalAction, reviewReportAction } from "./actions";

export const metadata: Metadata = { title: "Reports · CareerMetro", robots: { index: false } };

/**
 * Open reports (FR-45) with the removal tools and the hidden messages and suspended accounts in force (FR-46), for
 * admins only (src/lib/admin/access.ts). The proxy answers not-found to everyone else before
 * anything renders; this checks again, as every action does.
 */
async function Review() {
  await connection();
  const admin = await currentAdmin();
  if (!admin) notFound();
  const [reports, inForce] = await Promise.all([reportsForReview({ adminUserId: admin.userId }), removalsInForce()]);
  return (
    <div className="flex flex-col gap-[18px]">
      <AdminNav current="reports" />
      <ReportReview reports={reports} inForce={inForce} now={new Date().toISOString()} review={reviewReportAction} remove={reportRemovalAction} />
    </div>
  );
}

export default function AdminReportsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Review />
    </Suspense>
  );
}
