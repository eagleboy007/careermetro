import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MockView } from "@/components/mock/mock-view";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { exampleMockPage } from "@/lib/mock/fixtures";
import { mockPageFor } from "@/lib/mock/store";
import { mockTab, type MockPageView, type MockTab } from "@/lib/schemas";
import { endMockInterviewAction, finishTimedTestAction, pickTimedTestAction, saveMockAnswerAction, startMockInterviewAction, startTimedTestAction } from "./actions";

export const metadata: Metadata = { title: "Interview prep · CareerMetro", robots: { index: false } };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/**
 * Interview prep (`/mock`, FR-50, handoff 12l): the mock interview, the timed test and the question bank.
 * Signed in only: the signed-in layout and the proxy send everyone else away, and with no sign-in on this deployment
 * the page shows example data that saves nothing. The role and the tab live in the address.
 */
async function MockScreen({ searchParams }: PageProps<"/mock">) {
  const params = await searchParams;
  await connection();
  const role = one(params.role);
  const asked = mockTab.safeParse(one(params.tab));
  const tab: MockTab | null = asked.success ? asked.data : null;
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Preview with example data. Nothing you press here is saved.</p>
        <MockView key={`${tab}-${role}`} view={exampleMockPage(role, false)} tab={tab ?? "bank"} />
      </div>
    );
  }
  let view: MockPageView;
  try {
    view = await mockPageFor(account.id, role);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "mock_page_failed", errorFields(error));
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t load interview prep just now. Please reload the page in a minute.
      </p>
    );
  }
  return (
    <MockView
      // A link to another tab or role (a skipped question's "Open it in the bank") opens it afresh.
      key={`${tab}-${role}`}
      view={view}
      // Elite opens on the mock interview; Free on the bank, which it can use.
      tab={tab ?? (view.elite ? "interview" : "bank")}
      onStart={startTimedTestAction}
      onPick={pickTimedTestAction}
      onFinish={finishTimedTestAction}
      onInterviewStart={startMockInterviewAction}
      onInterviewAnswer={saveMockAnswerAction}
      onInterviewEnd={endMockInterviewAction}
    />
  );
}

export default function MockPage(props: PageProps<"/mock">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MockScreen {...props} />
    </Suspense>
  );
}
