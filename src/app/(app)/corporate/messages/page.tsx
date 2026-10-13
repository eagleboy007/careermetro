import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { CompanyMessages } from "@/components/corporate/company-messages";
import { exampleCompanyChat, exampleCompanyMessages } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { COMPANY_CHAT_ERROR_TEXT, companyChat, companyMessages } from "@/lib/corporate/chats-store";
import { sendCompanyMessageAction } from "./actions";

export const metadata: Metadata = { title: "Messages · Corporate · CareerMetro", robots: { index: false } };

/*
 * Corporate Messages (dev/corporate-plan.md build step 5), at `/corporate/messages?application=…` for one chat. The
 * person's live company role and job team are read on every request, so a removed role ends access at once. Opening a
 * chat counts it as read for the person. Without accounts (the example preview) it shows an example where nothing sends.
 */
async function Messages({ searchParams }: PageProps<"/corporate/messages">) {
  await connection();
  const application = (await searchParams).application;
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) {
    return (
      <CompanyMessages
        view={exampleCompanyMessages}
        chat={exampleCompanyChat}
        note={<p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Example company. Nothing you type here is sent.</p>}
      />
    );
  }
  // The chat first, so opening it clears its unread dot in the list below.
  const opened = typeof application === "string" ? await companyChat(account.id, application, { markRead: true }) : null;
  const list = await companyMessages(account.id);
  if (!list.ok) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-3">
        <h1 className="text-[1.7rem] font-semibold leading-[1.1]">You don&apos;t have a company role</h1>
        <p className="text-muted">Set up your company, or confirm a role a Recruiter admin gave you, in Corporate.</p>
        <Link href="/corporate" className="inline-flex min-h-11 items-center self-start text-ink underline underline-offset-2">
          Open Corporate
        </Link>
      </div>
    );
  }
  return (
    <CompanyMessages
      view={list.view}
      chat={opened?.ok ? opened.chat : null}
      chatError={opened && !opened.ok ? COMPANY_CHAT_ERROR_TEXT[opened.error] : null}
      actions={{ send: sendCompanyMessageAction }}
    />
  );
}

export default function MessagesPage(props: PageProps<"/corporate/messages">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Messages {...props} />
    </Suspense>
  );
}
