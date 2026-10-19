import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { NetworkView } from "@/components/network/network-view";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { exampleNetwork, exampleSearch } from "@/lib/network/fixtures";
import { networkLists, networkSettingsFor, ownUsername } from "@/lib/network/store";
import { networkRow } from "@/lib/network/view";
import { answerConnection, blockFromNetwork, connectTo, removeFromNetwork, searchPeopleByName, setFindMe, withdrawConnection } from "./actions";

export const metadata: Metadata = { title: "Network · CareerMetro", robots: { index: false } };

const noteClass = "rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted";

/** Network (FR-49, handoff 12j). Without accounts (the example preview) everyone sees the example, where nothing is sent. */
async function Network() {
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) return <NetworkView data={exampleNetwork} example={exampleSearch} note={<p className={noteClass}>Example people. Nothing you do here is sent or saved.</p>} />;

  const [lists, settings, username] = await Promise.all([networkLists(account.id), networkSettingsFor(account.id), ownUsername(account.id)]);
  return (
    <NetworkView
      data={{
        connections: lists.connections.map((p) => networkRow(p, "connections")),
        requests: lists.requests.map((p) => networkRow(p, "requests")),
        sent: lists.sent.map((p) => networkRow(p, "sent")),
        peopleCanFind: settings.peopleCanFind,
        profileLink: username ? `/u/${username}` : null,
      }}
      actions={{
        connect: connectTo,
        answer: answerConnection,
        withdraw: withdrawConnection,
        remove: removeFromNetwork,
        block: blockFromNetwork,
        search: searchPeopleByName,
        findMe: setFindMe,
      }}
    />
  );
}

export default function NetworkPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Network />
    </Suspense>
  );
}
