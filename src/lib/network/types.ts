import type { ReportReason } from "@/lib/schemas/inbox";
import type { ConnectionAnswer, ConnectionHow, ConnectionState } from "@/lib/schemas/network";

/*
 * What the /network page shows and can do (FR-49, handoff 12j). Plain data for a client component: dates are already
 * words in India time, and nothing here holds an email, phone, anyone else's city (only companies see it, T74), employer
 * history, gaps or pay.
 */

export type NetworkTab = "connections" | "requests" | "sent" | "find";

export type NetworkRow = {
  id: string;
  name: string;
  /** For the /u/<handle> link; null when they have none. */
  username: string | null;
  aim: string | null;
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
  /** The person's own target role (its title), for Find people's "Aiming for my role" filter; null when they have none. */
  myRole: string | null;
};

/** Find people's optional filters (C13): aiming for my role, verified. All off by default. No city filter: only companies see a member's city (T93). */
export type NetworkFilters = { sameRole: boolean; verified: boolean };

/** Each returns the words to show on failure, or null when it worked. Connect returns how the two now stand. */
export type NetworkActions = {
  connect: (id: string, how: ConnectionHow) => Promise<{ error: string } | { state: ConnectionState }>;
  answer: (id: string, answer: ConnectionAnswer) => Promise<string | null>;
  withdraw: (id: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  block: (id: string) => Promise<string | null>;
  search: (q: string, filters: NetworkFilters) => Promise<{ people: NetworkRow[] } | { error: string }>;
  findMe: (on: boolean) => Promise<string | null>;
  /** Sends a message; between connections the Inbox chat opens at once. */
  message: (id: string, body: string) => Promise<string | null>;
  /** Reports the person into the same review queue as Inbox reports. They aren't told who reported. */
  report: (id: string, reason: ReportReason, note: string) => Promise<string | null>;
};

/** Where two people on the same line stand (a profile's "Gaps and path"): the pitstop each is at, numbered as on the Map, and its skill. */
export type LineStep = { step: number; name: string };

/**
 * "Gaps and path" on a profile, worked out only when the viewer may see the owner's gaps and both aim at the same role
 * the owner shows. `you` or `them` is null once that person has met every goal on their line.
 */
export type PathTogether = {
  /** Gaps both still have, by skill name. */
  gaps: string[];
  you: LineStep | null;
  them: LineStep | null;
  /** How many pitstops apart the two current steps are; null when either has met every goal. */
  apart: number | null;
  /** Why the viewer sees the owner's gaps: shared with connections, or with everyone who can open the profile. */
  sharedWith: "connections" | "profile";
};

/**
 * Interests both list (docs/plans/me-editing-plan.md): the owner's that the viewer also lists, as the owner wrote them;
 * how many the viewer lists ("2 of your 4"); and the owner's others.
 */
export type InterestsInCommon = { shared: string[]; yours: number; theirOthers: string[] };

/** "In common with you" on a profile (handoff 12j). Only what the owner's choices let this viewer see. */
export type ProfileInCommon = {
  /** Skills both have, by name; null when the owner doesn't show skills. */
  skills: string[] | null;
  /** The target role both aim at, when the owner shows theirs. */
  role: string | null;
  /** Null unless the viewer may see the owner's gaps and both are on the same line. */
  path: PathTogether | null;
  /** People both are connected to, never anyone either can't see. */
  mutual: { id: string; name: string; username: string | null }[];
  /** Null when either lists no interests. */
  interests?: InterestsInCommon | null;
};
