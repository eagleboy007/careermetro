import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { TimetableView, type TimetableActions } from "@/components/timetable/timetable-view";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { exampleTimetable, exampleTimetableChoices, exampleTimetableWhy } from "@/lib/timetable/fixtures";
import { eventsDigestOn } from "@/lib/timetable/digest-store";
import { timetableForUser } from "@/lib/timetable/store";
import { pendingSuggestionCount } from "@/lib/timetable/suggest-store";
import { eventPrepAction, eventRsvpAction, eventsDigestAction, suggestEventAction } from "./actions";

export const metadata: Metadata = { title: "Timetable · CareerMetro", robots: { index: false } };

/** Save, I'm going, the prep task, the Monday digest switch and Suggest an event, kept on the server. */
const TIMETABLE_ACTIONS: TimetableActions = { rsvp: eventRsvpAction, prep: eventPrepAction, digest: eventsDigestAction, suggest: suggestEventAction };

/**
 * The Timetable (FR-57, handoff 10, docs/plans/timetable-plan.md section 7). Signed in only: the signed-in layout and
 * the proxy send everyone else away, and with no sign-in on this deployment the page shows example events, where Save
 * and I'm going change the screen only. Signed in, it reads live events that match the person's open goals or
 * interests, near the profile city (never the device) or online, for the next 60 days. Suggest an event keeps the
 * person's suggestion as pending for review (Timetable PR 6); the rail counts only their own.
 */
async function TimetableScreen() {
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example events. Nothing you do here is sent or saved.</Banner>
        <TimetableView view={exampleTimetable} why={exampleTimetableWhy} choices={exampleTimetableChoices} />
      </div>
    );
  }
  let data: Awaited<ReturnType<typeof timetableForUser>>;
  let digest: boolean;
  let suggestionsPending: number;
  try {
    [data, digest, suggestionsPending] = await Promise.all([timetableForUser(account.id), eventsDigestOn(account.id), pendingSuggestionCount(account.id)]);
  } catch (error) {
    unstable_rethrow(error);
    // Database errors can carry values; errorFields keeps only the name and code.
    logEvent("error", "timetable_failed", errorFields(error));
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t load your Timetable just now. Please reload the page in a minute.
      </p>
    );
  }
  return <TimetableView view={data.view} why={data.why} choices={data.choices} actions={TIMETABLE_ACTIONS} digest={digest} suggestionsPending={suggestionsPending} />;
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function TimetablePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TimetableScreen />
    </Suspense>
  );
}
