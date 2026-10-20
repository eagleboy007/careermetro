import type { ExampleNetworkRow, NetworkData, NetworkRow, ProfileInCommon } from "./types";

/* Example Network for /design and the preview without accounts (handoff 12j, prototype v39). Every person is made up. */

const row = (r: Partial<NetworkRow> & Pick<NetworkRow, "id" | "name" | "state">): NetworkRow => ({
  username: null,
  aim: null,
  verified: false,
  common: 0,
  mutual: 0,
  how: null,
  when: null,
  ...r,
});

export const exampleNetwork: NetworkData = {
  connections: [
    row({ id: "ex-vr", name: "Vikram Rao", username: "vikram-r", aim: "Cloud Engineer", verified: true, common: 4, state: "connected", how: "event", when: "Connected 12 Oct 2026" }),
    row({ id: "ex-nb", name: "Neha Bhat", username: "neha-b", aim: "Cyber Security Analyst", common: 2, state: "connected", how: "same_line", when: "Connected 18 Sep 2026" }),
    row({ id: "ex-ks", name: "Karan Singh", username: "karan-s", verified: true, common: 7, state: "connected", how: "worked_together", when: "Connected 2 Aug 2026" }),
  ],
  requests: [
    row({ id: "ex-rv", name: "Rahul Verma", username: "rahul-v", aim: "Cyber Security Analyst", common: 3, mutual: 1, state: "incoming", how: "same_line", when: "Asked 17 Oct" }),
  ],
  sent: [row({ id: "ex-sk", name: "Sneha Kulkarni", username: "sneha-k", aim: "Cyber Security Analyst", common: 5, mutual: 2, state: "requested", how: "same_line", when: "Sent 16 Oct · ends 15 Nov if not answered" })],
  peopleCanFind: false,
  profileLink: null,
  myRole: "Cyber Security Analyst",
  myCity: "Pune",
};

/** What an example name search finds. Nobody's city is on a row; `inMyCity` stands in for the server's "In <city>" match. */
export const exampleSearch: ExampleNetworkRow[] = [
  row({ id: "ex-am", name: "Arjun Mehta", username: "arjun-m", aim: "Cyber Security Analyst", verified: true, common: 6, mutual: 2, state: "none" }),
  { ...row({ id: "ex-ak", name: "Aditi Kulkarni", username: "aditi-k", aim: "Cloud Engineer", common: 2, mutual: 2, state: "none" }), inMyCity: true },
];

/** Example "In common with you" for a profile on /design: two people on the same line, connected through one friend. */
export const exampleInCommon: ProfileInCommon = {
  skills: ["Linux", "Networking basics", "Windows admin"],
  role: "Cyber Security Analyst",
  path: {
    gaps: ["AWS security", "SIEM", "Threat detection"],
    you: { step: 4, name: "SIEM" },
    them: { step: 6, name: "Python" },
    apart: 2,
    sharedWith: "connections",
  },
  mutual: [
    { id: "ex-vr", name: "Vikram Rao", username: "vikram-r" },
    { id: "ex-nb", name: "Neha Bhat", username: "neha-b" },
  ],
  interests: { shared: ["AI", "Public speaking"], yours: 4, theirOthers: ["Chess", "Cricket analytics"] },
};
