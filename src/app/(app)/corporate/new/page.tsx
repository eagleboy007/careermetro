import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { CorporateStart } from "@/components/corporate/corporate-home";
import { OrgSignupForm } from "@/components/corporate/org-signup-form";
import { firstName } from "@/lib/account/name";
import { currentAccount } from "@/lib/auth/server";
import { codeDelivery } from "@/lib/corporate/delivery";
import { heldMembership } from "@/lib/corporate/store";
import { askForAccessAction, finishSignupAction, inviteSecondAdminAction, savePageAction, startSignupAction } from "../actions";

export const metadata: Metadata = { title: "Set up your company · CareerMetro", robots: { index: false } };

/**
 * Organization sign-up (handoff 12f, `/corporate/new`). Production says "Company sign-up opens soon." until an email
 * sender exists; previews with the test sign-in and local copies show the code on screen.
 */
async function NewCompany() {
  await connection();
  if (codeDelivery() === "off") return <CorporateStart open={false} />;
  const account = await currentAccount();
  if (!account) return <OrgSignupForm />;
  // Not a redirect: the form itself carries on to the company page step once the company exists.
  const member = await heldMembership(account.id);
  if (member) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-3">
        <h1 className="text-[1.7rem] font-semibold leading-[1.1]">You already have a company role</h1>
        <p className="text-muted">A person can work for one company on CareerMetro at a time.</p>
        <Link href="/corporate" className="text-ink underline underline-offset-2">
          Open Corporate
        </Link>
      </div>
    );
  }
  return (
    <OrgSignupForm
      firstName={firstName(account.firstName ?? account.name)}
      actions={{ startSignup: startSignupAction, finishSignup: finishSignupAction, askForAccess: askForAccessAction, savePage: savePageAction, inviteAdmin: inviteSecondAdminAction }}
    />
  );
}

export default function NewCompanyPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewCompany />
    </Suspense>
  );
}
