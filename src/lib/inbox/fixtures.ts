import type { InboxThread } from "./types";

/**
 * Example Inbox (prototype v2, Priya's side of the Corporate mockup). Real chats need the message tables
 * (dev/inbox-plan.md) and someone to talk to: the employer side for applications, Network for people.
 */
export const exampleThreads: InboxThread[] = [
  {
    id: "konark",
    kind: "application",
    name: "Konark Payments",
    job: "Security operations trainee",
    unread: true,
    messages: [
      { by: "system", text: "Conversation started when you applied with Express apply, 7 Oct." },
      { by: "them", who: "Meera Iyer", text: "Hi Priya, thanks for applying. We would like to set up a 30-minute first call with our SOC lead.", at: "Thu 11:02" },
      { by: "them", who: "Meera Iyer", type: "times", text: "Which times work for you between Mon 13 and Fri 17 Oct?", at: "Thu 11:03" },
    ],
  },
  {
    id: "sameer",
    kind: "request",
    name: "Sameer Kulkarni",
    status: "Working at Garuda Logistics",
    unread: true,
    messages: [{ by: "them", text: "Hi Priya, I read your Junction post on Splunk alerts. Could I ask you two questions about it?", at: "Thu 08:20" }],
  },
  {
    id: "arjun",
    kind: "person",
    name: "Arjun Mehta",
    status: "Working at Kavach Cyber Labs",
    unread: false,
    messages: [
      { by: "them", text: "Saw you are on the SIEM goal. I did the same switch from desktop support. Happy to look at your BOTS searches.", at: "Tue 21:04" },
      { by: "me", text: "That would help a lot. I am stuck on the third search.", at: "Tue 21:30" },
      { by: "them", text: "Send it over on Saturday morning.", at: "Tue 21:32" },
    ],
  },
  {
    id: "sahyadri",
    kind: "application",
    name: "Sahyadri Fintech",
    job: "IT support and security engineer",
    unread: false,
    messages: [
      { by: "them", who: "Rohan Desai", type: "question", text: "Before Friday: are you open to rotating shifts, including one night a week?", at: "Wed 15:40" },
      { by: "me", text: "Yes, one night a week is fine. I would prefer not to do two nights in a row.", at: "Wed 18:05" },
      { by: "them", who: "Rohan Desai", text: "Noted, thanks. See you on Friday at 11.", at: "Wed 18:20" },
    ],
  },
];

/** The slot grid for "Asking for interview times": five weekdays and four times, with the example calendar's busy slots. */
export const exampleSlots = {
  days: [
    ["Mon", "13"],
    ["Tue", "14"],
    ["Wed", "15"],
    ["Thu", "16"],
    ["Fri", "17"],
  ] as const,
  times: ["11:00", "15:00", "17:00", "18:00"] as const,
  busy: ["0-0", "1-1", "2-0", "3-1", "4-0", "1-3"] as const,
};

export const exampleAvailability = { usuallyFree: "Weekdays after 17:00, Sat 10:00 to 13:00", calendar: "Google · busy and free only" };
