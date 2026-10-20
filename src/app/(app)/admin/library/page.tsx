import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { LibraryReview } from "@/components/admin/library-review";
import { PageLoading } from "@/components/app/page-loading";
import { libraryReviewQueue } from "@/lib/admin/library";
import { currentAdmin } from "@/lib/admin/server";
import { decideResourceAction, decideSuggestionAction } from "./actions";

export const metadata: Metadata = { title: "Library review · CareerMetro", robots: { index: false } };

/**
 * Reported links and suggested free resources (docs/plans/library-part-2-plan.md), for admins only
 * (src/lib/admin/access.ts). The proxy answers not-found to everyone else before anything renders; this checks again,
 * as every action does.
 */
async function Review() {
  await connection();
  const admin = await currentAdmin();
  if (!admin) notFound();
  return (
    <div className="flex flex-col gap-[18px]">
      <AdminNav current="library" />
      <LibraryReview queue={await libraryReviewQueue()} decideResource={decideResourceAction} decideSuggestion={decideSuggestionAction} />
    </div>
  );
}

export default function AdminLibraryPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Review />
    </Suspense>
  );
}
