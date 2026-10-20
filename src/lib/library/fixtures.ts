import { eliteShelfEntries, resources } from "@/content";
import type { EliteShelfView, LibraryItem, LibraryView } from "@/lib/schemas";
import { buildEliteShelf } from "./shelf";

/*
 * Example Library for the design page and the preview (no sign-in): a Data Analyst with three open goals. The links
 * are real entries of the free catalog; the goals, ticks and ride are made up.
 */
const items: LibraryItem[] = [
  { id: "r1", title: "Get started with Power BI Desktop", provider: "Microsoft Learn", kind: "docs", minutes: 90, url: "https://learn.microsoft.com/en-us/power-bi/fundamentals/desktop-getting-started", language: "English", skills: ["Power BI"] },
  { id: "r2", title: "DAX reference", provider: "Microsoft Learn", kind: "docs", minutes: 120, url: "https://learn.microsoft.com/en-us/dax/", language: "English", skills: ["Power BI"] },
  { id: "r3", title: "Power BI Data Analyst (PL-300) study guide and learning paths", provider: "Microsoft Learn", kind: "course", minutes: 1800, url: "https://learn.microsoft.com/en-us/credentials/certifications/data-analyst-associate/", language: "English", skills: ["Power BI"] },
  { id: "r4", title: "Data analysis bootcamp, 19 hours (freeCodeCamp, Alex the Analyst)", provider: "freeCodeCamp", kind: "video", minutes: 1140, url: "https://www.freecodecamp.org/news/learn-data-analysis-with-comprehensive-19-hour-bootcamp/", language: "English", skills: ["SQL", "Excel", "Tableau", "Power BI", "Python"] },
  { id: "r5", title: "Statistics and probability", provider: "Khan Academy", kind: "course", minutes: 1800, url: "https://www.khanacademy.org/math/statistics-probability", language: "English", skills: ["Statistics"] },
  { id: "r6", title: "OpenIntro Statistics (free textbook)", provider: "OpenIntro", kind: "docs", minutes: 1200, url: "https://www.openintro.org/book/os/", language: "English", skills: ["Statistics", "A/B testing"] },
  { id: "r7", title: "Python", provider: "Kaggle Learn", kind: "course", minutes: 300, url: "https://www.kaggle.com/learn/python", language: "English", skills: ["Python"] },
  { id: "r8", title: "Python for Beginners, full course in Hindi (CodeWithHarry)", provider: "CodeWithHarry", kind: "video", minutes: 1500, url: "https://www.youtube.com/playlist?list=PLu0W_9lII9agwh1XjRt242xIpHhPT2llg", language: "Hindi", skills: ["Python"] },
  { id: "r9", title: "The Python Tutorial", provider: "Python Software Foundation", kind: "docs", minutes: 600, url: "https://docs.python.org/3/tutorial/", language: "English", skills: ["Python"] },
  { id: "r10", title: "Data Visualization", provider: "Kaggle Learn", kind: "course", minutes: 240, url: "https://www.kaggle.com/learn/data-visualization", language: "English", skills: ["Data visualization"] },
  { id: "r11", title: "VLOOKUP function", provider: "Microsoft Support", kind: "docs", minutes: 20, url: "https://support.microsoft.com/en-us/office/vlookup-function-0bbc8083-26fe-4963-8ab8-93a18ad188a1", language: "English", skills: ["Excel pivot tables and lookups", "Excel"] },
];

export const exampleLibrary: LibraryView = {
  role: "Data Analyst",
  pathHref: null,
  goals: [
    {
      goalId: null,
      skillId: "power-bi",
      name: "Power BI",
      status: "missing",
      learnPitstop: 4,
      provePitstop: 5,
      now: true,
      learnDone: false,
      resourceIds: ["r1", "r2", "r4", "r3"],
      certificates: [{ name: "Microsoft Certified: Power BI Data Analyst Associate (PL-300)", issuer: "Microsoft" }],
    },
    {
      goalId: null,
      skillId: "statistics",
      name: "Statistics basics",
      status: "missing",
      learnPitstop: 6,
      provePitstop: 7,
      now: false,
      learnDone: true,
      resourceIds: ["r5", "r6"],
      certificates: [],
    },
    {
      goalId: null,
      skillId: "python",
      name: "Python with pandas",
      status: "weak",
      learnPitstop: null,
      provePitstop: 8,
      now: false,
      learnDone: false,
      resourceIds: ["r7", "r8", "r9", "r4"],
      certificates: [
        { name: "PCEP – Certified Entry-Level Python Programmer", issuer: "Python Institute" },
        { name: "PCAP – Certified Associate Python Programmer", issuer: "Python Institute" },
      ],
    },
  ],
  items,
  onRide: ["r1", "r2"],
  finished: ["r5", "r6"],
  saved: ["r10", "r3"],
  ticked: [],
  added: [],
  rideCourses: [],
};

/** The same person with no resume: no goals, the catalog for search. */
export const exampleLibraryNoResume: LibraryView = { role: null, pathHref: null, goals: [], items, onRide: [], finished: [], saved: [], ticked: [], added: [], rideCourses: [] };

/** The catalog's skills by URL, which the shelf reads to put the cards for a person's goals first. */
export const shelfSkillIdsByUrl: ReadonlyMap<string, readonly string[]> = new Map(resources.map((r) => [r.url, r.skillIds]));

/**
 * The real Elite shelf for the example person, Free (locked) or Elite. Its free sources are taken from the catalog file
 * as the healthy table would list them; the goals are the example's. Unchecked playbooks and drills show, as on preview.
 */
export function exampleEliteShelf(elite: boolean, allowUnreviewed = true): EliteShelfView {
  const urls = new Set(eliteShelfEntries.flatMap((e) => (e.type === "free" ? [e.url] : [])));
  const shelfItems: LibraryItem[] = resources
    .filter((r) => urls.has(r.url))
    .map((r, i) => ({ id: `shelf-${i + 1}`, title: r.title, provider: r.provider, kind: r.kind, minutes: r.minutes, url: r.url, language: r.language ?? "English", skills: [r.skillIds[0]] }));
  return buildEliteShelf({ elite, entries: eliteShelfEntries, items: shelfItems, skillIdsByUrl: shelfSkillIdsByUrl, goals: exampleLibrary.goals, allowUnreviewed });
}
