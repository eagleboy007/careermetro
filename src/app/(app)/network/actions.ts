"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { currentAccount } from "@/lib/auth/server";
import { answerRequest, blockPerson, NETWORK_ERROR_TEXT, networkSettingsFor, removeConnection, requestConnection, saveNetworkSettings, searchNetwork, withdrawRequest, type NetworkResult } from "@/lib/network/store";
import type { NetworkActions } from "@/lib/network/types";
import { networkRow } from "@/lib/network/view";
import { NETWORK_QUERY_MESSAGE } from "@/lib/schemas/network";

/*
 * Network's server actions (FR-49). Each checks who is signed in and validates its input; the store checks the pair's
 * rules. They return the words to show on failure, never whether someone blocked the person.
 */

const SIGN_IN = "Please sign in again.";
const BAD = "That didn't work. Please try again.";
const personId = z.uuid();

const answer = (result: NetworkResult): string | null => {
  if (!result.ok) return NETWORK_ERROR_TEXT[result.error];
  // The lists, the counts and the count next to Network in the menu.
  refresh();
  return null;
};

type Account = NonNullable<Awaited<ReturnType<typeof currentAccount>>>;

async function signedIn(id: string): Promise<{ account: Account; error: null } | { account: null; error: string }> {
  if (!personId.safeParse(id).success) return { account: null, error: BAD };
  const account = await currentAccount();
  return account ? { account, error: null } : { account: null, error: SIGN_IN };
}

/** Connect can connect at once (they had asked this person), so the screen shows the state the store reached. */
export const connectTo: NetworkActions["connect"] = async (id, how) => {
  const s = await signedIn(id);
  if (!s.account) return { error: s.error };
  const r = await requestConnection(s.account.id, id, how);
  if (!r.ok) return { error: NETWORK_ERROR_TEXT[r.error] };
  answer(r);
  return { state: r.state };
};

export const answerConnection: NetworkActions["answer"] = async (id, reply) => {
  const s = await signedIn(id);
  return s.account ? answer(await answerRequest(s.account.id, id, reply)) : s.error;
};

export const withdrawConnection: NetworkActions["withdraw"] = async (id) => {
  const s = await signedIn(id);
  return s.account ? answer(await withdrawRequest(s.account.id, id)) : s.error;
};

export const removeFromNetwork: NetworkActions["remove"] = async (id) => {
  const s = await signedIn(id);
  return s.account ? answer(await removeConnection(s.account.id, id)) : s.error;
};

export const blockFromNetwork: NetworkActions["block"] = async (id) => {
  const s = await signedIn(id);
  return s.account ? answer(await blockPerson(s.account.id, id)) : s.error;
};

export const searchPeopleByName: NetworkActions["search"] = async (q) => {
  const account = await currentAccount();
  if (!account) return { error: SIGN_IN };
  const r = await searchNetwork(account.id, { q });
  if (!r.ok) return { error: r.error === "invalid" ? NETWORK_QUERY_MESSAGE : NETWORK_ERROR_TEXT[r.error] };
  return { people: r.people.map((p) => networkRow(p, "find")) };
};

/** "Let people find me", from the bar on /network (the same switch as in Settings). The other choices stay as saved. */
export const setFindMe: NetworkActions["findMe"] = async (on) => {
  if (typeof on !== "boolean") return BAD;
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const saved = await networkSettingsFor(account.id);
  return answer(await saveNetworkSettings(account.id, { ...saved, peopleCanFind: on }));
};
