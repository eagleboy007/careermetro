import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProofReview } from "@/components/admin/proof-review";
import { AdminNav } from "@/components/admin/admin-nav";
import { PageLoading } from "@/components/app/page-loading";
import { heldProofsForReview } from "@/lib/admin/proofs";
import { currentAdmin } from "@/lib/admin/server";
import { reviewProofAction } from "./actions";

export const metadata: Metadata = { title: "Held proofs · CareerMetro", robots: { index: false } };

/**
 * Certificates held for review (FR-44), for admins only (src/lib/admin/access.ts). The proxy answers not-found to
 * everyone else before anything renders; this checks again, as every action does.
 */
async function Review() {
  await connection();
  const admin = await currentAdmin();
  if (!admin) notFound();
  return (
    <div className="flex flex-col gap-[18px]">
      <AdminNav current="proofs" />
      <ProofReview proofs={await heldProofsForReview()} review={reviewProofAction} />
    </div>
  );
}

export default function AdminProofsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Review />
    </Suspense>
  );
}
