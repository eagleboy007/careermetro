import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { InboxView } from "@/components/inbox/inbox-view";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { exampleThreads } from "@/lib/inbox/fixtures";
import { usuallyFreeFor } from "@/lib/account/availability-store";
import { listThreads } from "@/lib/inbox/store";
import { errorFields, logEvent } from "@/lib/log";
import { acceptInboxRequest, deleteInboxRequest, endInboxChat, offerInboxTimes, readInboxChat, reportInInbox, saveUsuallyFreeAction, sendInboxMessage } from "./actions";

export const metadata: Metadata = { title: "Inbox · CareerMetro", robots: { index: false } };

const noteClass = "rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted";
const linkClass = "text-ink underline underline-offset-2";

/**
 * The Inbox (dev/inbox-plan.md part 1). A signed-in person sees their own chats; `?example=1` shows the example Inbox,
 * where nothing typed is sent or saved. Without accounts (the example preview) everyone sees the example.
 */
async function Inbox({ searchParams }: PageProps<"/inbox">) {
  const wantsExample = (await searchParams).example === "1";
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;

  if (!account || wantsExample) {
    return (
      <InboxView
        threads={exampleThreads}
        note={
          <p className={noteClass}>
            Example messages. Nothing you type here is sent or saved.
            {account && (
              <>
                {" "}
                <Link href="/inbox" className={linkClass}>
                  Back to your Inbox
                </Link>
              </>
            )}
          </p>
        }
      />
    );
  }

  // Usually free (FR-55) is read once for the page: the panel shows it and each "Ask for times" pre-ticks from it.
  const [threads, usuallyFree] = await Promise.all([listThreads(account.id), usuallyFreeOrNone(account.id)]);
  return (
    <InboxView
      threads={threads}
      usuallyFree={usuallyFree}
      actions={{
        send: sendInboxMessage,
        accept: acceptInboxRequest,
        remove: deleteInboxRequest,
        report: reportInInbox,
        read: readInboxChat,
        end: endInboxChat,
        offerTimes: offerInboxTimes,
        saveUsuallyFree: saveUsuallyFreeAction,
      }}
      note={
        threads.length === 0 ? (
          <p className={noteClass}>
            No messages yet. Chats with companies you apply to and people on your line show up here.{" "}
            <Link href="/inbox?example=1" className={linkClass}>
              See an example Inbox
            </Link>
          </p>
        ) : undefined
      }
    />
  );
}

export default function InboxPage(props: PageProps<"/inbox">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Inbox {...props} />
    </Suspense>
  );
}

// A failed read of Usually free leaves the panel empty instead of taking the whole Inbox down.
async function usuallyFreeOrNone(userId: string): Promise<string[]> {
  try {
    return await usuallyFreeFor(userId);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "inbox_usually_free_failed", errorFields(error));
    return [];
  }
}
