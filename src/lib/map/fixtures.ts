import type { LifeLine, LifeMoment, MapGoal, MapLine } from "@/lib/schemas";

// Synthetic example line for the design page and the Map preview, matching the Today example (Pitstop 4 of 9).

const goal = (g: Partial<MapGoal> & Pick<MapGoal, "skillId" | "name" | "status">): MapGoal => ({
  learnDone: false,
  proved: false,
  resources: [],
  practice: null,
  ...g,
});

export const exampleMapLine: MapLine = {
  role: { slug: "data-analyst", title: "Data Analyst" },
  resumeId: null,
  skillsFound: 12,
  pathOpened: true,
  goals: [
    goal({ skillId: "excel", name: "Excel pivot tables", status: "weak", proved: true, resources: [{ title: "Excel pivot tables", detail: "Microsoft Learn · course · 2 h" }] }),
    goal({ skillId: "sql", name: "SQL joins", status: "weak", proved: true, resources: [{ title: "Intro to SQL", detail: "Kaggle Learn · course · 3 h" }] }),
    goal({ skillId: "statistics", name: "Statistics basics", status: "outdated", proved: true, resources: [{ title: "Statistics and probability", detail: "Khan Academy · video · 6 h" }] }),
    goal({
      skillId: "sql-window-functions",
      name: "SQL window functions",
      status: "missing",
      resources: [
        { title: "Advanced SQL", detail: "Kaggle Learn · course · 4 h" },
        { title: "Window functions", detail: "PostgreSQL docs · reading · 1 h" },
      ],
      practice: "Rank the top 5 products per month in the sample sales table, then explain each query.",
    }),
    goal({
      skillId: "power-bi",
      name: "Power BI",
      status: "missing",
      resources: [{ title: "Get started with Power BI", detail: "Microsoft Learn · course · 5 h" }],
      practice: "Build a one-page sales dashboard from the sample data.",
    }),
    goal({ skillId: "python", name: "Python with pandas", status: "weak", resources: [{ title: "Pandas", detail: "Kaggle Learn · course · 4 h" }] }),
    goal({ skillId: "data-storytelling", name: "Data storytelling", status: "weak", resources: [{ title: "Data visualization", detail: "freeCodeCamp · video · 2 h" }] }),
  ],
  otherLines: [
    { slug: "business-analyst", title: "Business Analyst", skillId: "power-bi" },
    { slug: "data-engineer", title: "Data Engineer", skillId: "python" },
  ],
};

const moment = (m: Omit<LifeMoment, "verified"> & { verified?: boolean }): LifeMoment => ({ verified: false, ...m });

/** A three-year career, drawn whole. */
export const exampleLifeLine: LifeLine = {
  now: 2026.77,
  destination: "Data Analyst",
  undated: [],
  moments: [
    moment({ id: "j1", row: "journey", t: 2023.45, date: "Jun 2023", name: "Journey started", heading: "Your journey started", detail: "Your working life began after your B.Com, so your journey starts here, not the day you joined CareerMetro." }),
    moment({ id: "j2", row: "journey", t: 2026.67, date: "Sep 2026", name: "Joined CareerMetro", heading: "Joined CareerMetro · heading for Data Analyst", detail: "You set your next destination here. Pitstops and prep live on the Role line; this map keeps only the big moments." }),
    moment({ id: "e1", row: "education", t: 2020.5, date: "Jul 2020", name: "B.Com", heading: "B.Com", detail: "Savitribai Phule Pune University." }),
    moment({ id: "e2", row: "education", t: 2023.45, date: "Jun 2023", name: "Graduated", heading: "Graduated", detail: "Final-year project: sales trends for a local co-operative, in Excel." }),
    moment({ id: "w1", row: "work", t: 2024.0, date: "Jan 2024", name: "MIS Intern", heading: "MIS Intern · Western Ghats Logistics", detail: "Five months of weekly Excel reports." }),
    moment({ id: "w2", row: "work", t: 2024.45, date: "Jun 2024", name: "MIS Executive", heading: "MIS Executive · Konkan Co-operative Bank", detail: "Since Jun 2024. Current role." }),
    moment({ id: "c1", row: "certificates", t: 2025.6, date: "Aug 2025", name: "Google Data Analytics", heading: "Google Data Analytics Certificate", detail: "Verified through its Credly badge.", verified: true }),
    moment({ id: "i1", row: "interests", t: 2021.2, date: "Mar 2021", name: "Photography", heading: "Photography", detail: "Weekend street photography." }),
    moment({ id: "i2", row: "interests", t: 2023.8, date: "Oct 2023", name: "Public speaking", heading: "Public speaking · Toastmasters Pune", detail: "Eight speeches so far." }),
    moment({ id: "i3", row: "interests", t: 2025.9, date: "Nov 2025", name: "AI for everyone", heading: "AI for everyone (free course)", detail: "Prompting and AI basics." }),
  ],
};
