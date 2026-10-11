import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { roleProfile, type Profile } from "@/lib/schemas";
import { certificationsIn, contentHash, inflections, isListLine, matchProfile, matchResult, MATCHER_VERSION, metSkillIds } from "./match";

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

  it("never makes a context skill (communication, problem solving) a gap, but counts it when the resume shows it", () => {
    const pm = role("product-manager");
    const none = matchProfile(profile({}), pm, now);
    for (const id of ["communication", "problem-solving", "stakeholder-management"]) expect(statusOf(none, id)).toBeUndefined();
    expect(none.readiness.requiredTotal).toBe(pm.skills.filter((s) => s.importance === "required").length - 3);

    const shown = matchProfile(
      profile({
        roles: [{ title: "Product Manager", employer: "Example Fintech", start: "2023-01", end: null, highlights: ["Led stakeholder management across risk and ops teams"] }],
      }),
      pm,
      now,
    );
    expect(statusOf(shown, "stakeholder-management")).toBe("met");
    expect(shown.readiness.requiredTotal).toBe(none.readiness.requiredTotal + 1);
  });

  it("reads plurals, British spellings and the test in testing (T29)", () => {
    const pm = role("product-manager");
    const r = matchProfile(
      profile({
        roles: [
          {
            title: "Associate Product Manager",
            employer: "Example Fintech",
            start: "2024-01",
            end: null,
            highlights: ["Wrote PRDs and user stories in Jira; prioritised the backlog with RICE.", "Ran 14 user interviews and an A/B test on the onboarding screen that lifted completion by 9%."],
          },
        ],
        skills: [{ name: "Product roadmaps", lastUsed: null, evidence: ["Product roadmaps, Jira, SQL, Mixpanel, Figma, stakeholder management"] }],
      }),
      pm,
      now,
    );
    expect(statusOf(r, "roadmapping")).toBe("met");
    if (pm.skills.some((s) => s.skillId === "ab-testing")) expect(statusOf(r, "ab-testing")).toBe("met");
    expect(inflections("a/b testing")).toEqual(["a/b testing", "a/b test", "a/b tests"]);
    expect(inflections("excel")).toEqual(["excel"]);
    expect(inflections("data engineering")).toEqual(["data engineering"]);
    expect(inflections("load testing")).toEqual(["load testing"]);
    expect(inflections("containerization")).toEqual(["containerization", "containerisation"]);
    expect(inflections("data quality")).toEqual(["data quality", "data qualities"]);
  });

  it("never reads everyday tests or -ised words from other trades as skills", () => {
    const job = (line: string) => profile({ roles: [{ title: "Engineer", employer: "Example Infra", start: "2024-01", end: null, highlights: [line] }] });
    for (const [line, slug, skill] of [
      ["Conducted pile load tests for the metro viaduct foundations", "qa-automation-engineer", "performance-testing"],
      ["Performed quality control tests on incoming raw materials as per IP", "information-security-analyst", "security-audits"],
      ["Witnessed factory acceptance tests for HT switchgear panels", "business-analyst", "uat"],
      ["Handled containerised cargo movement at JNPT", "devops-engineer", "docker"],
      ["Normalised monthly sales figures across 12 regions in Excel", "database-architect", "orm-databases"],
      ["Prioritised customer tickets in the support queue", "product-manager", "roadmapping"],
    ] as const) {
      expect(statusOf(matchProfile(job(line), role(slug), now), skill), line).not.toBe("met");
    }
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

  it("keeps a skill from a long-running current job fresh even when the parser dates it to the job's start (T31)", () => {
    const p = profile({
      roles: [job(["Incident commander for 12 major incidents"], "2019-04")],
      skills: [{ name: "Security incident response", lastUsed: "2019", evidence: ["Incident commander for 12 major incidents"] }],
    });
    expect(statusOf(matchProfile(p, role("soc-lead"), now), "security-incident-response")).toBe("met");
    // A fragment that doesn't name the skill keeps the parser's date, even if a current bullet contains it.
    const fragment = profile({
      roles: [job(["Handled incidents for 14 clients"], "2021-01"), job(["Handled incidents for 14 clients using Splunk"], "2014-01", "2018-06")],
      skills: [{ name: "Splunk", lastUsed: "2018-06", evidence: ["Handled incidents for 14 clients"] }],
    });
    expect(statusOf(matchProfile(fragment, role("soc-analyst-l2"), now), "siem")).toBe("outdated");
  });

  it("puts a hash of the skill and certification lists in the matcher version (T34)", () => {
    expect(MATCHER_VERSION).toMatch(/^matcher\/v\d+\+[0-9a-f]{8}$/);
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash(JSON.stringify({ aliases: ["misp"] }))).not.toBe(contentHash(JSON.stringify({ aliases: ["misp", "x"] })));
  });

  it("reads ITGC audits, IOC checks and cyber risk reporting as their skills (T32)", () => {
    const quote = (q: string, slug: string, id: string) =>
      statusOf(matchProfile(profile({ roles: [job([q], "2025-01")] }), role(slug), now), id);
    expect(quote("Ran IT general controls audits for 4 banking clients", "grc-manager", "security-audits")).toBe("met");
    // "IOCs" is also oil companies and the Olympic committee, so it counts only when the parser lists it as a skill.
    expect(quote("Negotiated production sharing contracts with IOCs and NOCs", "soc-analyst-l2", "threat-intelligence")).toBe("missing");
    // Its tools name it in free text.
    expect(quote("Check IOCs against VirusTotal and AlienVault OTX feeds", "soc-analyst-l2", "threat-intelligence")).toBe("met");
    const listed = profile({ skills: [{ name: "IOCs", lastUsed: null, evidence: ["Check IOCs against VirusTotal and AlienVault OTX feeds"] }] });
    expect(statusOf(matchProfile(listed, role("soc-analyst-l2"), now), "threat-intelligence")).toBe("met");
    // VirusTotal is also a helpdesk scan, MISP a farm scheme and "threat feed" a bank fraud bulletin.
    expect(quote("Scanned user laptops with VirusTotal and Malwarebytes", "soc-analyst-l2", "threat-intelligence")).toBe("missing");
    expect(quote("Coordinated MISP (Micro Irrigation Support Project) subsidy disbursal", "soc-analyst-l2", "threat-intelligence")).toBe("missing");
    expect(quote("Fixed misp. entries in MIS reports", "soc-lead", "threat-detection")).toBe("missing");
    expect(quote("Subscribed to the RBI threat feed of fraud alerts for branch banking", "soc-analyst-l2", "threat-intelligence")).toBe("missing");
    expect(quote("Prepared daily market risk reporting for the treasury desk", "grc-manager", "risk-assessment")).toBe("missing");
    expect(quote("Underwrote cyber risk policies for SME clients", "grc-manager", "risk-assessment")).toBe("missing");
    expect(quote("Present the monthly cyber risk dashboard to the CISO", "grc-manager", "risk-assessment")).toBe("met");
  });

  it("reads CTI in a call-centre line as nothing, and on-call work as SRE practice", () => {
    const quote = (q: string, slug: string, id: string) =>
      statusOf(matchProfile(profile({ roles: [job([q], "2025-01")] }), role(slug), now), id);
    expect(quote("Worked on CTI-integrated dialer for the inbound process", "cyber-security-analyst", "threat-detection")).toBe("missing");
    expect(quote("Handled on-call rotation for payments platform and wrote postmortems", "devops-engineer", "sre-practices")).toBe("met");
  });

  it("reads store marketing, an MVI post and data-explorer KQL as nothing, and Android ViewModels as architecture", () => {
    const quote = (q: string, slug: string, id: string) =>
      statusOf(matchProfile(profile({ roles: [job([q], "2025-01")] }), role(slug), now), id);
    expect(quote("Built a habit tracker app, a personal project not yet on the App Store", "ios-developer", "mobile-release")).toBe("missing");
    expect(quote("Managed Google Play Store ad campaigns", "android-developer", "mobile-release")).toBe("missing");
    expect(quote("Worked as MVI at the RTO", "android-developer", "mobile-architecture")).toBe("missing");
    expect(quote("Wrote KQL queries in Azure Data Explorer to analyse app telemetry", "soc-analyst-l2", "siem")).toBe("missing");
    expect(quote("Moved screens to Android ViewModels with a repository layer", "android-developer", "mobile-architecture")).toBe("met");
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

  it("meets query optimization from how people describe tuning queries", () => {
    const backend = role("senior-backend-engineer");
    for (const line of ["Tuned slow Postgres queries with EXPLAIN plans and new indexes, cutting p95 latency by 60%", "Improved query performance on MySQL"]) {
      const r = matchProfile(profile({ roles: [{ title: "Engineer", employer: "Example", start: "2021-01", end: null, highlights: [line] }] }), backend, now);
      expect(statusOf(r, "query-optimization")).toBe("met");
    }
  });
});

describe("certifications on the resume", () => {
  const infosec = role("information-security-analyst");

  it("a held CISSP meets the skills it tests and makes the ones it touches weak", () => {
    const r = matchProfile(profile({ certifications: [{ name: "CISSP – ISC2, 2024", earned: null, expires: null }] }), infosec, now);
    for (const id of ["compliance-frameworks", "security-policies", "risk-assessment", "identity-access-management"]) expect(statusOf(r, id)).toBe("met");
    expect(statusOf(r, "security-audits")).toBe("weak");
    // A context skill the certificate only touches is not shown: it is never a gap.
    expect(statusOf(r, "stakeholder-management")).toBeUndefined();
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
      "Pursuing CISA, CISM",
      "Preparing for CISSP, CISA",
      "Planning to take CISSP, CISM next year",
      "Not CISSP certified",
      "CISSP (In Progress)",
      "CISSP – in progress",
      "AWS Solutions Architect Associate - In-progress",
      "CISSP (pending)",
      "CISSP (ongoing)",
    ]) {
      expect(certificationsIn(line, now), line).toEqual([]);
    }
    const r = matchProfile(profile({ certifications: [{ name: "Pursuing CISSP", earned: null, expires: null }] }), infosec, now);
    expect(statusOf(r, "risk-assessment")).toBe("missing");
  });

  it("an old pass reads as outdated, and a weak touch never downgrades a met skill", () => {
    const old = matchProfile(profile({ certifications: [{ name: "CISSP 2015", earned: null, expires: null }] }), infosec, now);
    expect(statusOf(old, "risk-assessment")).toBe("outdated");
    const both = matchProfile(profile({ certifications: [{ name: "Microsoft PL-300, 2025", earned: null, expires: null }, { name: "Tableau Desktop Specialist", earned: null, expires: null }] }), dataAnalyst, now);
    expect(statusOf(both, "power-bi")).toBe("met");
    expect(statusOf(both, "data-visualization")).not.toBe("missing");
  });

  it("matches a certification by its full name too", () => {
    expect(certificationsIn("Microsoft Certified: Power BI Data Analyst Associate", now).map((c) => c.cert.id)).toContain("power-bi-data-analyst");
  });

  const held = (line: string) => certificationsIn(line, now).map((c) => ({ id: c.cert.id, months: c.months }));
  const ym = (y: number, m: number) => y * 12 + m - 1;

  it("words that sound like plans but describe a held certificate keep it", () => {
    for (const line of [
      "CISSP (ongoing CPE credits)",
      "CISSP, 2019; attempted 40 hands-on labs",
      "CISSP – target audience: SOC teams, 2022",
      "CISSP – CPE in progress",
      "CISSP (endorsement pending), 2025",
    ]) {
      expect(held(line).map((h) => h.id), line).toContain("cissp");
    }
  });

  it("reads each certificate on a mixed line on its own", () => {
    expect(held("CISSP (2019), CISA - pursuing").map((h) => h.id)).toEqual(["cissp"]);
    expect(held("Pursuing CISA; CISSP 2021").map((h) => h.id)).toEqual(["cissp"]);
    expect(held("CISSP, 2019, CISA, appearing Nov 2026")).toEqual([{ id: "cissp", months: ym(2019, 12) }]);
    expect(held("Pursuing CISA, CISSP 2021").map((h) => h.id)).toEqual(["cissp"]);
    expect(held("CISA 2020, Not CISSP").map((h) => h.id)).toEqual(["cisa"]);
  });

  it("takes the pass date, not expiry, ID digits or a standard's version", () => {
    expect(held("CISSP, Mar 2022, valid till Mar 2025")).toEqual([{ id: "cissp", months: ym(2022, 3) }]);
    expect(held("CISSP (expires 2027)")).toEqual([{ id: "cissp", months: null }]);
    expect(held("CISSP, credential ID 2015-88321, 2023")).toEqual([{ id: "cissp", months: ym(2023, 12) }]);
    expect(held("CISSP 03/2021")).toEqual([{ id: "cissp", months: ym(2021, 3) }]);
    expect(held("CISSP Mar 2024 – Mar 2027")).toEqual([{ id: "cissp", months: ym(2024, 3) }]);
    expect(held("CISSP, 2012-2016")).toEqual([{ id: "cissp", months: ym(2016, 12) }]);
    expect(held("CISSP (2016-2019)")).toEqual([{ id: "cissp", months: ym(2019, 12) }]);
    expect(held("CISSP 2026")).toEqual([{ id: "cissp", months: ym(2026, 10) }]);
    const iso = certificationsIn("ISO/IEC 27001:2013 Lead Auditor", now);
    expect(iso.length).toBeGreaterThan(0);
    expect(iso.every((c) => c.months === null)).toBe(true);
  });

  it("a certificate with no pass date shows its skills only as weak, and never lifts an outdated skill", () => {
    const r = matchProfile(profile({ certifications: [{ name: "CISSP – valid until 2028", earned: null, expires: null }] }), infosec, now);
    expect(statusOf(r, "risk-assessment")).toBe("weak");
    const old = matchProfile(
      profile({
        roles: [{ title: "Security Analyst", employer: "Example Bank", start: "2014-01", end: "2017-06", highlights: ["Ran risk assessment for branch systems"] }],
        certifications: [{ name: "CISSP", earned: null, expires: null }],
      }),
      infosec,
      now,
    );
    expect(statusOf(old, "risk-assessment")).toBe("outdated");
    expect(statusOf(matchProfile(profile({ certifications: [{ name: "CISSP, 2025", earned: null, expires: null }] }), infosec, now), "risk-assessment")).toBe("met");
  });

  it("reads the pass date and expiry from the certificate's own fields", () => {
    const status = (earned: string | null, expires: string | null) =>
      statusOf(matchProfile(profile({ certifications: [{ name: "CISSP", earned, expires }] }), infosec, now), "risk-assessment");
    expect(status("2024-03", null)).toBe("met");
    expect(status("2026", "none")).toBe("met");
    expect(status("2024", "2026")).toBe("met");
    // Past its expiry: true once, not current.
    expect(status("2023", "2025-06")).toBe("weak");
    // An exam booked for later is a plan and counts for nothing.
    expect(status("2027-02", null)).toBe("missing");
    expect(status("2026-12", null)).toBe("missing");
    // Long ago: the skill is outdated, as a dated line in the name would make it.
    expect(status("2015", "none")).toBe("outdated");
  });
});

describe("one of these groups", () => {
  const member = (skillId: string, postingShare: number) => ({
    skillId,
    importance: "required",
    oneOf: "cloud",
    expectation: "Run workloads on one cloud",
    postingShare,
  });
  const cloud = roleProfile.parse({
    slug: "cloud-test",
    title: "Cloud test role",
    experienceBand: { minYears: 1, maxYears: 5 },
    groups: [{ id: "cloud", label: "A cloud platform (AWS, Azure or GCP)" }],
    skills: [
      member("aws", 0.6),
      member("azure", 0.3),
      member("gcp", 0.2),
      { skillId: "linux", importance: "required", expectation: "Run Linux servers" },
      { skillId: "docker", importance: "required", expectation: "Build containers" },
      { skillId: "terraform", importance: "required", expectation: "Write IaC" },
      { skillId: "python", importance: "nice_to_have", expectation: "Automate" },
    ],
    sources: [{ description: "test", url: null }],
    reviewedBy: null,
    updatedOn: "2026-10-10",
  });
  const line = (text: string) =>
    profile({ roles: [{ title: "Engineer", employer: "Example", start: "2024-01", end: null, highlights: [text] }] });

  it("counts a group as one required skill, met by any of its skills", () => {
    const r = matchProfile(line("Migrated 40 VMs to Azure and managed them for two years"), cloud, now);
    expect(r.readiness.requiredTotal).toBe(4);
    expect(r.met.map((m) => m.skillId)).toEqual(["azure"]);
    expect(r.gaps.map((g) => g.skillId)).not.toContain("aws");
    expect(r.groups).toEqual([{ id: "cloud", skillIds: ["aws", "azure", "gcp"] }]);
  });

  it("lists every shown skill of a met group as met, while counting the group once", () => {
    const r = matchProfile(line("Migrated workloads from Azure to AWS over two years"), cloud, now);
    expect(r.readiness.requiredMet).toBe(r.met.length);
    expect(r.met.filter((m) => m.group)).toHaveLength(1);
    expect(metSkillIds(r)).toEqual(expect.arrayContaining(["aws", "azure"]));
  });

  it("shows a group with no skill shown as one gap under its label, suggesting the skill most postings ask for", () => {
    const r = matchProfile(line("Ran Linux servers for a bank"), cloud, now);
    const g = r.gaps.find((x) => x.group?.id === "cloud")!;
    expect(g).toMatchObject({ skillId: "aws", skillName: "A cloud platform (AWS, Azure or GCP)", status: "missing", resumeQuote: null });
    expect(r.gaps.filter((x) => x.group).length).toBe(1);
  });

  it("keeps the strongest skill of a group as its gap, under that skill's name", () => {
    const r = matchProfile(profile({ skills: [{ name: "GCP", lastUsed: null, evidence: [] }] }), cloud, now);
    const g = r.gaps.find((x) => x.group?.id === "cloud")!;
    expect(g).toMatchObject({ skillId: "gcp", skillName: "Google Cloud", status: "weak" });
  });

  it("rejects a group with one skill, a group skill that is not required, and an unknown group", () => {
    const base = { slug: "x", title: "X", experienceBand: { minYears: 0, maxYears: 2 }, sources: [{ description: "t", url: null }], reviewedBy: null, updatedOn: "2026-10-10" };
    const s = (skillId: string, extra = {}) => ({ skillId, importance: "required", expectation: "e", ...extra });
    const groups = [{ id: "g", label: "One of" }];
    const valid = (role: object) => roleProfile.safeParse({ ...base, ...role }).success;
    expect(valid({ groups, skills: [s("aws", { oneOf: "g" }), s("linux"), s("docker")] })).toBe(false);
    expect(valid({ groups, skills: [s("aws", { oneOf: "g" }), s("gcp", { oneOf: "g", importance: "nice_to_have" }), s("linux")] })).toBe(false);
    expect(valid({ skills: [s("aws", { oneOf: "g" }), s("gcp", { oneOf: "g" }), s("linux")] })).toBe(false);
    expect(valid({ groups, skills: [s("aws", { oneOf: "g" }), s("gcp", { oneOf: "g" }), s("linux")] })).toBe(true);
  });
});
