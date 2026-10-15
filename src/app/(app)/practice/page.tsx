import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { PracticeView } from "@/components/practice/practice-view";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { exampleFeedback, examplePractice } from "@/lib/practice/fixtures";
import { practiceFor } from "@/lib/practice/store";
import type { PracticeView as View } from "@/lib/schemas";
import { ratePracticeAction, submitPracticeAction } from "./actions";

export const metadata: Metadata = { title: "Practice · CareerMetro", robots: { index: false } };

/**
 * Practice (FR-21 to FR-23, handoff 12h). Signed in only: the signed-in layout and the proxy send everyone else away,
 * and with no sign-in on this deployment the page shows example data that saves nothing. The skills are the person's
 * own goals, read by their user id; the questions come from the bank, never from the model.
 */
async function PracticeScreen() {
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example data. Nothing you type here is saved or sent.</Banner>
        <PracticeView view={examplePractice} sampleFeedback={exampleFeedback} />
      </div>
    );
  }
  let view: View;
  try {
    view = await practiceFor(account.id);
  } catch (error) {
    unstable_rethrow(error);
    // Database and schema errors can carry values; errorFields keeps only the name and code.
    logEvent("error", "practice_failed", errorFields(error));
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t load your practice just now. Please reload the page in a minute.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Banner>Questions for the goals on your line. Practice gets you ready; only proof fills a goal or moves your train.</Banner>
      <PracticeView view={view} onSubmit={submitPracticeAction} onRate={ratePracticeAction} />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function PracticePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <PracticeScreen />
    </Suspense>
  );
}
