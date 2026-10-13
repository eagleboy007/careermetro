import Link from "next/link";
import { recheckDue } from "@/lib/corporate/store";

/**
 * What a Corporate page shows someone with no company access. When the role is only waiting on its 180-day work-email
 * re-check (Testing T40), it says so and sends them to Corporate to confirm the email again, instead of saying they
 * have no role.
 */
export async function NoCompanyRole({ userId }: { userId: string }) {
  const due = await recheckDue(userId);
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <h1 className="text-[1.7rem] font-semibold leading-[1.1]">{due ? "Confirm your work email again" : "You don't have a company role"}</h1>
      <p className="text-muted">
        {due
          ? `Every 180 days we check that you still work at ${due.company}. Your company access is paused until you confirm your work email in Corporate.`
          : "Set up your company, or confirm a role a Recruiter admin gave you, in Corporate."}
      </p>
      <Link href="/corporate" className="inline-flex min-h-11 items-center self-start text-ink underline underline-offset-2">
        {due ? "Confirm it in Corporate" : "Open Corporate"}
      </Link>
    </div>
  );
}
