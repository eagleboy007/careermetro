import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import type { Profile } from "@/lib/schemas";
import { certificationsIn, isListLine, matchProfile, matchResult, MATCHER_VERSION } from "./match";

const role = (slug: string) => roleProfiles.find((r) => r.slug === slug)!;
const dataAnalyst = role("data-analyst");
const now = new Date("2026-10-07T00:00:00Z");

const profile = (patch: Partial<Profile>): Profile => ({
  headline: null,
  totalYearsExperience: 3,
  roles: [],
  skills: [],
  education: [],
  certifications: [],
  ...patch,
});

const statusOf = (r: ReturnType<typeof matchProfile>, id: string) => [...r.gaps, ...r.met, ...r.niceToHave].find((s) => s.skillId === id)?.status;

describe("matchProfile", () => {
  it("meets a skill shown in a recent job, citing the line", () => {
    const r = matchProfile(
      profile({
        roles: [{ title: "Analyst", employer: "Example Retail", start: "2023-01", end: null, highlights: ["Wrote SQL queries for weekly sales reports"] }],
      }),
      dataAnalyst,
      now,
    );
    expect(r.met.find((s) => s.skillId === "sql")).toMatchObject({ status: "met", resumeQuote: "Wrote SQL queries for weekly sales reports" });
    expect(matchResult.parse(r).matcherVersion).toBe(MATCHER_VERSION);
  });

  it("calls a skill that is only listed weak evidence", () => {
    const r = matchProfile(profile({ skills: [{ name: "SQL", lastUsed: null, evidence: ["SKILLS: SQL, Excel, Power BI"] }] }), dataAnalyst, now);
    expect(r.gaps.find((g) => g.skillId === "sql")).toMatchObject({ status: "weak", resumeQuote: "SKILLS: SQL, Excel, Power BI" });
  });

  it("calls a skill last used more than four years ago outdated", () => {
    const r = matchProfile(
      profile({
        roles: [{ title: "MIS Executive", employer: "Example Bank", start: "2014-01", end: "2019-03", highlights: ["Built Python scripts to merge branch reports"] }],
      }),
      dataAnalyst,
      now,
    );
    expect(statusOf(r, "python")).toBe("outdated");
  });

  it("marks a skill with no evidence missing, with no quote", () => {
    const r = matchProfile(profile({}), dataAnalyst, now);
    expect(r.gaps.find((g) => g.skillId === "statistics")).toMatchObject({ status: "missing", resumeQuote: null });
    expect(r.readiness).toMatchObject({ requiredMet: 0, requiredTotal: r.gaps.length });
  });

  it("orders gaps by how often postings ask for them, and only required skills are gaps", () => {
    const r = matchProfile(profile({}), dataAnalyst, now);
    const shares = r.gaps.map((g) => g.postingShare ?? -1);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    const required = new Set(dataAnalyst.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
    expect(r.gaps.every((g) => required.has(g.skillId))).toBe(true);
    expect(r.niceToHave.length).toBe(dataAnalyst.skills.length - required.size);
  });

  it("doesn't find short names like Go or ML inside sentences, but trusts them when listed with an example", () => {
    const devops = roleProfiles.find((r) => r.slug === "devops-engineer")!;
    const sentence = profile({ roles: [{ title: "Admin", employer: "X", start: null, end: null, highlights: ["Ran go-live checks for 12 servers"] }] });
    expect(statusOf(matchProfile(sentence, devops, now), "go")).toBe("missing");
    const listed = profile({ skills: [{ name: "Go", lastUsed: null, evidence: ["Wrote a log shipper in Go for 12 servers"] }] });
    expect(statusOf(matchProfile(listed, devops, now), "go")).toBe("met");
  });

  it("gives the same result for the same input", () => {
    const p = profile({ skills: [{ name: "Excel", lastUsed: null, evidence: ["Built pivot tables for the monthly payables report"] }] });
    expect(matchProfile(p, dataAnalyst, now)).toEqual(matchProfile(p, dataAnalyst, now));
  });

  const job = (highlights: string[], start = "2023-01", end: string | null = null) => ({ title: "Engineer", employer: "Example Pvt Ltd", start, end, highlights });
  const scan = (slug: string, highlights: string[]) => matchProfile(profile({ roles: [job(highlights)] }), role(slug), now);

  it("counts real job bullets that name several tools as use, not as a list", () => {
    expect(statusOf(scan("devops-engineer", ["Built CI/CD pipelines using Jenkins/GitHub Actions for 40 microservices"]), "ci-cd")).toBe("met");
    expect(statusOf(scan("java-backend-developer", ["Developed payment APIs using Java, Spring Boot, MySQL and Kafka for an HDFC project"]), "java")).toBe("met");
    expect(statusOf(scan("devops-engineer", ["Automated Jenkins builds"]), "ci-cd")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Wrote SQL queries"]), "sql")).toBe("met");
    const listed = profile({
      roles: [job([])],
      skills: [{ name: "Java", lastUsed: null, evidence: ["Developed payment APIs using Java, Spring Boot, MySQL and Kafka for an HDFC project"] }],
    });
    expect(statusOf(matchProfile(listed, role("java-backend-developer"), now), "java")).toBe("met");
  });

  it("still treats skills sections as lists", () => {
    expect(isListLine("SKILLS: SQL, Excel, Power BI")).toBe(true);
    expect(isListLine("SQL, Excel, Power BI, Tableau, Jira, SAP")).toBe(true);
    expect(isListLine("Python (Pandas, NumPy)")).toBe(true);
    expect(isListLine("MS-Excel")).toBe(true);
    expect(isListLine("Tracked KPIs, churn, and NPS weekly for the leadership team")).toBe(false);
  });

  it("treats learning or wanting a skill as interest, not use", () => {
    expect(statusOf(scan("data-analyst", ["Currently learning Python through an NPTEL course"]), "python")).toBe("weak");
    expect(statusOf(scan("data-analyst", ["Keen to learn Python for report automation"]), "python")).toBe("weak");
    expect(statusOf(scan("devops-engineer", ["Basic exposure to AWS and Azure cloud"]), "aws")).toBe("weak");
    expect(statusOf(scan("data-scientist", ["Built a churn model with machine learning on 2 lakh customer rows"]), "machine-learning")).toBe("met");
  });

  it("doesn't read ordinary words as skills", () => {
    expect(statusOf(scan("devops-engineer", ["Tracked 300 shipping containers per week at JNPT port"]), "docker")).toBe("missing");
    expect(statusOf(scan("data-scientist", ["Shared weekly RAG status reports"]), "llm-apps")).not.toBe("met");
    expect(statusOf(scan("frontend-developer", ["Had to react quickly to customer escalations"]), "react")).toBe("missing");
    expect(statusOf(scan("full-stack-developer", ["Coordinated Blue Dart Express shipments"]), "nodejs")).toBe("missing");
    expect(statusOf(scan("devops-engineer", ["Supported the Shell India procurement team"]), "linux")).toBe("missing");
    expect(statusOf(scan("java-backend-developer", ["Joined the platform team in spring 2023"]), "spring-boot")).toBe("missing");
    // Listed by the parser, the same words count.
    const listed = profile({ skills: [{ name: "React", lastUsed: null, evidence: ["Built React dashboards for 3 clients"] }] });
    expect(statusOf(matchProfile(listed, role("frontend-developer"), now), "react")).toBe("met");
  });

  it("lets a narrower skill show its broader one", () => {
    expect(statusOf(scan("data-analyst", ["Prepared branch MIS using pivot tables and VLOOKUP every month"]), "excel")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Cleaned 2 lakh rows of loan data with pandas dataframes"]), "python")).toBe("met");
    expect(statusOf(scan("java-backend-developer", ["Built order services in Spring Boot for 2 million users"]), "java")).toBe("met");
  });

  it("maps a listed skill written differently from the taxonomy, so it is weak rather than missing", () => {
    const p = profile({
      skills: [
        { name: "MS-Excel", lastUsed: null, evidence: ["MS-Excel"] },
        { name: "Python (Pandas, NumPy)", lastUsed: null, evidence: ["Python (Pandas, NumPy)"] },
      ],
    });
    const r = matchProfile(p, dataAnalyst, now);
    expect(statusOf(r, "excel")).toBe("weak");
    expect(statusOf(r, "python")).toBe("weak");
  });

  it("dates an older job with no end date by the next job's start, and compares to the month", () => {
    const p = profile({
      roles: [job(["Owned the sales dashboards"], "2021-04"), job(["Wrote SQL queries for branch reports"], "2012-06", null)],
    });
    expect(statusOf(matchProfile(p, dataAnalyst, now), "sql")).toBe("outdated");
    const ended = (end: string) => profile({ roles: [job(["Wrote SQL queries for branch reports"], "2019-01", end)] });
    expect(statusOf(matchProfile(ended("2022-01"), dataAnalyst, now), "sql")).toBe("outdated");
    expect(statusOf(matchProfile(ended("2023-01"), dataAnalyst, now), "sql")).toBe("met");
  });

  it("dates a parser quote that is part of a longer bullet by that bullet's job", () => {
    const p = profile({
      roles: [job(["Built Python scripts to merge branch reports for 40 branches"], "2014-01", "2019-03")],
      skills: [{ name: "Python", lastUsed: null, evidence: ["Built Python scripts to merge branch reports"] }],
    });
    expect(statusOf(matchProfile(p, dataAnalyst, now), "python")).toBe("outdated");
  });

  it("uses the newest job when a skill appears in both an old and a recent one", () => {
    const p = profile({
      roles: [job(["Wrote SQL for the loan book"], "2023-01"), job(["Wrote SQL queries for branch reports"], "2012-01", "2016-01")],
    });
    expect(matchProfile(p, dataAnalyst, now).met.find((s) => s.skillId === "sql")?.resumeQuote).toBe("Wrote SQL for the loan book");
  });

  it("never reads a short word inside a longer skill name as a skill", () => {
    const named = (name: string, quote: string, slug: string, id: string) =>
      statusOf(matchProfile(profile({ skills: [{ name, lastUsed: null, evidence: [quote] }] }), role(slug), now), id);
    expect(named("Go-to-market strategy", "Led go-to-market strategy for 3 product launches", "devops-engineer", "go")).toBe("missing");
    expect(named("Lambda expressions", "Used lambda expressions to simplify batch jobs", "devops-engineer", "aws")).toBe("missing");
    expect(named("React Native", "Built a React Native app for field agents", "frontend-developer", "react")).toBe("missing");
    expect(named("Spring Batch", "Ran Spring Batch jobs for nightly settlement", "java-backend-developer", "spring-boot")).toBe("missing");
  });

  // T11: listed names with a few extra words.
  it("reads a short listed name with a few extra words", () => {
    const listed = (name: string, slug: string, id: string) =>
      statusOf(matchProfile(profile({ skills: [{ name, lastUsed: null, evidence: [] }] }), role(slug), now), id);
    expect(listed("SQL Server Management Studio", "data-analyst", "sql")).not.toBe("missing");
    expect(listed("Data analysis using Python", "data-analyst", "python")).not.toBe("missing");
  });

  it("counts evidence for a looser name only where the quote names the skill, and skips names not about using it", () => {
    const pair = (name: string, quote: string, slug: string, id: string) =>
      statusOf(matchProfile(profile({ skills: [{ name, lastUsed: null, evidence: [quote] }] }), role(slug), now), id);
    expect(pair("Selenium IDE record playback", "Recorded smoke tests with a record-and-playback tool", "qa-automation-engineer", "selenium")).toBe("weak");
    expect(pair("SQL Server Management Studio", "Wrote SQL views for the finance team", "data-analyst", "sql")).toBe("met");
    expect(pair("SQL Injection testing", "Tested login forms for injection flaws using Burp Suite", "data-analyst", "sql")).toBe("missing");
    expect(pair("Teaching Python to kids", "Volunteer weekend teacher at a local NGO", "data-analyst", "python")).toBe("missing");
  });

  // T12: "algorithms" in a sentence is not data structures and algorithms.
  it("doesn't read DSA from machine learning or encryption algorithms", () => {
    expect(statusOf(scan("java-backend-developer", ["Tuned machine learning algorithms for fraud scoring"]), "data-structures-algorithms")).toBe("missing");
    expect(statusOf(scan("java-backend-developer", ["Implemented encryption algorithms for card data"]), "data-structures-algorithms")).toBe("missing");
    const listed = matchProfile(profile({ skills: [{ name: "Algorithms", lastUsed: null, evidence: [] }] }), role("java-backend-developer"), now);
    expect(statusOf(listed, "data-structures-algorithms")).not.toBe("missing");
  });

  it("reads short bullets and 'Worked on' bullets as use", () => {
    expect(statusOf(scan("data-analyst", ["Built Power BI dashboards"]), "power-bi")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Created Excel pivot tables"]), "excel")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Did SQL query optimization"]), "sql")).toBe("met");
    expect(statusOf(scan("java-backend-developer", ["Worked on Java, Spring Boot, Hibernate, MySQL, Kafka, Docker, Kubernetes"]), "java")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Migrated legacy tools: replaced Excel macros with Python scripts"]), "python")).toBe("met");
  });

  it("reads skills summaries as lists", () => {
    expect(isListLine("Proficient in MS Office (Word, Excel, PowerPoint)")).toBe(true);
    expect(isListLine("Key skills used: Selenium, TestNG")).toBe(true);
    expect(isListLine("Technical Skills: Java, Spring Boot, Hibernate, MySQL, AWS")).toBe(true);
  });

  it("doesn't let a generic alias of a narrower skill show the broader one", () => {
    expect(statusOf(scan("data-analyst", ["Performance tuning of JVM for Java applications"]), "sql")).toBe("missing");
    expect(statusOf(scan("data-analyst", ["Worked with dataframes in Spark using Scala"]), "python")).toBe("missing");
    expect(statusOf(scan("data-analyst", ["Ran pricing experimentation with sales team"]), "statistics")).toBe("missing");
  });

  it("takes the list order as newest first when a start date is missing", () => {
    const p = profile({ roles: [job(["Owned the sales dashboards"], null as unknown as string), job(["Wrote SQL queries for branch reports"], "2012-06")] });
    expect(statusOf(matchProfile(p, dataAnalyst, now), "sql")).toBe("outdated");
  });

  it("only demotes the clause that is about learning", () => {
    expect(statusOf(scan("data-analyst", ["Built SQL dashboards for customers interested in home loans"]), "sql")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Mentored aspiring analysts on SQL and Power BI"]), "sql")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Delivered a course on Python to 200 interns"]), "python")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Learning and Development: ran Python training for 50 freshers"]), "python")).toBe("met");
    const r = scan("data-analyst", ["Automated MIS in Python; now learning Power BI"]);
    expect(statusOf(r, "python")).toBe("met");
    expect(statusOf(r, "power-bi")).toBe("weak");
  });

  it("finds AWS from S3 in a sentence", () => {
    expect(statusOf(scan("devops-engineer", ["Wrote Lambda functions for S3 events"]), "aws")).toBe("met");
  });

  it("matches a long resume quickly", () => {
    const highlights = Array.from({ length: 60 }, (_, i) => `Built ${i} Power BI dashboards and SQL pipelines in Python for the retail sales team across 40 stores`);
    const skills = Array.from({ length: 40 }, (_, i) => ({ name: `Skill ${i}`, lastUsed: null, evidence: [highlights[i]] }));
    const p = profile({ roles: [job(highlights)], skills });
    const t = performance.now();
    matchProfile(p, dataAnalyst, now);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("reads skills and coursework lines as lists, whatever their first word", () => {
    for (const line of [
      "Related Coursework: Data Structures, DBMS, Python, Machine Learning",
      "Preferred Tools: Excel, Tableau",
      "Structured Query Language, Excel, Power BI",
      "Applied Statistics, Python, R, SQL",
      "Python (Pandas, NumPy, Matplotlib)",
      "MS Office (Word, Excel, PowerPoint)",
      "Embedded C, RTOS, Linux",
    ])
      expect(isListLine(line), line).toBe(true);
    const p = profile({ skills: [{ name: "Python (Pandas, NumPy, Matplotlib)", lastUsed: null, evidence: ["Python (Pandas, NumPy, Matplotlib)"] }] });
    expect(statusOf(matchProfile(p, dataAnalyst, now), "python")).toBe("weak");
  });

  it("reads present-tense bullets as use", () => {
    expect(statusOf(scan("data-analyst", ["Creating Power BI dashboards"]), "power-bi")).toBe("met");
    expect(statusOf(scan("data-analyst", ["Develop Power BI dashboards"]), "power-bi")).toBe("met");
  });

  it("dates an older job with no end by the nearest newer known start", () => {
    const p = profile({
      roles: [job(["Owned the sales dashboards"], "2025-06"), job(["Ran branch audits"], null as unknown as string), job(["Wrote SQL queries for branch reports"], "2021-03")],
    });
    expect(statusOf(matchProfile(p, dataAnalyst, now), "sql")).toBe("met");
  });

  it("treats courses and exposure as learning, and splits 'and now learning'", () => {
    expect(statusOf(scan("data-analyst", ["Exposure to SQL, Python, Tableau in college projects"]), "sql")).toBe("weak");
    expect(statusOf(scan("data-analyst", ["Completed NPTEL course on Python"]), "python")).toBe("weak");
    const r = scan("data-analyst", ["Automated MIS in Python and now learning Power BI"]);
    expect(statusOf(r, "python")).toBe("met");
    expect(statusOf(r, "power-bi")).toBe("weak");
  });
});

describe("certifications on the resume", () => {
  const infosec = role("information-security-analyst");

  it("a held CISSP meets the skills it tests and makes the ones it touches weak", () => {
    const r = matchProfile(profile({ certifications: ["CISSP – ISC2, 2024"] }), infosec, now);
    for (const id of ["compliance-frameworks", "security-policies", "risk-assessment", "identity-access-management"]) expect(statusOf(r, id)).toBe("met");
    expect(statusOf(r, "security-audits")).toBe("weak");
    expect(statusOf(r, "stakeholder-management")).toBe("weak");
    expect(r.met.find((m) => m.skillId === "risk-assessment")?.resumeQuote).toBe("CISSP – ISC2, 2024");
  });

  it("a certification being prepared for counts for nothing", () => {
    for (const line of [
      "Pursuing CISSP",
      "CISSP (exam due March 2027)",
      "Preparing for PL-300",
      "CISSP, appearing Nov 2026",
      "CISSP – exam scheduled",
      "Will take CISSP in December",
      "CISSP (result awaited)",
      "CISSP: not yet cleared",
      "Registered for CISSP",
      "CISSP 2027",
      "Preparing for: CISSP, CISA",
    ]) {
      expect(certificationsIn(line, now), line).toEqual([]);
    }
    const r = matchProfile(profile({ certifications: ["Pursuing CISSP"] }), infosec, now);
    expect(statusOf(r, "risk-assessment")).toBe("missing");
  });

  it("an old pass reads as outdated, and a weak touch never downgrades a met skill", () => {
    const old = matchProfile(profile({ certifications: ["CISSP 2015"] }), infosec, now);
    expect(statusOf(old, "risk-assessment")).toBe("outdated");
    const both = matchProfile(profile({ certifications: ["Microsoft PL-300", "Tableau Desktop Specialist"] }), dataAnalyst, now);
    expect(statusOf(both, "power-bi")).toBe("met");
    expect(statusOf(both, "data-visualization")).not.toBe("missing");
  });

  it("matches a certification by its full name too", () => {
    expect(certificationsIn("Microsoft Certified: Power BI Data Analyst Associate", now).map((c) => c.cert.id)).toContain("power-bi-data-analyst");
  });

  const held = (line: string) => certificationsIn(line, now).map((c) => ({ id: c.cert.id, months: c.months }));
  const ym = (y: number, m: number) => y * 12 + m - 1;

  it("words that sound like plans but describe a held certificate keep it", () => {
    for (const line of ["CISSP (ongoing CPE credits)", "CISSP, 2019; attempted 40 hands-on labs", "CISSP – target audience: SOC teams, 2022"]) {
      expect(held(line).map((h) => h.id), line).toContain("cissp");
    }
  });

  it("reads each certificate on a mixed line on its own", () => {
    expect(held("CISSP (2019), CISA - pursuing").map((h) => h.id)).toEqual(["cissp"]);
    expect(held("Pursuing CISA; CISSP 2021").map((h) => h.id)).toEqual(["cissp"]);
    expect(held("CISSP, 2019, CISA, appearing Nov 2026")).toEqual([{ id: "cissp", months: ym(2019, 12) }]);
  });

  it("takes the pass date, not expiry, ID digits or a standard's version", () => {
    expect(held("CISSP, Mar 2022, valid till Mar 2025")).toEqual([{ id: "cissp", months: ym(2022, 3) }]);
    expect(held("CISSP (expires 2027)")).toEqual([{ id: "cissp", months: null }]);
    expect(held("CISSP, credential ID 2015-88321, 2023")).toEqual([{ id: "cissp", months: ym(2023, 12) }]);
    expect(held("CISSP 03/2021")).toEqual([{ id: "cissp", months: ym(2021, 3) }]);
    expect(held("CISSP Mar 2024 – Mar 2027")).toEqual([{ id: "cissp", months: ym(2024, 3) }]);
    expect(held("CISSP 2026")).toEqual([{ id: "cissp", months: ym(2026, 10) }]);
    const iso = certificationsIn("ISO/IEC 27001:2013 Lead Auditor", now);
    expect(iso.length).toBeGreaterThan(0);
    expect(iso.every((c) => c.months === null)).toBe(true);
  });

  it("an old pass whose dates are an expiry still reads as recent, and a pass year this year is not a plan", () => {
    const r = matchProfile(profile({ certifications: ["CISSP – valid until 2028"] }), infosec, now);
    expect(statusOf(r, "risk-assessment")).toBe("met");
  });
});

