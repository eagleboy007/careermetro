import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { EventSuggestionQueue } from "@/components/admin/event-suggestion-queue";
import { JunctionModeration } from "@/components/admin/junction-moderation";
import { ManualEventList } from "@/components/admin/manual-event-list";
import { ReportReview } from "@/components/admin/report-review";
import { PageLoading } from "@/components/app/page-loading";
import { manualEventsJson } from "@/content";
import { removalsInForce } from "@/lib/admin/removals";
import { reportsForReview } from "@/lib/admin/reports";
import { currentAdmin } from "@/lib/admin/server";
import { appealsForReview, hiddenJunctionInForce } from "@/lib/junction/moderation";
import { manualEventStatuses } from "@/lib/timetable/feed-store";
import { manualAdminRows, manualKeys } from "@/lib/timetable/manual";
import { eventSuggestionQueueFor } from "@/lib/timetable/suggest-store";
import { decideAppealAction, logIntakeAction, reportRemovalAction, reviewReportAction, setLegalHoldAction } from "./actions";

export const metadata: Metadata = { title: "Reports · CareerMetro", robots: { index: false } };

/**
 * Open reports (FR-45) with the removal tools and the hidden messages, posts and comments and suspended accounts in
 * force (FR-46, FR-61), then Junction's open appeals and "Log a complaint or order" (FR-61), for admins only (src/lib/admin/access.ts). The proxy answers not-found to everyone else before
 * anything renders; this checks again, as every action does. Below them, the pending event suggestions (Timetable
 * PR 6), read only: nothing can publish a member's suggestion until a grievance officer is named. Last, the hand-entered
 * events of src/content/manual-events.json with whether each is live, read only: they change only in a PR.
 */
async function Review() {
  await connection();
  const admin = await currentAdmin();
  if (!admin) notFound();
  const [reports, inForce, hiddenJunction, appeals, suggestions, manualStatuses] = await Promise.all([
    reportsForReview({ adminUserId: admin.userId }),
    removalsInForce(),
    hiddenJunctionInForce(),
    appealsForReview(admin.userId),
    eventSuggestionQueueFor(),
    manualEventStatuses(manualKeys(manualEventsJson)),
  ]);
  const now = new Date().toISOString();
  return (
    <div className="flex flex-col gap-[18px]">
      <AdminNav current="reports" />
      <ReportReview
        reports={reports}
        inForce={{ ...inForce, junction: hiddenJunction }}
        now={now}
        review={reviewReportAction}
        remove={reportRemovalAction}
        hold={setLegalHoldAction}
      />
      <JunctionModeration appeals={appeals} now={now} decide={decideAppealAction} log={logIntakeAction} />
      <EventSuggestionQueue queue={suggestions} />
      <ManualEventList rows={manualAdminRows(manualEventsJson, manualStatuses)} />
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
