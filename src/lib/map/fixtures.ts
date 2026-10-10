import type { MapGoal, MapLine } from "@/lib/schemas";

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
