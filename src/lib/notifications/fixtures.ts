import type { NotificationView } from "./types";

/*
 * Example notifications for /design and the example shell (no sign-in): one of each kind, worded as the server words
 * them. Every person, company and job here is made up.
 */
export const exampleNotifications: NotificationView[] = [
  { id: "00000000-0000-4000-8000-0000000000e1", kind: "connection_request", text: "Ravi Menon asked to connect.", href: "/network?tab=requests", when: "2 h ago", isNew: true },
  {
    id: "00000000-0000-4000-8000-0000000000e2",
    kind: "interview_scheduled",
    text: "Example Labs set an interview for SOC Analyst L1: Wed 14 Oct, 11:00 IST.",
    href: "/arrivals",
    when: "5 h ago",
    isNew: true,
  },
  {
    id: "00000000-0000-4000-8000-0000000000e3",
    kind: "connection_accepted",
    text: "Ananya Rao accepted your request. You can message them now.",
    href: "/network",
    when: "Yesterday",
    isNew: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000e4",
    kind: "application_moved",
    text: "Example Labs moved your application for SOC Analyst L1 to Shortlisted.",
    href: "/arrivals",
    when: "Yesterday",
    isNew: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000e5",
    kind: "interview_cancelled",
    text: "Northwind Analytics cancelled the interview for Data Analyst.",
    href: "/arrivals",
    when: "3 days ago",
    isNew: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000e6",
    kind: "application_closed",
    text: "Northwind Analytics closed your application for Data Analyst. Their note is on Arrivals.",
    href: "/arrivals",
    when: "6 days ago",
    isNew: false,
  },
];

/** How many of the examples are new: the example shell's dot. */
export const exampleNewCount = exampleNotifications.filter((n) => n.isNew).length;
