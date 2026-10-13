import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { exampleBoard, exampleCandidate } from "@/components/corporate/fixtures";
import { JobBoard } from "@/components/corporate/job-board";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { jobBoard } from "@/lib/corporate/applications-store";
import { moveApplicationAction, openCandidateAction } from "../actions";

export const metadata: Metadata = { title: "Job board · CareerMetro", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * A job's board (dev/corporate-plan.md build step 4), at `/corporate/jobs/board?id=…` for the same reason as the edit
 * page: the signed-in shell's loading frame reads the path. The person's live company role and job team are read on
 * every request. Without accounts (the example preview) it shows an example board where nothing moves.
 */
async function Board({ searchParams }: PageProps<"/corporate/jobs/board">) {
  await connection();
  const id = (await searchParams).id;
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) return <JobBoard board={exampleBoard} example={exampleCandidate} />;
  if (typeof id !== "string" || !UUID.test(id)) notFound();
  const r = await jobBoard(account.id, id);
  if (!r.ok) {
    if (r.error === "not_member") return <Refused title="You don't have a company role" text="Set up your company, or confirm a role a Recruiter admin gave you, in Corporate." />;
    if (r.error === "not_allowed") return <Refused title="You aren't on this job's team" text="Recruiter admins see every job's board; anyone else sees the boards of jobs they are on." />;
    notFound();
  }
  return <JobBoard board={r.board} actions={{ open: openCandidateAction, move: moveApplicationAction }} />;
}

export default function BoardPage(props: PageProps<"/corporate/jobs/board">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Board {...props} />
    </Suspense>
  );
}
