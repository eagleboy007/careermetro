import type { JunctionFeed, JunctionReportReason } from "@/lib/schemas/constants";
import type { FeedPage, PostEditInput, PostInput } from "@/lib/schemas/junction";

/*
 * What Junction's screens (docs/plans/junction-plan.md section 4, FR-61) get from the server actions in
 * src/app/(app)/junction/actions.ts. Client components take these as props; without them (the /design gallery) they
 * run on example data and nothing is sent. Every message is words to show; none carries post or comment text.
 */

export type JunctionAct = { ok: true; message?: string } | { ok: false; message: string };
export type JunctionToggle = { ok: true; on: boolean } | { ok: false; message: string };
export type JunctionReportAct = { ok: true; reference: string; decideBy: string } | { ok: false; message: string };
/** Me's interest editor's result shape, so the rail reuses Me's editor (null error = saved). */
export type InterestAct = { error: string | null; field?: string };

export type FeedRequest = { feed: JunctionFeed; interestId?: string; cursor: string };
export type MineTab = "posts" | "saved";

/** The actions a post card and its detail page use. */
export type PostActions = {
  vote: (postId: string) => Promise<JunctionToggle>;
  reshare: (postId: string) => Promise<JunctionToggle>;
  save: (postId: string) => Promise<JunctionToggle>;
  edit: (input: PostEditInput) => Promise<JunctionAct>;
  remove: (postId: string) => Promise<JunctionAct>;
  pin: (postId: string, position: number | null) => Promise<JunctionAct>;
  report: (target: "post" | "comment", targetId: string, reason: JunctionReportReason, note: string) => Promise<JunctionReportAct>;
};

export type CommentActions = {
  add: (postId: string, body: string) => Promise<JunctionAct>;
  vote: (commentId: string) => Promise<JunctionToggle>;
  remove: (commentId: string) => Promise<JunctionAct>;
  report: PostActions["report"];
};

export type ComposerActions = {
  create: (input: PostInput) => Promise<JunctionAct>;
  acceptRules: () => Promise<JunctionAct>;
};

export type FeedActions = { more: (req: FeedRequest) => Promise<FeedPage | null> };
export type MineActions = { more: (tab: MineTab, cursor: string) => Promise<FeedPage | null>; appeal: (removalId: string, note: string) => Promise<JunctionAct> };
export type RailActions = { addInterest: (name: string) => Promise<InterestAct>; removeInterest: (name: string) => Promise<InterestAct> };
export type ProfileActions = { showPosts: (on: boolean) => Promise<string | null> };

/** "Posted 12 min ago", worked out from the server's clock passed down, so the server and browser agree. */
export function agoWords(iso: string, nowIso: string, dayWords: (at: string) => string): string {
  const mins = Math.floor((Date.parse(nowIso) - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return dayWords(iso);
}

/**
 * The edit window as the screens show it. Client components can't load src/lib/schemas/legal-timings.ts (the
 * client-bundle test keeps the schemas folder off phones), so it is repeated here and types.test.ts holds it equal to
 * EDIT_WINDOW_MINUTES, which the store enforces.
 */
export const EDIT_WINDOW_MINUTES_SHOWN = 30;

/** Whether the author may still edit (30 minutes from posting), by the server's clock. */
export const editableAt = (createdAt: string, nowIso: string, windowMinutes: number): boolean => Date.parse(nowIso) - Date.parse(createdAt) <= windowMinutes * 60_000;
