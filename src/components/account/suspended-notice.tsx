import Link from "next/link";
import { Button } from "@/components/ui/button";

/** The admin's reason as one sentence of the notice: trimmed, without its own closing full stop. */
export function noticeReason(reason: string | null | undefined): string {
  return reason?.trim().replace(/[.\s]+$/, "") || "it broke CareerMetro's rules";
}

/**
 * What a person whose account an admin suspended after a report sees instead of any signed-in page (FR-46,
 * /account/suspended): the fact in plain words, the admin's reason, and the Grievance Officer to write to. No colour
 * carries meaning here. Sign out is a form post to /auth/sign-out, as in the app's menu. Server-safe, for /design too.
 */
export function SuspendedNotice({ reason }: { reason: string | null }) {
  return (
    <div className="flex flex-col gap-5">
      <p>Your account is suspended after a report. Reason: {noticeReason(reason)}.</p>
      <p className="text-muted">
        If you think this is wrong, write to the{" "}
        <Link href="/grievances" className="font-medium text-ink underline underline-offset-2">
          grievance officer
        </Link>
        . While it is suspended you can&apos;t use CareerMetro, and companies can&apos;t see you.
      </p>
      <form method="post" action="/auth/sign-out">
        <Button type="submit" variant="ghost">
          Sign out
        </Button>
      </form>
    </div>
  );
}
