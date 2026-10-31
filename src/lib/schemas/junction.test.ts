import { describe, expect, it } from "vitest";
import {
  appealDecisionInput,
  appealInput,
  commentInput,
  feedQuery,
  intakeInput,
  junctionReportInput,
  legalHoldInput,
  pinInput,
  postCardView,
  postEditInput,
  postInput,
  voteInput,
} from "./junction";

const P = "00000000-0000-4000-8000-0000000000a1";
const I1 = "00000000-0000-4000-8000-0000000000b1";
const I2 = "00000000-0000-4000-8000-0000000000b2";
const I3 = "00000000-0000-4000-8000-0000000000b3";
const I4 = "00000000-0000-4000-8000-0000000000b4";

const base = { kind: "question", title: "How do I read Splunk alerts?", body: "I keep missing the noisy ones.", toRoute: true } as const;
const issueAt = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }, field: string) =>
  !r.success && (r.error?.issues ?? []).some((i) => i.path[0] === field);

describe("postInput", () => {
  it("takes a plain post and cleans its text", () => {
    const r = postInput.safeParse({ ...base, title: "  How do I   read Splunk alerts? ", body: "Line one\r\n\r\n\r\nLine two" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.title).toBe("How do I read Splunk alerts?");
    expect(r.data.body).toBe("Line one\n\nLine two");
    expect(r.data.link).toBeNull();
    expect(r.data.interestIds).toEqual([]);
    expect(r.data.showGoal).toBe(false);
  });

  it("is strict: no user id, status or counts from the browser", () => {
    expect(postInput.safeParse({ ...base, authorId: P }).success).toBe(false);
    expect(postInput.safeParse({ ...base, status: "visible" }).success).toBe(false);
    expect(postInput.safeParse({ ...base, upvotes: 9 }).success).toBe(false);
  });

  it("keeps the title to 5 to 140 characters and the body to 2,000", () => {
    expect(issueAt(postInput.safeParse({ ...base, title: "Hey" }), "title")).toBe(true);
    expect(issueAt(postInput.safeParse({ ...base, title: "x".repeat(141) }), "title")).toBe(true);
    expect(postInput.safeParse({ ...base, title: "x".repeat(140) }).success).toBe(true);
    expect(issueAt(postInput.safeParse({ ...base, body: "x".repeat(2001) }), "body")).toBe(true);
    expect(postInput.safeParse({ ...base, body: "x".repeat(2000) }).success).toBe(true);
  });

  it("refuses phone numbers and email addresses in the title and body", () => {
    expect(issueAt(postInput.safeParse({ ...base, body: "Call me on 98765 43210" }), "body")).toBe(true);
    expect(issueAt(postInput.safeParse({ ...base, body: "Mail priya@example.com" }), "body")).toBe(true);
    expect(issueAt(postInput.safeParse({ ...base, title: "Write to priya@example.com" }), "title")).toBe(true);
  });

  it("refuses links written into the text, but lets bare domains stand as words", () => {
    expect(issueAt(postInput.safeParse({ ...base, body: "See https://example.com/x" }), "body")).toBe(true);
    expect(issueAt(postInput.safeParse({ ...base, body: "See www.example.com" }), "body")).toBe(true);
    expect(postInput.safeParse({ ...base, body: "I learnt it on freecodecamp.org last year" }).success).toBe(true);
  });

  it("cleans the one link: https only, no shortener, IP or port, tracking dropped", () => {
    const ok = postInput.safeParse({ ...base, kind: "resource", link: "https://learn.microsoft.com/en-us/training/?utm_source=x&a=1#top" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.link).toEqual({ url: "https://learn.microsoft.com/en-us/training/?a=1", host: "learn.microsoft.com" });
    for (const bad of ["http://example.com/x", "https://bit.ly/abc", "https://10.0.0.1/x", "https://example.com:8443/x", "https://user@example.com/x", "not a link"])
      expect(issueAt(postInput.safeParse({ ...base, link: bad }), "link")).toBe(true);
  });

  it("needs an audience: My route or at least one interest", () => {
    expect(issueAt(postInput.safeParse({ ...base, toRoute: false }), "toRoute")).toBe(true);
    expect(postInput.safeParse({ ...base, toRoute: false, interestIds: [I1] }).success).toBe(true);
    expect(postInput.safeParse({ ...base, toRoute: false, newInterests: ["Public speaking"] }).success).toBe(true);
  });

  it("takes at most three interests, picked and new together", () => {
    expect(postInput.safeParse({ ...base, interestIds: [I1, I2, I3] }).success).toBe(true);
    expect(postInput.safeParse({ ...base, interestIds: [I1, I2, I3, I4] }).success).toBe(false);
    expect(postInput.safeParse({ ...base, interestIds: [I1, I2], newInterests: ["Design", "Writing"] }).success).toBe(false);
    expect(postInput.safeParse({ ...base, newInterests: ["x".repeat(41)] }).success).toBe(false);
    expect(postInput.safeParse({ ...base, newInterests: ["call 98765 43210"] }).success).toBe(false);
    expect(postInput.safeParse({ ...base, interestIds: ["not-a-uuid"] }).success).toBe(false);
  });

  it("needs a link on a Resource post only", () => {
    expect(issueAt(postInput.safeParse({ ...base, kind: "resource" }), "link")).toBe(true);
    expect(postInput.safeParse({ ...base, kind: "resource", link: "https://www.kaggle.com/learn/python" }).success).toBe(true);
    expect(postInput.safeParse({ ...base, kind: "win" }).success).toBe(true);
    expect(postInput.safeParse({ ...base, kind: "poll" }).success).toBe(false);
  });
});

describe("postEditInput and commentInput", () => {
  it("edits with the same text rules, strict", () => {
    expect(postEditInput.safeParse({ postId: P, title: "A better title", body: "" }).success).toBe(true);
    expect(postEditInput.safeParse({ postId: P, title: "A better title", kind: "win" }).success).toBe(false);
    expect(postEditInput.safeParse({ postId: P, title: "Mail me at a@b.co" }).success).toBe(false);
  });

  it("takes a comment of 1 to 1,000 characters with no contact details or links", () => {
    expect(commentInput.safeParse({ postId: P, body: "Try tuning the threshold first." }).success).toBe(true);
    expect(commentInput.safeParse({ postId: P, body: "   " }).success).toBe(false);
    expect(commentInput.safeParse({ postId: P, body: "x".repeat(1001) }).success).toBe(false);
    expect(commentInput.safeParse({ postId: P, body: "WhatsApp +91 98765 43210" }).success).toBe(false);
    expect(commentInput.safeParse({ postId: P, body: "Read https://example.com" }).success).toBe(false);
    expect(commentInput.safeParse({ postId: P, body: "ok", authorId: P }).success).toBe(false);
  });
});

describe("toggles, pins and the feed query", () => {
  it("take ids only", () => {
    expect(voteInput.safeParse({ postId: P }).success).toBe(true);
    expect(voteInput.safeParse({ postId: P, userId: P }).success).toBe(false);
    expect(pinInput.safeParse({ postId: P, position: 1 }).success).toBe(true);
    expect(pinInput.safeParse({ postId: P, position: null }).success).toBe(true);
    expect(pinInput.safeParse({ postId: P, position: 4 }).success).toBe(false);
  });

  it("defaults to Top this week and refuses an odd cursor", () => {
    const r = feedQuery.safeParse({});
    expect(r.success && r.data.feed).toBe("top");
    expect(feedQuery.safeParse({ feed: "interests", interestId: I1, cursor: "MTA_abc-1" }).success).toBe(true);
    expect(feedQuery.safeParse({ feed: "hot" }).success).toBe(false);
    expect(feedQuery.safeParse({ cursor: "a b" }).success).toBe(false);
  });
});

describe("reports, appeals and the admin's inputs", () => {
  it("reports a post or comment with Junction's reasons and a note up to 500", () => {
    expect(junctionReportInput.safeParse({ target: "post", targetId: P, reason: "child_safety" }).success).toBe(true);
    expect(junctionReportInput.safeParse({ target: "comment", targetId: P, reason: "harassment", note: "x".repeat(500) }).success).toBe(true);
    expect(junctionReportInput.safeParse({ target: "comment", targetId: P, reason: "harassment", note: "x".repeat(501) }).success).toBe(false);
    expect(junctionReportInput.safeParse({ target: "message", targetId: P, reason: "harassment" }).success).toBe(false);
    expect(junctionReportInput.safeParse({ target: "post", targetId: P, reason: "made_up" }).success).toBe(false);
  });

  it("appeals with a note of 1 to 1,000", () => {
    expect(appealInput.safeParse({ removalId: P, note: "It was a quote from the course." }).success).toBe(true);
    expect(appealInput.safeParse({ removalId: P, note: " " }).success).toBe(false);
    expect(appealInput.safeParse({ removalId: P, note: "x".repeat(1001) }).success).toBe(false);
  });

  it("decides an appeal with a reason, and sets a legal hold", () => {
    expect(appealDecisionInput.safeParse({ appealId: P, decision: "reversed", reason: "Quoted fairly." }).success).toBe(true);
    expect(appealDecisionInput.safeParse({ appealId: P, decision: "open", reason: "x" }).success).toBe(false);
    expect(appealDecisionInput.safeParse({ appealId: P, decision: "upheld", reason: "" }).success).toBe(false);
    expect(legalHoldInput.safeParse({ removalId: P, hold: true }).success).toBe(true);
  });

  it("logs a complaint or order received in the past, with who sent it", () => {
    const ok = { source: "court_order", receivedAt: "2026-10-20T10:00:00+05:30", fromLabel: "District court, Pune", reference: "CS 12/2026", target: "post", targetId: P, reason: "other" };
    expect(intakeInput.safeParse(ok).success).toBe(true);
    expect(intakeInput.safeParse({ ...ok, fromLabel: " " }).success).toBe(false);
    expect(intakeInput.safeParse({ ...ok, receivedAt: "2999-01-01T00:00:00Z" }).success).toBe(false);
    expect(intakeInput.safeParse({ ...ok, source: "phone" }).success).toBe(false);
  });
});

describe("postCardView", () => {
  const card = {
    id: P,
    kind: "question",
    title: "How do I read Splunk alerts?",
    body: "",
    link: null,
    catalog: null,
    goal: null,
    author: { name: "Priya Sharma", handle: "priya-s", initials: "PS", route: null, isYou: false },
    routeLabel: null,
    interests: [{ id: I1, name: "AI" }],
    upvotes: 1,
    comments: 0,
    reshares: 0,
    voted: false,
    saved: false,
    reshared: false,
    resharedBy: null,
    status: "visible",
    createdAt: "2026-10-31T10:00:00.000Z",
    editedAt: null,
  };

  it("carries no email or anyone's user id", () => {
    expect(postCardView.safeParse(card).success).toBe(true);
    expect(postCardView.safeParse({ ...card, authorId: P }).success).toBe(false);
    expect(postCardView.safeParse({ ...card, author: { ...card.author, email: "p@example.com" } }).success).toBe(false);
  });

  it("carries the catalog card and the goal line as live values, never a gap list", () => {
    const full = { ...card, catalog: { title: "SQL for data analysis", provider: "Kaggle Learn", kind: "course", minutes: 240 }, goal: { step: 6, of: 9, skill: "Python scripting", met: false } };
    expect(postCardView.safeParse(full).success).toBe(true);
    expect(postCardView.safeParse({ ...full, goal: { ...full.goal, gaps: ["SQL"] } }).success).toBe(false);
    expect(postCardView.safeParse({ ...full, goal: { ...full.goal, step: 0 } }).success).toBe(false);
  });
});
