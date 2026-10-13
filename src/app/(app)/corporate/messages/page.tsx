import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { CompanyMessages } from "@/components/corporate/company-messages";
import { exampleCompanyChat, exampleCompanyMessages } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { COMPANY_CHAT_ERROR_TEXT, companyChat, companyMessages } from "@/lib/corporate/chats-store";
import { companyFoundChat, FIND_ERROR_TEXT } from "@/lib/corporate/find-store";
import { askTimesAction } from "../interviews/actions";
import { sendCompanyMessageAction, sendFoundMessageAction } from "./actions";
import { NoCompanyRole } from "../no-role";

export const metadata: Metadata = { title: "Messages · Corporate · CareerMetro", robots: { index: false } };

/*
 * Corporate Messages (dev/corporate-plan.md build step 5), at `/corporate/messages?application=…` for one chat, or
 * `?found=…` for a chat with someone the company found and who accepted its message request (pending item 19). The
 * person's live company role and job team are read on every request, so a removed role ends access at once. Opening a
 * chat counts it as read for the person. Without accounts (the example preview) it shows an example where nothing sends.
 */
async function Messages({ searchParams }: PageProps<"/corporate/messages">) {
  await connection();
  const { application, found } = await searchParams;
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
  const opened =
    typeof found === "string"
      ? await companyFoundChat(account.id, found, { markRead: true }).then((r) => (r.ok ? r : { ok: false as const, text: FIND_ERROR_TEXT[r.error] }))
      : typeof application === "string"
        ? await companyChat(account.id, application, { markRead: true }).then((r) => (r.ok ? r : { ok: false as const, text: COMPANY_CHAT_ERROR_TEXT[r.error] }))
        : null;
  const list = await companyMessages(account.id);
  if (!list.ok) {
    return <NoCompanyRole userId={account.id} />;
  }
  return (
    <CompanyMessages
      view={list.view}
      chat={opened?.ok ? opened.chat : null}
      chatError={opened && !opened.ok ? opened.text : null}
      actions={{ send: sendCompanyMessageAction, askTimes: askTimesAction, sendFound: sendFoundMessageAction }}
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
