import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { CorporateHome, CorporateStart, RecheckPanel } from "@/components/corporate/corporate-home";
import { exampleCorporateHome, exampleOverview } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { codeDelivery } from "@/lib/corporate/delivery";
import { companyOverview } from "@/lib/corporate/overview";
import { corporateHome, recheckDue } from "@/lib/corporate/store";
import {
  answerRequestAction,
  cancelInviteAction,
  finishJoinAction,
  finishRecheckAction,
  inviteAction,
  removeMemberAction,
  startJoinAction,
  startRecheckAction,
} from "./actions";
import { setJobStatusAction } from "./jobs/actions";

export const metadata: Metadata = { title: "Corporate · CareerMetro", robots: { index: false } };

/**
 * Corporate (dev/corporate-plan.md, build steps 1 to 3 and the Overview of step 7). A member sees their company, read from their live role on
 * every request, so a removed role ends access at once. Anyone else can set up a company or confirm a role they were
 * given. Without accounts (the example preview) it shows an example company where nothing is saved.
 */
async function Corporate() {
  await connection();
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) {
    return (
      <CorporateHome
        view={exampleCorporateHome}
        overview={exampleOverview}
        note={<p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Example company. Nothing you do here is saved.</p>}
      />
    );
  }
  // Each reads the person's live company role itself.
  const [home, overview] = await Promise.all([corporateHome(account.id), companyOverview(account.id)]);
  if (!home) {
    // A role whose 180-day work-email re-check is due gives no access until it is confirmed again (Testing T40).
    const due = await recheckDue(account.id);
    if (due) return <RecheckPanel company={due.company} domain={due.domain} open={codeDelivery() !== "off"} actions={{ startJoin: startRecheckAction, finishJoin: finishRecheckAction }} />;
  }
  if (!home) return <CorporateStart open={codeDelivery() !== "off"} joinActions={{ startJoin: startJoinAction, finishJoin: finishJoinAction }} />;
  return (
    <CorporateHome
      view={home}
      overview={overview}
      actions={{ invite: inviteAction, cancelInvite: cancelInviteAction, answerRequest: answerRequestAction, remove: removeMemberAction }}
      jobActions={{ setStatus: setJobStatusAction }}
    />
  );
}

export default function CorporatePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Corporate />
    </Suspense>
  );
}
