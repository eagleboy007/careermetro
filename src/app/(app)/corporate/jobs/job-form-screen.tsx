import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { JobForm } from "@/components/corporate/job-form";
import { exampleJobFormData } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { roleOptions, skillOptions } from "@/lib/corporate/job-content";
import { certificateOptions } from "@/lib/corporate/criteria";
import { jobForm } from "@/lib/corporate/jobs-store";
import { saveJobAction } from "./actions";
import { NoCompanyRole } from "../no-role";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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

/**
 * Post a job and Edit job (handoff 12g). The person's live company role is read on every request: Recruiter admins
 * and Hiring HR only, and for an edit, a job they may change. Without accounts (the example preview) it shows the form
 * for an example company, where nothing is saved.
 */
export async function JobFormScreen({ jobId }: { jobId: string | null }) {
  await connection();
  const today = isoDay(new Date());
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) {
    if (jobId) notFound();
    return <JobForm data={{ ...exampleJobFormData, roles: roleOptions(), skills: skillOptions(), certificates: certificateOptions() }} initial={null} today={today} />;
  }
  const form = await jobForm(account.id, jobId);
  if (!form.ok) {
    if (form.error === "not_found") notFound();
    if (form.error === "not_member") return <NoCompanyRole userId={account.id} />;
    return <Refused title="Only Recruiter admins and Hiring HR post jobs" text="Interviewers see the jobs they are on in Corporate. Ask a Recruiter admin if you need to post one." />;
  }
  return <JobForm data={form.data} initial={form.values} today={today} actions={{ save: saveJobAction }} />;
}
