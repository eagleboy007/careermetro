import type { Metadata } from "next";
import { InboxView } from "@/components/inbox/inbox-view";
import { exampleThreads } from "@/lib/inbox/fixtures";

export const metadata: Metadata = { title: "Inbox · CareerMetro", robots: { index: false } };

// Real chats need the message tables (dev/inbox-plan.md) and someone to talk to: the employer side for applications and
// Network for people. Until then everyone sees the example, and nothing typed here is sent or saved.
export default function InboxPage() {
  return (
    <InboxView
      threads={exampleThreads}
      note={
        <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
          Example messages for now. Nothing you type here is sent or saved. Chats with companies you apply to and people on your line come later.
        </p>
      }
    />
  );
}
