import type { ConnectionAnswer, ConnectionHow, ConnectionState } from "@/lib/schemas/network";

/*
 * What the /network page shows and can do (FR-49, handoff 12j). Plain data for a client component: dates are already
 * words in India time, and nothing here holds an email, phone, employer history, gaps or pay.
 */

export type NetworkTab = "connections" | "requests" | "sent" | "find";

export type NetworkRow = {
  id: string;
  name: string;
  /** For the /u/<handle> link; null when they have none. */
  username: string | null;
  aim: string | null;
  city: string | null;
  verified: boolean;
  common: number;
  mutual: number;
  state: ConnectionState;
  how: ConnectionHow | null;
  /** "Connected 2 Aug 2026", "Asked 18 Oct", "Sent 17 Oct · ends 16 Nov"; null on a search result. */
  when: string | null;
};

export type NetworkData = {
  connections: NetworkRow[];
  requests: NetworkRow[];
  sent: NetworkRow[];
  /** "Let people find me". */
  peopleCanFind: boolean;
  /** The person's own profile path ("/u/<handle>"), for "Copy your profile link"; null without a username. */
  profileLink: string | null;
};

/** Each returns the words to show on failure, or null when it worked. */
export type NetworkActions = {
  connect: (id: string, how: ConnectionHow) => Promise<string | null>;
  answer: (id: string, answer: ConnectionAnswer) => Promise<string | null>;
  withdraw: (id: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  block: (id: string) => Promise<string | null>;
  search: (q: string) => Promise<{ people: NetworkRow[] } | { error: string }>;
  findMe: (on: boolean) => Promise<string | null>;
};
