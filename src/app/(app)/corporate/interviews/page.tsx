import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { exampleCompanyInterviews, exampleScheduler } from "@/components/corporate/fixtures";
import { CompanyInterviews, Scheduler } from "@/components/corporate/interviews-screens";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { companyInterviews, INTERVIEW_ERROR_TEXT, schedulingView } from "@/lib/corporate/interviews-store";
import { askTimesAction, cancelInterviewAction, feedbackAction, scheduleAction } from "./actions";

export const metadata: Metadata = { title: "Interviews · Corporate · CareerMetro", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exampleNote = <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Example company. Nothing you do here is saved.</p>;

function Refused({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <h1 className="text-[1.7rem] font-semibold leading-[1.1]">{title}</h1>
      <p className="text-muted">{text}</p>
      <Link href="/corporate" className="inline-flex min-h-11 items-center self-start text-ink underline underline-offset-2">
        Open Corporate
      </Link>
    </div>
  );
}

/*
 * Corporate Interviews (dev/corporate-plan.md build step 6), and the scheduler at `/corporate/interviews?application=…`
 * (a query, as the board does, because the signed-in shell's loading frame reads the path). The person's live company
 * role and job team are read on every request. Without accounts (the example preview) it shows examples.
 */
async function Interviews({ searchParams }: PageProps<"/corporate/interviews">) {
  await connection();
  const application = (await searchParams).application;
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  const actions = { askTimes: askTimesAction, cancel: cancelInterviewAction, feedback: feedbackAction };
  if (application !== undefined) {
    if (!account) return <Scheduler view={exampleScheduler} note={exampleNote} />;
    if (typeof application !== "string" || !UUID.test(application)) notFound();
    const r = await schedulingView(account.id, application);
    if (!r.ok) {
      if (r.error === "not_found") notFound();
      return <Refused title="You can't schedule this candidate" text={INTERVIEW_ERROR_TEXT[r.error]} />;
    }
    return <Scheduler view={r.view} actions={{ ...actions, schedule: scheduleAction }} />;
  }
  if (!account) return <CompanyInterviews view={exampleCompanyInterviews} note={exampleNote} />;
  const r = await companyInterviews(account.id);
  if (!r.ok) return <Refused title="You don't have a company role" text="Set up your company, or confirm a role a Recruiter admin gave you, in Corporate." />;
  return <CompanyInterviews view={r.view} actions={actions} />;
}

export default function InterviewsPage(props: PageProps<"/corporate/interviews">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Interviews {...props} />
    </Suspense>
  );
}
