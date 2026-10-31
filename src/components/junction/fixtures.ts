import type { ComposerProps } from "./composer";
import type { RailProps } from "./rail";
import type { CommentView, PostCardView, RemovalNotice } from "@/lib/schemas/junction";

/* Example Junction data for the /design gallery. Every name, post and number is made up. */

export const exampleJunctionNow = "2026-10-31T12:00:00.000Z";

const author = (name: string, handle: string | null, initials: string, route: string | null = null, isYou = false) => ({ name, handle, initials, route, isYou });

export const exampleJunctionPosts: PostCardView[] = [
  {
    id: "1a2b3c4d-0000-4000-8000-000000000001",
    kind: "win",
    title: "Automated my first log check in Python, after three weeks on the goal",
    body: "Started with the Microsoft Learn module, then wrote a 40-line script that flags failed logins.\nTook me three tries to get the regex right.",
    link: null,
    catalog: null,
    goal: { step: 6, of: 9, skill: "Python scripting", met: true },
    author: author("Arjun Mehta", "arjun-m", "AM", "Cyber Security Analyst"),
    routeLabel: "Cyber Security Analyst",
    interests: [
      { id: "2b3c4d5e-0000-4000-8000-000000000001", name: "AI" },
      { id: "2b3c4d5e-0000-4000-8000-000000000002", name: "Python" },
    ],
    upvotes: 14,
    comments: 3,
    reshares: 2,
    voted: true,
    saved: false,
    reshared: false,
    resharedBy: null,
    status: "visible",
    createdAt: "2026-10-31T09:10:00.000Z",
    editedAt: null,
  },
  {
    id: "1a2b3c4d-0000-4000-8000-000000000002",
    kind: "resource",
    title: "Free SQL course that finally made window functions click",
    body: "Do the RANK lesson before the practice table.",
    link: { url: "https://www.kaggle.com/learn/advanced-sql", host: "www.kaggle.com" },
    catalog: { title: "Advanced SQL", provider: "Kaggle Learn", kind: "course", minutes: 240 },
    goal: null,
    author: author("Sana Iyer", null, "SI"),
    routeLabel: null,
    interests: [{ id: "2b3c4d5e-0000-4000-8000-000000000003", name: "Data" }],
    upvotes: 9,
    comments: 1,
    reshares: 4,
    voted: false,
    saved: true,
    reshared: true,
    resharedBy: "Bina Rao",
    status: "visible",
    createdAt: "2026-10-30T15:00:00.000Z",
    editedAt: "2026-10-30T15:12:00.000Z",
  },
  {
    id: "1a2b3c4d-0000-4000-8000-000000000003",
    kind: "question",
    title: "How do you read a Splunk alert without getting lost in the fields?",
    body: "",
    link: null,
    catalog: null,
    goal: { step: 3, of: 9, skill: "SIEM and log analysis", met: false },
    author: author("Priya Nair", "priya-n", "PN", "Cyber Security Analyst", true),
    routeLabel: "Cyber Security Analyst",
    interests: [],
    upvotes: 2,
    comments: 0,
    reshares: 0,
    voted: false,
    saved: false,
    reshared: false,
    resharedBy: null,
    status: "visible",
    createdAt: "2026-10-31T11:48:00.000Z",
    editedAt: null,
  },
];

/** Your own post held after reports, and one hidden, as only you see them. */
export const exampleHeldPost: PostCardView = { ...exampleJunctionPosts[2]!, id: "1a2b3c4d-0000-4000-8000-000000000004", status: "held", createdAt: "2026-10-30T08:00:00.000Z" };
export const exampleHiddenPost: PostCardView = {
  ...exampleJunctionPosts[2]!,
  id: "1a2b3c4d-0000-4000-8000-000000000005",
  kind: "idea",
  title: "Thinking of a study group for the SIEM goal",
  status: "hidden",
  createdAt: "2026-10-28T08:00:00.000Z",
  goal: null,
};

export const exampleJunctionComments: CommentView[] = [
  {
    id: "3c4d5e6f-0000-4000-8000-000000000001",
    postId: exampleJunctionPosts[0]!.id,
    body: "Nice! Did you use the re module or something bigger?",
    author: author("Bina Rao", "bina-r", "BR"),
    upvotes: 9,
    voted: false,
    status: "visible",
    createdAt: "2026-10-31T10:00:00.000Z",
  },
  {
    id: "3c4d5e6f-0000-4000-8000-000000000002",
    postId: exampleJunctionPosts[0]!.id,
    body: "Just re, and a list of known service accounts to skip.",
    author: author("Priya Nair", "priya-n", "PN", null, true),
    upvotes: 1,
    voted: false,
    status: "visible",
    createdAt: "2026-10-31T11:20:00.000Z",
  },
];

export const exampleComposer: ComposerProps = {
  routeLabel: "Cyber Security Analyst",
  interests: [
    { id: "2b3c4d5e-0000-4000-8000-000000000001", name: "AI" },
    { id: "2b3c4d5e-0000-4000-8000-000000000002", name: "Python" },
    { id: "2b3c4d5e-0000-4000-8000-000000000004", name: "Public speaking" },
  ],
  goal: { step: 3, of: 9, skill: "SIEM and log analysis", met: false },
};

export const exampleComposerNoRoute: ComposerProps = { routeLabel: null, interests: [], goal: null };

export const exampleRail: RailProps = {
  yours: { posts: 4, upvotes: 23, reshares: 3 },
  interests: ["AI", "Python", "Public speaking"],
  routeTags: [
    { id: "2b3c4d5e-0000-4000-8000-000000000002", name: "Python", count: 6 },
    { id: "2b3c4d5e-0000-4000-8000-000000000001", name: "AI", count: 4 },
    { id: "2b3c4d5e-0000-4000-8000-000000000005", name: "Interviews", count: 2 },
  ],
  routeLabel: "Cyber Security Analyst",
};

export const exampleNotices: RemovalNotice[] = [
  {
    removalId: "4d5e6f70-0000-4000-8000-000000000001",
    target: "post",
    rule: "Fake job, scam or spam",
    removedAt: "2026-10-29T10:00:00.000Z",
    appealBy: "2026-11-28T10:00:00.000Z",
    appeal: null,
    canAppeal: true,
  },
  {
    removalId: "4d5e6f70-0000-4000-8000-000000000002",
    target: "comment",
    rule: "Harassment, threats or bullying",
    removedAt: "2026-10-20T10:00:00.000Z",
    appealBy: "2026-11-19T10:00:00.000Z",
    appeal: { status: "open", decidedAt: null },
    canAppeal: false,
  },
];
