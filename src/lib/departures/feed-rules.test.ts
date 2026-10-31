import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { boardProblem, boardsToClose, collect, failureCode, getJson, loadBoards, placeLine, roleLine, summaryLines, unmatchedLine, unmatchedTsv, writeRollup, writeRun } from "../../../scripts/departures/fetch-feeds.mjs";
import { capPosts, careersUrlOf, cityOf, classify, experienceNoteOf, FEED_LIMITS, feedUrl, FUTURE_SKEW_MS, htmlLines, postedAtOf, postRow, rawPost, ROLE_TITLES, skillMatchersFor, skillsOf, USER_AGENT, workTypeOf } from "./feed-rules.mjs";
import { FEED_SCHEMAS, jobBoardsFile, jobPostRow } from "./feed-schemas.mjs";
import { FEED_BAD_RUNS } from "@/lib/health";

// The daily Departures feed (docs/plans/departures-live-plan.md) against saved, synthetic answers of each public
// job-board API (fixtures/feeds): no network. Every company here is made up.
const root = resolve(__dirname, "../../..");
const fixture = (ats: string) => JSON.parse(readFileSync(resolve(root, `fixtures/feeds/${ats}.json`), "utf8")) as unknown;
const skills = JSON.parse(readFileSync(resolve(root, "src/content/skills.json"), "utf8")) as { id: string; name: string; aliases: string[] }[];
const matchers = skillMatchersFor(skills);

const board = (ats: string, token: string, company: string) => ({ company, ats, token, careersUrl: `https://example.com/${token}`, addedBy: "Development", addedOn: "2026-10-20" });
const boards = jobBoardsFile.parse([
  board("greenhouse", "examplelabs", "Example Labs"),
  board("lever", "examplecart", "Examplecart"),
  board("ashby", "examplepay", "Examplepay"),
  board("smartrecruiters", "ExampleWorks", "Example Works"),
  board("lever", "gone", "Gone Example"),
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetch that answers each board's API address from the fixtures, and 404 for anything else. */
const fakeFetch = (answers: Record<string, unknown>) =>
  vi.fn(async (url: string | URL | Request) => {
    const key = Object.keys(answers).find((k) => String(url) === k);
    if (!key) return json({ message: "Not found" }, 404);
    const a = answers[key];
    return typeof a === "number" ? json({}, a) : json(a);
  }) as unknown as typeof fetch;
const allAnswers = () => ({
  [feedUrl("greenhouse", "examplelabs")]: fixture("greenhouse"),
  [feedUrl("lever", "examplecart")]: fixture("lever"),
  [feedUrl("ashby", "examplepay")]: fixture("ashby"),
  [feedUrl("smartrecruiters", "ExampleWorks")]: fixture("smartrecruiters"),
});

afterEach(() => vi.restoreAllMocks());

describe("the board list (src/content/job-boards.json)", () => {
  const list = loadBoards();
  const mined = JSON.parse(readFileSync(resolve(root, "scripts/jd-mining/boards.json"), "utf8")) as Record<string, string[]>;
  const host = { greenhouse: "job-boards.greenhouse.io", lever: "jobs.lever.co", ashby: "jobs.ashbyhq.com", smartrecruiters: "jobs.smartrecruiters.com" } as const;

  it("is valid, within the cap, each board once, on one of the four public APIs, with its careers page on that board", () => {
    expect(list.length).toBeGreaterThan(20);
    expect(list.length).toBeLessThanOrEqual(FEED_LIMITS.boards);
    for (const b of list) {
      expect(new URL(b.careersUrl).hostname).toBe(b.host === "eu" ? "job-boards.eu.greenhouse.io" : host[b.ats]);
      // The first list is taken from the boards skill mining already reads; boards added later passed the board check.
      if (b.ats !== "smartrecruiters" && b.addedBy === "Development") expect(mined[b.ats]).toContain(b.token);
    }
  });

  it("refuses a board listed twice, an unknown ATS, a page that isn't https and a token that isn't one", () => {
    const ok = board("lever", "examplecart", "Examplecart");
    expect(jobBoardsFile.safeParse([ok, { ...ok, token: "ExampleCart" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, ats: "workable" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, ats: "linkedin" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, careersUrl: "http://jobs.lever.co/examplecart" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, token: "../x" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...ok, extra: 1 }]).success).toBe(false);
  });

  it("keeps a token's case, takes a dot in an Ashby token only, and refuses anything unsafe in a URL", () => {
    const sr = board("smartrecruiters", "SWIGGY", "Swiggy");
    expect(jobBoardsFile.parse([sr, board("smartrecruiters", "NielsenIQ", "NielsenIQ"), board("smartrecruiters", "KLA-Tencor", "KLA")]).map((b) => b.token)).toEqual(["SWIGGY", "NielsenIQ", "KLA-Tencor"]);
    expect(feedUrl("smartrecruiters", "SWIGGY")).toBe("https://api.smartrecruiters.com/v1/companies/SWIGGY/postings?country=in&limit=100");
    expect(feedUrl("smartrecruiters", "SWIGGY", undefined, 200)).toBe("https://api.smartrecruiters.com/v1/companies/SWIGGY/postings?country=in&limit=100&offset=200");
    expect(jobBoardsFile.safeParse([board("ashby", "flagright.com", "Flagright")]).success).toBe(true);
    expect(feedUrl("ashby", "flagright.com")).toBe("https://api.ashbyhq.com/posting-api/job-board/flagright.com");
    expect(jobBoardsFile.safeParse([board("lever", "flagright.com", "Flagright")]).success).toBe(false);
    for (const bad of ["..", "a..b", ".a", "a.", "a/b", "a%2Fb", "a?b", "a#b", "a b", "a\\b", "", "x".repeat(81)])
      expect(jobBoardsFile.safeParse([board("ashby", bad, "Bad")]).success, bad).toBe(false);
    expect(jobPostRow.shape.boardToken.safeParse("flagright.com").success).toBe(true);
    expect(jobPostRow.shape.boardToken.safeParse("../x").success).toBe(false);
  });

  it("takes Greenhouse's EU host on a Greenhouse board only, and reads and links it there", () => {
    const eu = { ...board("greenhouse", "examplelabs", "Example Labs"), host: "eu", careersUrl: careersUrlOf("greenhouse", "examplelabs", "eu") };
    expect(jobBoardsFile.safeParse([eu]).success).toBe(true);
    expect(jobBoardsFile.safeParse([{ ...eu, host: "us" }]).success).toBe(false);
    expect(jobBoardsFile.safeParse([{ ...board("lever", "examplecart", "Examplecart"), host: "eu" }]).success).toBe(false);
    expect(feedUrl("greenhouse", "examplelabs", "eu")).toBe("https://boards-api.eu.greenhouse.io/v1/boards/examplelabs/jobs?content=true");
    expect(eu.careersUrl).toBe("https://job-boards.eu.greenhouse.io/examplelabs");
    expect(careersUrlOf("greenhouse", "examplelabs")).toBe("https://job-boards.greenhouse.io/examplelabs");
    expect([careersUrlOf("lever", "a"), careersUrlOf("ashby", "a.com"), careersUrlOf("smartrecruiters", "SWIGGY")]).toEqual([
      "https://jobs.lever.co/a",
      "https://jobs.ashbyhq.com/a.com",
      "https://jobs.smartrecruiters.com/SWIGGY",
    ]);
  });
});

describe("feed rules", () => {
  it("asks only the four public job-board APIs, as CareerMetro", () => {
    expect(new URL(feedUrl("greenhouse", "a")).hostname).toBe("boards-api.greenhouse.io");
    expect(new URL(feedUrl("lever", "a")).hostname).toBe("api.lever.co");
    expect(new URL(feedUrl("ashby", "a")).hostname).toBe("api.ashbyhq.com");
    expect(new URL(feedUrl("smartrecruiters", "a")).hostname).toBe("api.smartrecruiters.com");
    expect(USER_AGENT).toBe("CareerMetroJobs/1.0 (+https://careermetro.vercel.app/terms#job-boards)");
  });

  it("splits skills by heading: requirements are required, nice to have and bonus are not, and other sections don't count", () => {
    const lines = ["About the role", "You will build Tableau dashboards.", "Requirements", "SQL and Excel every day", "Nice to have:", "Python", "Benefits", "Docker courses paid for"];
    expect(skillsOf(lines, matchers)).toEqual({ required: ["sql", "excel"], nice: ["python"] });
    expect(skillsOf(["Must have", "Java", "Bonus points", "Java and Docker"], matchers)).toEqual({ required: ["java"], nice: ["docker"] });
    // With no such heading, every skill the post names counts as required.
    expect(skillsOf(["We use SQL, Power BI and Python every day.", "Tableau is a plus too"], matchers).nice).toEqual([]);
    expect(skillsOf(["We use SQL, Power BI and Python every day."], matchers).required.sort()).toEqual(["power-bi", "python", "sql"]);
    // A requirement line is never taken for a heading.
    expect(skillsOf(["Requirements", "Strong SQL skills", "Excel"], matchers).required).toEqual(["sql", "excel"]);
  });

  it("reads lines from HTML escaped twice, as Greenhouse sends it", () => {
    expect(htmlLines("&amp;lt;p&amp;gt;&amp;lt;strong&amp;gt;Requirements&amp;lt;/strong&amp;gt;&amp;lt;/p&amp;gt;&amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;SQL&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;")).toEqual(["Requirements", "SQL"]);
  });

  it("keeps the experience the post states, never a company's age, and reads place and work type", () => {
    expect(experienceNoteOf("2-4 years of experience in analytics")).toBe("2 to 4 years");
    expect(experienceNoteOf("5+ years of professional experience")).toBe("5+ years");
    expect(experienceNoteOf("8+ years of experience, including 2+ years with Kafka")).toBe("8+ years");
    expect(experienceNoteOf("We were founded 30 years ago.")).toBeNull();
    expect(experienceNoteOf("No years here.")).toBeNull();
    expect(cityOf("Remote - India", true)).toBe("Remote");
    expect(cityOf("Pune, Maharashtra, India", false)).toBe("Pune");
    expect(cityOf("India", false)).toBe("India");
    expect([workTypeOf("Full-time"), workTypeOf("Part-time"), workTypeOf("Contract"), workTypeOf("FullTime"), workTypeOf(null)]).toEqual(["full_time", "part_time", "freelance", "full_time", "full_time"]);
    expect(classify("Junior Data Analyst")).toBe("data-analyst");
    expect(classify("Director, Data Analytics")).toBeNull();
  });

  it("reads a title as one of the live role profiles, the most specific first", () => {
    const cases: [string, string | null][] = [
      ["Cloud Security Engineer", "cloud-security-engineer"],
      ["Privacy Analyst", "privacy-analyst"],
      ["Penetration Tester", "penetration-tester"],
      ["Application Security Engineer", "appsec-engineer"],
      ["SOC Analyst", "cyber-security-analyst"],
      ["Data Engineer", "data-engineer"],
      ["Machine Learning Engineer", "ml-engineer"],
      ["Android Developer", "android-developer"],
      ["iOS Engineer", "ios-developer"],
      ["React Native Developer", "cross-platform-mobile-developer"],
      ["UI/UX Designer", "ui-ux-designer"],
      ["Product Designer", "ui-ux-designer"],
      ["Site Reliability Engineer", "site-reliability-engineer"],
      ["Cloud Engineer", "cloud-engineer"],
      ["AWS Architect", "cloud-architect"],
      ["DevOps Engineer", "devops-engineer"],
      ["Data Scientist", "data-scientist"],
      ["AWS Solutions Architect", "cloud-architect"],
      ["ML Ops Engineer", "mlops-engineer"],
      ["Security Engineer, Cloud", "cloud-security-engineer"],
      ["Security Engineer", "cyber-security-analyst"],
      ["GRC Manager", "grc-manager"],
      ["GRC Analyst", "information-security-analyst"],
      ["SOC Lead", "soc-lead"],
      ["SOC Analyst L2", "soc-analyst-l2"],
      ["Senior Software Engineer", "senior-backend-engineer"],
      ["Senior Java Developer", "senior-backend-engineer"],
      ["Java Developer", "java-backend-developer"],
      ["Senior Frontend Engineer", "frontend-developer"],
      ["Senior Android Developer", "android-developer"],
      ["Engineering Manager", "engineering-manager"],
      ["Senior Data Scientist", "senior-data-scientist"],
      ["Senior Software Engineer, Machine Learning", "ml-engineer"],
      ["Senior Software Engineer, Data", "data-engineer"],
      ["Senior Software Engineer, Security", "appsec-engineer"],
      ["Senior Software Engineer, Infrastructure", "devops-engineer"],
      ["Senior Software Engineer, Cloud", "cloud-engineer"],
      ["Senior Software Engineer, SRE", "site-reliability-engineer"],
      ["Senior Software Engineer, Android", "android-developer"],
      ["Senior Software Engineer - Frontend", "frontend-developer"],
      ["Security Operations Center Lead", "soc-lead"],
      ["Software Engineer", "software-engineer"],
      ["SDE II", "software-engineer"],
      ["Embedded Software Engineer", "embedded-software-engineer"],
      ["Software Engineer in Test", "qa-automation-engineer"],
      ["Software Development Engineer in Test", "qa-automation-engineer"],
      ["Software Engineer - QA", "qa-automation-engineer"],
      ["Software Engineer III", "senior-backend-engineer"],
      ["SDE 3", "senior-backend-engineer"],
      ["Software Engineer II", "software-engineer"],
      ["Solutions Architect", "solutions-architect"],
      ["Technical Architect", "solutions-architect"],
      ["Cloud Architect", "cloud-architect"],
      ["Azure Cloud Architect", "cloud-architect"],
      ["Cloud Engineer, AWS", "cloud-engineer"],
      ["Security Architect", "security-architect"],
      ["Information Security Architect", "security-architect"],
      ["Cloud Security Architect", "security-architect"],
      ["Information Security Analyst", "information-security-analyst"],
      ["IAM Engineer", "iam-engineer"],
      ["Identity and Access Management Analyst", "iam-engineer"],
      ["SailPoint Developer", "iam-engineer"],
      ["Network Engineer", "network-engineer"],
      ["L2 Network Engineer", "network-engineer"],
      ["NOC Engineer", "noc-engineer"],
      ["Network Security Engineer", "network-security-engineer"],
      ["System Administrator", "system-administrator"],
      ["Linux Administrator", "system-administrator"],
      ["Windows Server Administrator", "system-administrator"],
      ["Incident Response Analyst", "incident-response-analyst"],
      ["DFIR Consultant", "incident-response-analyst"],
      ["Cyber Security Analyst", "cyber-security-analyst"],
      ["AI Engineer", "ai-engineer"],
      ["Generative AI Engineer", "ai-engineer"],
      ["GenAI Developer", "ai-engineer"],
      ["AI/ML Engineer", "ml-engineer"],
      ["ML Engineer", "ml-engineer"],
      ["MLOps Engineer", "mlops-engineer"],
      ["ML Platform Engineer", "mlops-engineer"],
      ["Python Developer", "python-developer"],
      ["Django Developer", "python-developer"],
      ["Senior Python Developer", "senior-backend-engineer"],
      ["Python Full Stack Developer", "full-stack-developer"],
      [".NET Developer", "dotnet-developer"],
      ["Dot Net Developer", "dotnet-developer"],
      ["ASP.NET Web Developer", "dotnet-developer"],
      ["C# Developer", "dotnet-developer"],
      ["BI Developer", "bi-developer"],
      ["Power BI Developer", "bi-developer"],
      ["BI Analyst", "data-analyst"],
      ["Database Administrator", "database-administrator"],
      ["Oracle DBA", "database-administrator"],
      ["Database Architect", "database-architect"],
      ["Manual Test Engineer", "manual-test-engineer"],
      ["QA Engineer (Manual)", "manual-test-engineer"],
      ["Software Tester", "manual-test-engineer"],
      ["QA Automation Engineer", "qa-automation-engineer"],
      ["Manual and Automation Test Engineer", "qa-automation-engineer"],
      ["Platform Engineer", "platform-engineer"],
      ["Software Engineer - Platform", "platform-engineer"],
      ["Senior DevOps Engineer, Platform Reliability", "devops-engineer"],
      ["ML Platform Engineer", "mlops-engineer"],
      ["Data Architect", "data-architect"],
      ["Azure Data Architect", "data-architect"],
      ["Data Modeler", "database-architect"],
      ["Firmware Engineer", "embedded-software-engineer"],
      ["Embedded C Developer", "embedded-software-engineer"],
      ["Firmware Validation Engineer", null],
      ["Salesforce Developer", "salesforce-developer"],
      ["SFDC Developer", "salesforce-developer"],
      ["Salesforce Lightning Developer", "salesforce-developer"],
      ["ServiceNow Developer", "servicenow-developer"],
      ["ServiceNow ITSM Developer", "servicenow-developer"],
      ["SAP ABAP Developer", "sap-abap-developer"],
      ["SAP ABAP Consultant", "sap-abap-developer"],
      ["Node.js Developer", "nodejs-developer"],
      ["Backend Engineer - NestJS", "nodejs-developer"],
      ["Senior Node.js Developer", "senior-backend-engineer"],
      ["MERN Stack Developer", "full-stack-developer"],
      ["IT Support Engineer", "it-support-engineer"],
      ["Desktop Support Engineer", "it-support-engineer"],
      ["Service Desk Engineer", "it-support-engineer"],
      ["Technical Support Engineer", "technical-support-engineer"],
      ["Product Support Engineer", "technical-support-engineer"],
      ["Cloud Support Engineer", "cloud-support-engineer"],
      ["Database Support Engineer", "database-administrator"],
      ["Threat Intelligence Analyst", "threat-intelligence-analyst"],
      ["CTI Analyst", "threat-intelligence-analyst"],
      ["Threat Hunter", "soc-analyst-l2"],
      ["Vulnerability Management Analyst", "vulnerability-management-analyst"],
      ["VAPT Analyst", "vulnerability-management-analyst"],
      ["Penetration Tester - VAPT", "penetration-tester"],
      ["Performance Test Engineer", "performance-test-engineer"],
      ["Load Test Engineer", "performance-test-engineer"],
      ["Performance Marketing Specialist", "digital-marketing-executive"],
      ["Scrum Master", "scrum-master"],
      ["Agile Project Manager", "scrum-master"],
      ["Technical Writer", "technical-writer"],
      ["Documentation Specialist", "technical-writer"],
      ["UX Writer", "ui-ux-designer"],
      ["Content Writer", "content-writer"],
      ["AI Application Developer", "ai-engineer"],
      ["Kotlin Developer", "android-developer"],
      ["Jetpack Compose Developer", "android-developer"],
      ["Software Security Engineer", "appsec-engineer"],
      ["Secure Code Reviewer", "appsec-engineer"],
      ["DevSecOps Engineer", "devsecops-engineer"],
      ["Dashboard Developer", "bi-developer"],
      ["Functional Analyst", "business-analyst"],
      ["Functional Consultant", "business-analyst"],
      ["Requirements Analyst", "business-analyst"],
      ["Techno-Functional Analyst", "business-analyst"],
      ["Cloud Infrastructure Engineer", "cloud-engineer"],
      ["AWS Security Engineer", "cloud-security-engineer"],
      ["Azure Security Engineer", "cloud-security-engineer"],
      ["CSPM Engineer", "cloud-security-engineer"],
      ["Cross-Platform App Developer", "cross-platform-mobile-developer"],
      ["MIS Analyst", "data-analyst"],
      ["Analytics Associate", "data-analyst"],
      ["Principal Data Architect", "data-architect"],
      ["Data Pipeline Engineer", "data-engineer"],
      ["PySpark Developer", "data-engineer"],
      ["Databricks Engineer", "data-engineer"],
      ["Data Integration Engineer", "data-engineer"],
      ["Data Science Associate", "data-scientist"],
      ["Data Science Analyst", "data-scientist"],
      ["Decision Scientist", "data-scientist"],
      ["Predictive Modeler", "data-scientist"],
      ["Statistical Modeller", "data-scientist"],
      ["Principal Database Engineer", "database-architect"],
      ["Database Design Engineer", "database-architect"],
      ["Build and Release Engineer", "build-release-engineer"],
      ["Release Engineer", "build-release-engineer"],
      ["CI/CD Engineer", "devops-engineer"],
      ["CI/CD Engineer", "devops-engineer"],
      ["Infrastructure Automation Engineer", "devops-engineer"],
      ["Kubernetes Engineer", "devops-engineer"],
      ["Social Media Executive", "digital-marketing-executive"],
      ["Online Marketing Executive", "digital-marketing-executive"],
      ["Full Stack .NET Developer", "dotnet-developer"],
      ["Development Manager", "engineering-manager"],
      ["Technical Manager", "engineering-manager"],
      ["Head of Engineering", "engineering-manager"],
      ["Engineering Lead", "engineering-manager"],
      ["ReactJS Developer", "frontend-developer"],
      ["JavaScript Developer", "frontend-developer"],
      ["Next.js Developer", "frontend-developer"],
      ["Full Stack Web Developer", "full-stack-developer"],
      ["Web Developer", "frontend-developer"],
      ["ISMS Manager", "grc-manager"],
      ["Information Security Compliance Manager", "grc-manager"],
      ["Head of GRC", "grc-manager"],
      ["Incident Handler", "incident-response-analyst"],
      ["CSIRT Analyst", "incident-response-analyst"],
      ["CERT Analyst", "incident-response-analyst"],
      ["ISMS Analyst", "information-security-analyst"],
      ["IT Compliance Analyst", "information-security-analyst"],
      ["Third-Party Risk Analyst", "third-party-risk-analyst"],
      ["iPhone App Developer", "ios-developer"],
      ["Swift Developer", "ios-developer"],
      ["SwiftUI Developer", "ios-developer"],
      ["Spring Boot Developer", "java-backend-developer"],
      ["J2EE Developer", "java-backend-developer"],
      ["QA Analyst", "manual-test-engineer"],
      ["Quality Analyst", "manual-test-engineer"],
      ["Software Test Engineer", "qa-automation-engineer"],
      ["Test Engineer", "manual-test-engineer"],
      ["QA Engineer", "qa-automation-engineer"],
      ["AI/ML Developer", "ml-engineer"],
      ["Machine Learning Developer", "ml-engineer"],
      ["ML DevOps Engineer", "mlops-engineer"],
      ["Model Ops Engineer", "mlops-engineer"],
      ["Firewall Engineer", "network-security-engineer"],
      ["SDE 1 - Backend", "software-engineer"],
      ["Ethical Hacker", "penetration-tester"],
      ["Security Tester", "penetration-tester"],
      ["Web Application Security Tester", "penetration-tester"],
      ["Vulnerability Assessment Analyst", "penetration-tester"],
      ["DPDP Compliance Analyst", "privacy-analyst"],
      ["GDPR Analyst", "privacy-analyst"],
      ["Product Lead", "product-manager"],
      ["Product Specialist", "product-manager"],
      ["Automation Tester", "qa-automation-engineer"],
      ["Selenium Automation Engineer", "qa-automation-engineer"],
      ["Backend Tech Lead", "senior-backend-engineer"],
      ["Staff Backend Engineer", "senior-backend-engineer"],
      ["Principal Backend Engineer", "senior-backend-engineer"],
      ["Principal Data Scientist", "senior-data-scientist"],
      ["Staff Data Scientist", "senior-data-scientist"],
      ["Data Science Lead", "senior-data-scientist"],
      ["Data Science Manager", "senior-data-scientist"],
      ["Production Engineer", "site-reliability-engineer"],
      ["Reliability Engineer", "site-reliability-engineer"],
      ["Systems Reliability Engineer", "site-reliability-engineer"],
      ["Infrastructure Reliability Engineer", "site-reliability-engineer"],
      ["Platform Reliability Engineer", "site-reliability-engineer"],
      ["Observability Engineer", "site-reliability-engineer"],
      ["Senior SOC Analyst", "soc-analyst-l2"],
      ["Security Operations Analyst", "soc-analyst-l2"],
      ["Cyber Defense Analyst", "soc-analyst-l2"],
      ["SIEM Analyst", "soc-analyst-l2"],
      ["Detection Engineer", "soc-analyst-l2"],
      ["Security Operations Manager", "soc-lead"],
      ["Security Operations Lead", "soc-lead"],
      ["Head of Security Operations", "soc-lead"],
      ["Cyber Defense Manager", "soc-lead"],
      ["Detection and Response Manager", "soc-lead"],
      ["SOC Shift Lead", "soc-lead"],
      ["Programmer Analyst", "software-engineer"],
      ["Application Developer", "software-engineer"],
      ["Member of Technical Staff", "software-engineer"],
      ["Enterprise Architect", "solutions-architect"],
      ["Pre-Sales Architect", "solutions-architect"],
      ["IT Administrator", "system-administrator"],
      ["Systems Engineer", null],
      ["Infrastructure Support Engineer", "system-administrator"],
      ["Web Designer", "ui-ux-designer"],
      ["PHP Developer", "php-developer"],
      ["Laravel Developer", "php-developer"],
      ["WordPress Developer", "php-developer"],
      ["Golang Developer", "golang-developer"],
      ["Software Engineer - Go", "golang-developer"],
      ["Senior Golang Developer", "senior-backend-engineer"],
      ["Mainframe Developer", "mainframe-developer"],
      ["COBOL Programmer", "mainframe-developer"],
      ["ETL Developer", "etl-developer"],
      ["Informatica Developer", "etl-developer"],
      ["SSIS Developer", "etl-developer"],
      ["ETL Test Engineer", "data-quality-engineer"],
      ["Power Platform Developer", "power-platform-developer"],
      ["Power Apps Developer", "power-platform-developer"],
      ["Game Developer", "game-developer"],
      ["Unity Developer", "game-developer"],
      ["Mobile Game Developer", "game-developer"],
      ["Computer Vision Engineer", "computer-vision-engineer"],
      ["Vision AI Engineer", "computer-vision-engineer"],
      ["Video Analytics Engineer", "computer-vision-engineer"],
      ["Senior DevSecOps Engineer", "devsecops-engineer"],
      ["CI/CD Security Engineer", "devsecops-engineer"],
      ["OT Security Engineer", "ot-security-engineer"],
      ["OT/ICS Security Engineer", "ot-security-engineer"],
      ["Industrial Security Officer", null],
      ["Data Governance Analyst", "data-governance-analyst"],
      ["Data Quality Analyst", "data-governance-analyst"],
      ["Data Steward", "data-governance-analyst"],
      ["Technical Lead", "tech-lead"],
      ["Lead Software Engineer", "tech-lead"],
      ["Java Technical Lead", "tech-lead"],
      ["QA Lead", "qa-lead"],
      ["Test Lead", "qa-lead"],
      ["Lead SDET", "qa-lead"],
      ["Hardware Test Lead", null],
      ["AWS Support Engineer", "cloud-support-engineer"],
      ["Cloud Technical Support Engineer", "cloud-support-engineer"],
      ["Blockchain Developer", "blockchain-developer"],
      ["Solidity Developer", "blockchain-developer"],
      ["Web3 Developer", "blockchain-developer"],
      ["Analytics Engineer", "analytics-engineer"],
      ["dbt Developer", "analytics-engineer"],
      ["Application Support Engineer", "application-support-engineer"],
      ["Production Support Analyst", "application-support-engineer"],
      ["Product Support Engineer", "technical-support-engineer"],
      ["Cloud FinOps Analyst", "cloud-finops-analyst"],
      ["FinOps Engineer", "cloud-finops-analyst"],
      ["Cloud Cost Analyst", "cloud-finops-analyst"],
      ["Financial Analyst", "financial-analyst"],
      ["FP&A Analyst", "financial-analyst"],
      ["PL/SQL Developer", "database-developer"],
      ["T-SQL Developer", "database-developer"],
      ["ETL SQL Developer", "etl-developer"],
      ["RPA Developer", "rpa-developer"],
      ["UiPath Developer", "rpa-developer"],
      ["Automation Developer", "rpa-developer"],
      ["Test Automation Developer", "qa-automation-engineer"],
      ["Robotics Process Automation Developer", "rpa-developer"],
      ["Dynamics 365 CRM Developer", "dynamics-365-developer"],
      ["D365 Finance and Operations Developer", null],
      ["Vehicle Dynamics Engineer", null],
      ["Oracle Fusion Technical Consultant", "oracle-fusion-technical-consultant"],
      ["Oracle Integration Cloud Consultant", "oracle-fusion-technical-consultant"],
      ["Oracle Cloud Infrastructure Engineer", "cloud-engineer"],
      ["Frontend Architect", "frontend-architect"],
      ["UI Architect", "frontend-architect"],
      ["Staff Frontend Engineer", "frontend-architect"],
      ["AR/VR Developer", "ar-vr-developer"],
      ["Unity XR Developer", "ar-vr-developer"],
      ["Network Security Specialist", "network-security-engineer"],
      ["Zscaler Engineer", "network-security-engineer"],
      ["Network Security Analyst", "cyber-security-analyst"],
      ["IoT Developer", "iot-engineer"],
      ["IoT Firmware Engineer", "embedded-software-engineer"],
      ["Robotics Engineer", "robotics-engineer"],
      ["ROS 2 Engineer", "robotics-engineer"],
      ["Robot Framework Automation Engineer", null],
      ["Mechanical Engineer - Robotics", null],
      ["RTL Design Engineer", "vlsi-design-engineer"],
      ["Design Verification Engineer", "design-verification-engineer"],
      ["ASIC Physical Design Engineer", "physical-design-engineer"],
      ["Software Verification Engineer", null],
      ["Storage Engineer", "storage-backup-engineer"],
      ["Backup Administrator", "storage-backup-engineer"],
      ["Data Protection Engineer", "storage-backup-engineer"],
      ["Data Protection Analyst", "privacy-analyst"],
      ["SAP Basis Consultant", "sap-basis-administrator"],
      ["SAP HANA DBA", "sap-basis-administrator"],
      ["Developer on contract basis", null],
      ["SAP FICO Consultant", "sap-fico-consultant"],
      ["SAP S/4HANA Finance Consultant", "sap-fico-consultant"],
      ["SAP MM Consultant", "sap-mm-consultant"],
      ["Pega Developer", "pega-developer"],
      ["Pega Lead System Architect", "pega-developer"],
      ["Pega Business Analyst", "business-analyst"],
      ["Pegasus Engineer", null],
      ["MuleSoft Developer", "integration-developer"],
      ["Dell Boomi Developer", "integration-developer"],
      ["Data Integration Engineer", "data-engineer"],
      ["Integration Test Engineer", "qa-automation-engineer"],
      ["Systems Integration Engineer", null],
      ["Technical Program Manager", "technical-program-manager"],
      ["Staff Technical Program Manager", "technical-program-manager"],
      ["Engineering Program Manager", "technical-program-manager"],
      ["Program Manager", null],
      ["Software Configuration Management Engineer", "build-release-engineer"],
      ["Build Engineer", "build-release-engineer"],
      ["Building Services Engineer", null],
      ["Supply Chain SCM Engineer", null],
      ["Release Manager", null],
      ["C++ Developer", "cpp-developer"],
      ["C/C++ Developer", "cpp-developer"],
      ["Software Engineer - C++", "cpp-developer"],
      ["Embedded C++ Developer", "embedded-software-engineer"],
      ["C# Developer", "dotnet-developer"],
      ["C Developer", null],
      ["NOC Analyst", "noc-engineer"],
      ["Network Operations Center Engineer", "noc-engineer"],
      ["Network Operations Engineer", "network-engineer"],
      ["Unified Communications Engineer", "unified-communications-engineer"],
      ["Microsoft Teams Voice Engineer", "unified-communications-engineer"],
      ["Voice AI Engineer", "ai-engineer"],
      ["Office 365 Collaboration Administrator", "m365-administrator"],
      ["Ruby on Rails Developer", "ruby-on-rails-developer"],
      ["Full Stack Ruby on Rails Developer", "ruby-on-rails-developer"],
      ["Ruby QA Engineer", "qa-automation-engineer"],
      ["Railway Engineer", null],
      ["NLP Engineer", "nlp-engineer"],
      ["NLP Data Scientist", "nlp-engineer"],
      ["Text Analytics Engineer", "nlp-engineer"],
      ["Machine Learning Engineer - NLP", "ml-engineer"],
      ["Senior Data Scientist - NLP", "senior-data-scientist"],
      ["Salesforce Administrator", "salesforce-administrator"],
      ["Salesforce System Administrator", "salesforce-administrator"],
      ["CRM Administrator (Salesforce)", "salesforce-administrator"],
      ["Digital Forensics Analyst", "digital-forensics-analyst"],
      ["Forensic Analyst", "digital-forensics-analyst"],
      ["Cyber Forensics Investigator", "incident-response-analyst"],
      ["Fraud Forensic Analyst", null],
      ["Forensic Accountant", null],
      ["GIS Developer", "gis-developer"],
      ["Web GIS Developer", "gis-developer"],
      ["GIS Analyst", null],
      ["Logistics Developer", null],
      ["VMware Engineer", "virtualization-engineer"],
      ["Nutanix Administrator", "virtualization-engineer"],
      ["VMware Support Engineer", "system-administrator"],
      ["End User Computing (EUC) Engineer", "euc-engineer"],
      ["Citrix Engineer", "euc-engineer"],
      ["Intune Engineer", "euc-engineer"],
      ["EUC Analyst", "it-support-engineer"],
      ["IT Infrastructure Service Desk Agent", "it-support-engineer"],
      ["Service Desk Agent", "it-support-engineer"],
      // Business desks are not IT support unless the title says IT (T152).
      ["Customer Service Desk Agent", "customer-support-executive"],
      ["HR Service Desk Agent", null],
      ["Travel Service Desk Agent", null],
      ["HR Helpdesk Executive", null],
      ["HR IT Helpdesk Analyst", "it-support-engineer"],
      ["Hardware Architect", "hardware-design-engineer"],
      // A chip-level (SoC) architect is not board-level hardware design (Testing T160).
      ["SoC Hardware Architect", null],
      ["Chip Hardware Architect", null],
      ["Staff Site Reliability Engineer", null],
      ["Citrix NetScaler Engineer", null],
      ["Packaging Engineer", null],
      ["Office 365 Administrator", "m365-administrator"],
      ["Exchange Online Administrator", "m365-administrator"],
      ["SharePoint Administrator", "m365-administrator"],
      ["Foreign Exchange Analyst", null],
      ["SAP S/4HANA MM Consultant", "sap-mm-consultant"],
      ["SAP Ariba Procurement Consultant", null],
      ["Procurement Analyst", "supply-chain-analyst"],
      ["Workday HCM Consultant", "workday-consultant"],
      ["Workday Reporting Analyst", "workday-consultant"],
      ["Workday Integration Developer", "workday-consultant"],
      ["UX Researcher", "ux-researcher"],
      ["User Researcher", "ux-researcher"],
      ["Usability Analyst", "ux-researcher"],
      ["Market Research Analyst", "market-research-analyst"],
      ["IT Project Manager", "it-project-manager"],
      ["Project Manager - ERP Implementation", "it-project-manager"],
      ["IT PMO Manager", "it-project-manager"],
      ["Project Manager", null],
      ["Construction Project Manager - Infrastructure", null],
      ["Shopify Developer", "ecommerce-developer"],
      ["Magento Developer", "ecommerce-developer"],
      ["Salesforce Commerce Cloud Developer", "ecommerce-developer"],
      ["Ecommerce Software Engineer", "software-engineer"],
      ["FPGA Engineer", "fpga-engineer"],
      ["FPGA Design Engineer", "fpga-engineer"],
      ["FPGA Validation Engineer", null],
      ["RTL Design Engineer", "vlsi-design-engineer"],
      ["RF Optimization Engineer", "telecom-ran-engineer"],
      ["RF Performance Engineer", "telecom-ran-engineer"],
      ["Drive Test Engineer", "telecom-ran-engineer"],
      ["5G RAN Engineer", "telecom-ran-engineer"],
      ["RF Design Engineer", null],
      ["RAN Software Engineer", "software-engineer"],
      ["Malware Analyst", "malware-analyst"],
      ["Threat Researcher - Malware", "malware-analyst"],
      ["Security Reverse Engineer", "malware-analyst"],
      ["Reverse Engineer", null],
      ["SharePoint Developer", "sharepoint-developer"],
      ["SPFx Developer", "sharepoint-developer"],
      ["SharePoint and Power Apps Developer", "power-platform-developer"],
      ["Appian Developer", "low-code-developer"],
      ["OutSystems Developer", "low-code-developer"],
      ["Low-Code Application Developer", "low-code-developer"],
      ["Pre-Sales Engineer", "presales-engineer"],
      ["Technical Presales Consultant", "presales-engineer"],
      ["Cyber Security Presales Engineer", "presales-engineer"],
      ["Solutions Engineer", "presales-engineer"],
      ["Solution Engineer", "presales-engineer"],
      ["Sales Engineer", null],
      ["Senior Sales Engineer", null],
      ["Support Engineer", "technical-support-engineer"],
      ["Senior Escalation Engineer", "technical-support-engineer"],
      ["IT Support Engineer", "it-support-engineer"],
      ["Professional Services Consultant", "implementation-consultant"],
      ["SOC L3 Analyst", "soc-lead"],
      ["Director of Engineering", "engineering-manager"],
      ["Tech Lead Manager", "engineering-manager"],
      ["Director, Data Analytics", null],
      ["MTS", "software-engineer"],
      ["Backend Engineer", "software-engineer"],
      ["Senior Backend Engineer", "senior-backend-engineer"],
      ["Manual & Automation Testing", "qa-automation-engineer"],
      ["Staff Software Engineer", null],
      ["Principal Product Manager", null],
      ["Presales Manager", null],
      ["SaaS Implementation Consultant", "implementation-consultant"],
      ["Implementation Manager", "implementation-consultant"],
      ["Customer Onboarding Specialist", "implementation-consultant"],
      ["Workday Implementation Consultant", "workday-consultant"],
      ["Implementation Project Manager", "it-project-manager"],
      ["Client Onboarding Specialist", null],
      ["HR Onboarding Specialist", null],
      ["SAP SD Consultant", "sap-sd-consultant"],
      ["SAP Sales and Distribution Consultant", "sap-sd-consultant"],
      ["SAP OTC Consultant", "sap-sd-consultant"],
      ["Sales and Distribution Manager", null],
      ["SAP SuccessFactors Consultant", "sap-successfactors-consultant"],
      ["SuccessFactors Employee Central Consultant", "sap-successfactors-consultant"],
      ["SuccessFactors Recruiting and Onboarding Consultant", "sap-successfactors-consultant"],
      ["SuccessFactors Functional Consultant", "sap-successfactors-consultant"],
      ["SAP Recruiter", null],
      ["Data Center Engineer", "data-center-engineer"],
      ["Data Centre Technician", "data-center-engineer"],
      ["Data Center Infrastructure Engineer", "data-center-engineer"],
      ["Remote Hands Engineer", "data-center-engineer"],
      ["Data Center Network Engineer", "network-engineer"],
      ["Data Center Facility Engineer", null],
      ["ServiceNow Administrator", "servicenow-administrator"],
      ["ServiceNow System Administrator", "servicenow-administrator"],
      ["ServiceNow Platform Analyst", "servicenow-administrator"],
      ["ServiceNow Platform Engineer", "servicenow-developer"],
      ["ServiceNow Business Analyst", "business-analyst"],
      ["Quantitative Developer", "quant-developer"],
      ["Low Latency C++ Developer", "quant-developer"],
      ["C++ Developer - Low Latency Trading", "quant-developer"],
      ["HFT Developer", "quant-developer"],
      ["Quantitative Analyst", null],
      ["HPC Engineer", "hpc-gpu-engineer"],
      ["CUDA Developer", "hpc-gpu-engineer"],
      ["GPU Performance Engineer", "hpc-gpu-engineer"],
      ["HPC Infrastructure Engineer", "hpc-gpu-engineer"],
      ["GPU Design Verification Engineer", "design-verification-engineer"],
      ["GPU Hardware Engineer", null],
      ["Cloud Network Engineer", "cloud-network-engineer"],
      ["Azure Network Engineer", "cloud-network-engineer"],
      ["Azure Network Security Engineer", "network-security-engineer"],
      ["Technical Account Manager", "technical-account-manager"],
      ["Technical Customer Success Manager", "technical-account-manager"],
      ["Customer Success Manager", "customer-success-manager"],
      ["Developer Advocate", "developer-advocate"],
      ["Developer Relations Engineer", "developer-advocate"],
      ["Python Developer Advocate", "developer-advocate"],
      ["Developer Relations Manager", null],
      ["Post-Silicon Validation Engineer", "post-silicon-validation-engineer"],
      ["SoC Validation Engineer", "post-silicon-validation-engineer"],
      ["Silicon Bring-up Engineer", "post-silicon-validation-engineer"],
      ["Computer System Validation Engineer", null],
      ["AUTOSAR Developer", "autosar-engineer"],
      ["AUTOSAR Integration Engineer", "autosar-engineer"],
      ["MCAL Developer", "autosar-engineer"],
      ["Automotive Embedded Software Engineer", "embedded-software-engineer"],
      ["PLC Programmer", "plc-scada-engineer"],
      ["SCADA Engineer", "plc-scada-engineer"],
      ["Commissioning Engineer - Automation", "plc-scada-engineer"],
      ["SCADA Security Engineer", "ot-security-engineer"],
      ["Control Systems Engineer", null],
      ["Teamcenter Developer", "plm-developer"],
      ["Windchill Developer", "plm-developer"],
      ["PLM Software Engineer", "plm-developer"],
      ["PLM Business Analyst", "business-analyst"],
      ["PAM Engineer", "pam-engineer"],
      ["CyberArk Engineer", "pam-engineer"],
      ["Privileged Access Management Engineer", "pam-engineer"],
      ["Okta Engineer", "iam-engineer"],
      ["SIEM Engineer", "siem-engineer"],
      ["Splunk Engineer", "siem-engineer"],
      ["SIEM Platform Engineer", "siem-engineer"],
      ["SIEM Analyst", "soc-analyst-l2"],
      ["SentinelOne Engineer", null],
      ["DLP Engineer", "dlp-engineer"],
      ["Microsoft Purview Engineer", "dlp-engineer"],
      ["Purview Data Governance Analyst", "data-governance-analyst"],
      ["Data Security Engineer", "cyber-security-analyst"],
      ["Red Team Operator", "red-team-operator"],
      ["Adversary Emulation Engineer", "red-team-operator"],
      ["Red Team Analyst", "penetration-tester"],
      ["Third-Party Risk Management Analyst", "third-party-risk-analyst"],
      ["Vendor Risk Analyst", "third-party-risk-analyst"],
      ["Supplier Risk Analyst", null],
      ["IT Auditor", "it-auditor"],
      ["IT Audit Analyst", "it-auditor"],
      ["Information Systems Auditor", "it-auditor"],
      ["Internal Auditor", "audit-associate"],
      ["Kafka Engineer", "kafka-streaming-engineer"],
      ["Streaming Data Engineer", "kafka-streaming-engineer"],
      ["Streaming Platform Engineer", "kafka-streaming-engineer"],
      ["Video Streaming Engineer", null],
      ["Search Engineer", "search-engineer"],
      ["Software Engineer - Search", "search-engineer"],
      ["Elasticsearch Developer", "search-engineer"],
      ["ML Engineer - Search", "ml-engineer"],
      ["SEO Engineer", null],
      ["Linux Kernel Developer", "linux-kernel-developer"],
      ["Linux Device Driver Developer", "linux-kernel-developer"],
      ["Kernel Software Engineer", "linux-kernel-developer"],
      ["CUDA Kernel Engineer", "hpc-gpu-engineer"],
      ["Windows Device Driver Engineer", null],
      ["Rust Developer", "rust-developer"],
      ["Software Engineer - Rust", "rust-developer"],
      ["Rust Blockchain Developer", "blockchain-developer"],
      ["AI Product Manager", "ai-product-manager"],
      ["Product Manager - Generative AI", "ai-product-manager"],
      ["Technical Product Manager - AI/ML", "ai-product-manager"],
      ["Data Quality Engineer", "data-quality-engineer"],
      ["ETL QA Engineer", "data-quality-engineer"],
      ["Data Observability Engineer", "data-quality-engineer"],
      ["Data Quality Analyst", "data-governance-analyst"],
      ["Informatica Data Quality Developer", "etl-developer"],
      ["Oracle EBS Technical Consultant", "oracle-ebs-consultant"],
      ["Oracle Apps Technical Consultant", "oracle-ebs-consultant"],
      ["Oracle EBS Techno-Functional Consultant", "oracle-ebs-consultant"],
      ["Oracle EBS Functional Consultant", "business-analyst"],
      ["Oracle Apps DBA", "database-administrator"],
      ["SAP PP Consultant", "sap-pp-consultant"],
      ["SAP Production Planning Consultant", "sap-pp-consultant"],
      ["SAP PP/QM Consultant", "sap-pp-consultant"],
      ["SAP PP ABAP Developer", "sap-abap-developer"],
      ["NICE CXone Developer", "contact-center-developer"],
      ["Amazon Connect Developer", "contact-center-developer"],
      ["Genesys Cloud Developer", "contact-center-developer"],
      ["IVR Developer", "contact-center-developer"],
      ["Contact Center Support Engineer", null],
      ["Voice Engineer", "unified-communications-engineer"],
      ["Forward Deployed Engineer", "forward-deployed-engineer"],
      ["Forward Deployed AI Engineer", "forward-deployed-engineer"],
      ["Forward Deployed Software Engineer", "forward-deployed-engineer"],
      ["Application Engineering ADAS", "adas-engineer"],
      ["ADAS Calibration Engineer", "adas-engineer"],
      ["ADAS Perception Engineer", "computer-vision-engineer"],
      ["C++ Experts for ADAS HIL Framework Development", "hil-test-engineer"],
      ["HIL Test Engineer", "hil-test-engineer"],
      ["HIL Validation Engineer", "hil-test-engineer"],
      ["ECU Validation Engineer", "hil-test-engineer"],
      ["Hardware Test Engineer", null],
      ["Automotive (Systems) Diagnostic and Troubleshooting Engineer", "automotive-diagnostics-engineer"],
      ["Automotive (Systems) Diagnostic and Troubleshooting Engineer for EV & HEV Systems", "automotive-diagnostics-engineer"],
      ["Vehicle Diagnostics Engineer", "automotive-diagnostics-engineer"],
      ["UDS Diagnostics Developer", null],
      ["Senior ECU Hardware Development", "hardware-design-engineer"],
      ["Lead Hardware Engineer", "hardware-design-engineer"],
      ["Senior Hardware Design Engineer", "hardware-design-engineer"],
      ["Embedded Hardware Engineer", "hardware-design-engineer"],
      ["Hardware Engineer", null],
      ["Hardware Engineer - Plant Maintenance", null],
      ["IT Hardware Engineer", null],
      ["Hardware and Networking Engineer", null],
      ["Analog Design Engineer", "analog-ic-design-engineer"],
      ["AI Research Scientist", "ai-research-scientist"],
      ["Research Scientist - Machine Learning", "ai-research-scientist"],
      ["Research Scientist, NLP", "ai-research-scientist"],
      ["Applied Research Scientist", "ai-research-scientist"],
      ["Research Scientist", null],
      ["Associate Research Scientist", null],
      ["Research Scientist - Analytical Chemistry", null],
      ["Applied Scientist", "data-scientist"],
      ["AI Architect", "ai-architect"],
      ["Applied AI Architect", "ai-architect"],
      ["GenAI Solution Architect", "ai-architect"],
      ["AI Security Architect", "security-architect"],
      ["AI Success Manager", "customer-success-manager"],
      ["Client Success Manager", "customer-success-manager"],
      ["Customer Success Executive", null],
      ["Customer Success Engineer", "technical-support-engineer"],
      ["Reliability Engineer - Hardware", null],
      ["Principal Software Engineer", null],
      ["Business Development Manager", null],
      ["Pre-Sales Solution Architect", "solutions-architect"],
      ["Staff Software Engineer", null],
      ["Graphic Designer", "graphic-designer"],
      // Business roles (batch B1): each read only from the titles built for it.
      ["Key Account Manager", "key-account-manager"],
      ["Key Account Manager - Modern Trade", "key-account-manager"],
      ["National Key Account Manager", "key-account-manager"],
      ["Key Accounts Manager", "key-account-manager"],
      ["Key Account Executive - Modern Trade", "key-account-manager"],
      ["Modern Trade Manager", "key-account-manager"],
      ["Account Manager", null],
      ["Partner Account Manager", null],
      ["Area Sales Manager", "area-sales-manager"],
      ["Area Sales Manager - FMCG", "area-sales-manager"],
      ["Senior Area Sales Manager", "area-sales-manager"],
      ["Area Manager - Sales", "area-sales-manager"],
      ["Territory Sales Manager", "area-sales-manager"],
      ["Area Business Manager", "area-sales-manager"],
      ["Area Manager", null],
      ["Sales Manager", null],
      ["Regional Sales Manager", null],
      ["Inside Sales Executive", "inside-sales-executive"],
      ["Inside Sales Representative", "inside-sales-executive"],
      ["Sales Development Representative", "inside-sales-executive"],
      ["Business Development Representative", "inside-sales-executive"],
      ["SDR - SaaS", "inside-sales-executive"],
      ["Account Executive - Inside Sales", "inside-sales-executive"],
      ["Account Executive", null],
      ["Business Development Executive", "business-development-executive"],
      ["Inside Sales Engineer", null],
      ["Sales Executive", null],
      ["Head of Sales", null],
      ["Product Marketing Manager", "product-marketing-manager"],
      ["Senior Product Marketing Manager", "product-marketing-manager"],
      ["Manager, Product Marketing", "product-marketing-manager"],
      ["Product Marketing Specialist", "product-marketing-manager"],
      ["Principal Product Marketing Manager", null],
      ["Director, Product Marketing", null],
      ["Product Marketing Intern", null],
      ["Marketing Manager", null],
      ["Senior Financial Analyst - FP&A", "financial-analyst"],
      ["Financial Planning and Analysis Analyst", "financial-analyst"],
      ["Business Finance Analyst", "financial-analyst"],
      ["Commercial Finance Analyst", "financial-analyst"],
      ["Financial Systems Analyst", null],
      ["Finance Systems Analyst", null],
      ["Financial Data Analyst", "data-analyst"],
      ["Cloud Financial Analyst", "cloud-finops-analyst"],
      ["Staff Financial Analyst", null],
      ["Treasury Analyst", "treasury-analyst"],
      ["Accounts Executive", "accounts-executive"],
      ["Executive - Accounts", "accounts-executive"],
      ["Accounts and Taxation Executive", "accounts-executive"],
      ["Accounts Payable Executive", "accounts-executive"],
      ["Junior Accountant", "accounts-executive"],
      ["Tally Accountant", "accounts-executive"],
      ["Chartered Accountant", null],
      ["Credit Risk Analyst", "credit-risk-analyst"],
      ["Credit Analyst - SME", "credit-risk-analyst"],
      ["Credit Underwriter", "credit-risk-analyst"],
      ["Corporate Credit Analyst", "credit-risk-analyst"],
      ["Credit Appraisal Officer", "credit-risk-analyst"],
      ["Credit Risk Modeller", null],
      ["Credit Risk Model Validation Analyst", null],
      ["Risk Analyst", null],
      ["AML/KYC Analyst", "aml-kyc-analyst"],
      ["KYC Analyst", "aml-kyc-analyst"],
      ["Transaction Monitoring Analyst", "aml-kyc-analyst"],
      ["Sanctions Screening Analyst", "aml-kyc-analyst"],
      ["Financial Crime Compliance Analyst", "aml-kyc-analyst"],
      ["AML Investigator", "aml-kyc-analyst"],
      ["AML Data Analyst", "data-analyst"],
      ["Fraud Analyst", "fraud-analyst"],
      ["HR Generalist", "hr-generalist"],
      ["HR Executive", "hr-generalist"],
      ["HR Operations Executive", "hr-generalist"],
      ["Plant HR Executive", "hr-generalist"],
      ["HR & Admin Executive", "hr-generalist"],
      ["People Operations Generalist", "hr-generalist"],
      ["HR Business Partner", "hr-business-partner"],
      ["HR Manager", null],
      ["HRIS Analyst", null],
      ["Talent Acquisition Specialist", "talent-acquisition-specialist"],
      ["Talent Acquisition Partner", "talent-acquisition-specialist"],
      ["Recruitment Executive", "talent-acquisition-specialist"],
      ["Corporate Recruiter", "talent-acquisition-specialist"],
      ["Non-IT Recruiter", "talent-acquisition-specialist"],
      ["Technical Recruiter", "talent-acquisition-specialist"],
      ["Talent Acquisition Manager", null],
      ["Head of Talent Acquisition", null],
      ["Supply Chain Analyst", "supply-chain-analyst"],
      ["Demand Planner", "supply-chain-analyst"],
      ["Inventory Control Analyst", "supply-chain-analyst"],
      ["Logistics Analyst", "supply-chain-analyst"],
      ["Supply Chain Data Analyst", "data-analyst"],
      ["Supply Chain Engineer", null],
      ["Procurement Manager", null],
      ["Customer Support Executive", "customer-support-executive"],
      ["Customer Service Executive", "customer-support-executive"],
      ["Customer Care Executive", "customer-support-executive"],
      ["Customer Service Representative", "customer-support-executive"],
      ["Contact Centre Associate", "customer-support-executive"],
      ["Phone Banking Officer", "customer-support-executive"],
      ["Chat Support Executive", "customer-support-executive"],
      ["Customer Service Desk Agent", "customer-support-executive"],
      ["Customer Support Associate", "technical-support-engineer"],
      ["Customer Support Engineer", "technical-support-engineer"],
      ["Customer Service Engineer", null],
      ["Customer Success Manager", "customer-success-manager"],
      // Business roles (batch B2): each read only from the titles built for it.
      ["Relationship Manager - Retail Banking", "relationship-manager-banking"],
      ["Relationship Manager - Banking", "relationship-manager-banking"],
      ["Priority Relationship Manager", "relationship-manager-banking"],
      ["Wealth Relationship Manager", "relationship-manager-banking"],
      ["Relationship Manager - HNI", "relationship-manager-banking"],
      ["Personal Banker", "relationship-manager-banking"],
      ["Relationship Manager", null],
      ["Relationship Manager - Corporate Banking", null],
      ["Relationship Manager - Insurance", null],
      ["Client Relationship Manager", null],
      ["Business Development Executive - Field Sales", "business-development-executive"],
      ["BDE - B2B Sales", "business-development-executive"],
      ["Business Development Officer", "business-development-executive"],
      ["Corporate Sales Executive", "business-development-executive"],
      ["Sales Executive - New Business", "business-development-executive"],
      ["Field Sales Executive", "business-development-executive"],
      ["Business Development Manager", null],
      ["Corporate Sales Manager", null],
      ["SEO Content Writer", "content-writer"],
      ["Web Content Writer", "content-writer"],
      ["Blog Writer", "content-writer"],
      ["Copy Editor - Digital Content", "content-writer"],
      ["Content Specialist - SEO", "content-writer"],
      ["Technical Content Writer", null],
      ["Medical Content Writer", null],
      ["Copywriter", null],
      ["Social Media Manager", "social-media-manager"],
      ["Social Media Lead", "social-media-manager"],
      ["Social Media Strategist", "social-media-manager"],
      ["Social Media Marketing Manager", "social-media-manager"],
      ["Community Manager - Social Media", "social-media-manager"],
      ["Influencer and Social Media Manager", "social-media-manager"],
      ["Social Media Executive", "digital-marketing-executive"],
      ["Community Manager", null],
      ["Head of Social Media", null],
      ["Tax Associate - Direct Tax", "tax-associate"],
      ["Indirect Tax Associate - GST", "tax-associate"],
      ["GST and TDS Compliance Executive", "tax-associate"],
      ["Taxation Executive", "tax-associate"],
      ["Associate - Business Tax", "tax-associate"],
      ["Tax Technology Analyst", null],
      ["Tax Consultant", null],
      ["Statutory Audit Associate", "audit-associate"],
      ["Assurance Associate", "audit-associate"],
      ["Internal Audit Executive", "audit-associate"],
      ["Audit Senior Assistant", "audit-associate"],
      ["Quality Auditor", null],
      ["Clinical Audit Associate", null],
      ["Collection Officer - Retail Loans", "collections-officer"],
      ["Tele Collections Executive", "collections-officer"],
      ["Recovery Officer - NBFC", "collections-officer"],
      ["Debt Manager - Recoveries", "collections-officer"],
      ["Collection Manager - Two Wheeler Loans", "collections-officer"],
      ["Sample Collection Executive", null],
      ["Data Collection Executive", null],
      ["Disaster Recovery Engineer", null],
      ["Treasury Executive", "treasury-analyst"],
      ["Corporate Treasury Analyst", "treasury-analyst"],
      ["Cash Management Analyst", "treasury-analyst"],
      ["Forex and Treasury Executive", "treasury-analyst"],
      ["Treasury Systems Analyst", null],
      ["HRBP", "hr-business-partner"],
      ["Senior HR Business Partner", "hr-business-partner"],
      ["People Partner", "hr-business-partner"],
      ["HR Business Partner - Plant", "hr-business-partner"],
      ["Talent Partner", null],
      ["Payroll Executive", "payroll-executive"],
      ["Payroll Specialist", "payroll-executive"],
      ["Payroll & Statutory Compliance Executive", "payroll-executive"],
      ["Executive - Payroll & Compliance", "payroll-executive"],
      ["SAP Payroll Consultant", "sap-hcm-consultant"],
      ["Workday Payroll Analyst", "workday-consultant"],
      ["Purchase Executive", "procurement-executive"],
      ["Procurement Specialist", "procurement-executive"],
      ["Sourcing Executive", "procurement-executive"],
      ["Vendor Development Executive", "procurement-executive"],
      ["Buyer - Indirect Procurement", "procurement-executive"],
      ["Talent Sourcing Executive", null],
      ["Purchase Manager", null],
      ["Logistics Executive", "logistics-coordinator"],
      ["Dispatch Executive", "logistics-coordinator"],
      ["Shipping Coordinator", "logistics-coordinator"],
      ["Transport Coordinator", "logistics-coordinator"],
      ["EXIM Logistics Coordinator", "logistics-coordinator"],
      ["Logistics Manager", null],
      // Business roles (batch B3): each read only from the titles built for it.
      ["Medical Representative", "medical-representative"],
      ["Medical Sales Representative", "medical-representative"],
      ["Pharmaceutical Sales Representative", "medical-representative"],
      ["Professional Service Representative", "medical-representative"],
      ["MR - Pharma Sales", "medical-representative"],
      ["Medical Device Sales Representative", null],
      ["Sales Representative", null],
      ["Channel Sales Manager - FMCG", "channel-sales-manager"],
      ["Channel Development Manager", "channel-sales-manager"],
      ["Dealer Network Manager", "channel-sales-manager"],
      ["Distributor Development Manager", "channel-sales-manager"],
      ["Channel Sales Manager - SaaS", null],
      ["Channel Partner Manager", null],
      ["Brand Manager", "brand-manager"],
      ["Assistant Brand Manager", "brand-manager"],
      ["Brand Marketing Manager", "brand-manager"],
      ["Group Brand Manager", "brand-manager"],
      ["Employer Brand Manager", null],
      ["Brand Designer", "graphic-designer"],
      ["Head of Brand", null],
      ["SEO Specialist", "seo-specialist"],
      ["SEO Analyst", "seo-specialist"],
      ["Technical SEO Specialist", "seo-specialist"],
      ["Search Engine Optimization Specialist", "seo-specialist"],
      ["SEO Manager", "seo-specialist"],
      ["SEO Lead", "seo-specialist"],
      ["SEO Executive", "digital-marketing-executive"],
      ["SEO Engineer", null],
      ["Equity Research Analyst", "equity-research-analyst"],
      ["Equity Research Associate", "equity-research-analyst"],
      ["Buy-Side Equity Analyst", "equity-research-analyst"],
      ["Research Analyst - Equities", "equity-research-analyst"],
      ["Sector Analyst - Equity Research", "equity-research-analyst"],
      ["Research Analyst", null],
      ["Quantitative Research Analyst", null],
      ["Principal Equity Analyst", null],
      ["Insurance Underwriter", "insurance-underwriter"],
      ["Health Insurance Underwriter", "insurance-underwriter"],
      ["Group Health Underwriter", "insurance-underwriter"],
      ["Commercial Lines Underwriter", "insurance-underwriter"],
      ["Medical Underwriter - Life Insurance", "insurance-underwriter"],
      ["Underwriting Executive - General Insurance", "insurance-underwriter"],
      ["Fire and Engineering Underwriter", "insurance-underwriter"],
      ["Mortgage Underwriter", null],
      ["Underwriter", null],
      ["Company Secretary Associate", "company-secretary-associate"],
      ["Assistant Company Secretary", "company-secretary-associate"],
      ["Company Secretarial Executive", "company-secretary-associate"],
      ["Secretarial Compliance Executive", "company-secretary-associate"],
      ["Associate - Corporate Secretarial", "company-secretary-associate"],
      ["Executive Secretary", null],
      ["Compensation and Benefits Analyst", "compensation-benefits-analyst"],
      ["C&B Analyst", "compensation-benefits-analyst"],
      ["Total Rewards Specialist", "compensation-benefits-analyst"],
      ["Benefits Analyst", "compensation-benefits-analyst"],
      ["Workday Compensation Analyst", "workday-consultant"],
      ["Compensation Consultant", null],
      ["Learning & Development Specialist", "learning-development-specialist"],
      ["L&D Specialist", "learning-development-specialist"],
      ["Training and Development Executive", "learning-development-specialist"],
      ["Senior Executive - Learning & Development", "learning-development-specialist"],
      ["Corporate Trainer - Learning & Development", "learning-development-specialist"],
      ["Machine Learning Specialist", null],
      ["Corporate Trainer", null],
      ["Learning Experience Designer", "learning-development-specialist"],
      ["Instructional Designer", "learning-development-specialist"],
      ["Senior Instructional Designer - L&D", "learning-development-specialist"],
      ["Experience Designer", "ui-ux-designer"],
      ["Warehouse Operations Executive", "warehouse-operations-executive"],
      ["Warehouse Supervisor", "warehouse-operations-executive"],
      ["Warehouse Shift Incharge", "warehouse-operations-executive"],
      ["Floor Lead - Warehouse Operations", "warehouse-operations-executive"],
      ["Logistics and Warehouse Executive", "logistics-coordinator"],
      ["Warehouse Manager", null],
      ["Warehouse Associate", null],
      ["Process Excellence Analyst", "process-excellence-analyst"],
      ["Lean Six Sigma Analyst", "process-excellence-analyst"],
      ["Continuous Improvement Analyst", "process-excellence-analyst"],
      ["Six Sigma Green Belt - Process Excellence", "process-excellence-analyst"],
      ["Lean Six Sigma Black Belt", "process-excellence-analyst"],
      ["Business Excellence Analyst", "process-excellence-analyst"],
      ["Process Improvement Engineer", null],
      ["Director - Process Excellence", null],
      ["Retail Store Manager", "retail-store-manager"],
      ["Store Manager", "retail-store-manager"],
      ["Assistant Store Manager", "retail-store-manager"],
      ["Retail Store Incharge", "retail-store-manager"],
      ["Showroom Manager", "retail-store-manager"],
      ["Store Operations Manager - Retail", "retail-store-manager"],
      ["Stores Manager", null],
      ["Dark Store Manager", null],
      // Business roles (batch B4): each read only from the titles built for it.
      ["Real Estate Sales Executive", "real-estate-sales-executive"],
      ["Sales Executive - Real Estate", "real-estate-sales-executive"],
      ["Real Estate Sales Manager", "real-estate-sales-executive"],
      ["Sales Manager - Residential Projects", "real-estate-sales-executive"],
      ["Closing Manager - Real Estate", "real-estate-sales-executive"],
      ["Pre-Sales Executive - Real Estate", "real-estate-sales-executive"],
      ["Property Sales Executive", "real-estate-sales-executive"],
      ["Real Estate Agent", null],
      ["Leasing Manager - Commercial Real Estate", null],
      ["Sales Executive", null],
      ["Home Loan Sales Officer", "home-loan-sales-officer"],
      ["Sales Officer - Home Loans", "home-loan-sales-officer"],
      ["Relationship Officer - Home Loans", "home-loan-sales-officer"],
      ["Mortgage Sales Officer", "home-loan-sales-officer"],
      ["Sales Officer - Loan Against Property", "home-loan-sales-officer"],
      ["Home Loan Counsellor", "home-loan-sales-officer"],
      ["Credit Manager - Home Loans", null],
      ["Personal Loan Sales Officer", null],
      ["Category Manager - E-commerce", "category-manager-ecommerce"],
      ["Category Manager - Quick Commerce", "category-manager-ecommerce"],
      ["Assistant Category Manager - E-commerce", "category-manager-ecommerce"],
      ["Category Lead - Marketplace", "category-manager-ecommerce"],
      ["Seller Category Manager", "category-manager-ecommerce"],
      ["Category Manager", null],
      ["Category Manager - FMCG", null],
      ["Category Manager - Procurement", null],
      ["Head of Category", null],
      ["Market Research Executive", "market-research-analyst"],
      ["Research Executive - Market Research", "market-research-analyst"],
      ["Senior Research Executive - Consumer Research", "market-research-analyst"],
      ["Quantitative Research Executive - Market Research", "market-research-analyst"],
      ["Data Analyst - Market Research", "data-analyst"],
      ["Intern - Market Research", null],
      ["Event Marketing Executive", "event-marketing-executive"],
      ["Events Executive", "event-marketing-executive"],
      ["Trade Show Coordinator", "event-marketing-executive"],
      ["Events & Field Marketing Executive", "event-marketing-executive"],
      ["Brand Activation Executive", "event-marketing-executive"],
      ["Dealer Events Executive", "event-marketing-executive"],
      ["Event Manager", null],
      ["Security Event Analyst", null],
      ["Investment Banking Analyst", "investment-banking-analyst"],
      ["Investment Banking Analyst - M&A", "investment-banking-analyst"],
      ["M&A Analyst", "investment-banking-analyst"],
      ["ECM Analyst", "investment-banking-analyst"],
      ["Analyst - Investment Banking (ECM/DCM)", "investment-banking-analyst"],
      ["Analyst - Mergers & Acquisitions", "investment-banking-analyst"],
      ["Analyst - Investment Banking Technology", null],
      ["Investment Analyst", null],
      ["Director - Investment Banking", null],
      ["Cost Accountant", "cost-accountant"],
      ["Costing Executive", "cost-accountant"],
      ["Plant Costing Analyst", "cost-accountant"],
      ["Cost Controller - Manufacturing", "cost-accountant"],
      ["Costing Manager - Plant", "cost-accountant"],
      ["Cloud Cost Analyst", "cloud-finops-analyst"],
      ["Cost Engineer", null],
      ["Industrial Relations Officer", "industrial-relations-officer"],
      ["IR Officer", "industrial-relations-officer"],
      ["Plant IR Executive", "industrial-relations-officer"],
      ["Labour Welfare Officer", "industrial-relations-officer"],
      ["Factory HR & IR Officer", "industrial-relations-officer"],
      ["HR Officer - Industrial Relations", "industrial-relations-officer"],
      ["Plant HR Executive", "hr-generalist"],
      ["Employee Relations Specialist", null],
      ["Investor Relations Officer", null],
      ["Admin & Facilities Executive", "admin-facilities-executive"],
      ["Executive - Administration", "admin-facilities-executive"],
      ["Office Administration Executive", "admin-facilities-executive"],
      ["Senior Executive - Admin and Facilities", "admin-facilities-executive"],
      ["Travel Desk and Admin Executive", "admin-facilities-executive"],
      ["HR & Admin Executive", "hr-generalist"],
      ["Facility Manager", null],
      ["Customer Service Team Leader", "customer-service-team-leader"],
      ["Team Leader - Voice Process", "customer-service-team-leader"],
      ["Team Lead - Customer Support", "customer-service-team-leader"],
      ["Contact Centre Team Leader", "customer-service-team-leader"],
      ["Team Leader - Inbound Voice Process", "customer-service-team-leader"],
      ["Team Leader - Technical Support", null],
      ["Team Lead - Software", null],
      ["Quality Control Inspector", "quality-control-inspector"],
      ["QC Inspector", "quality-control-inspector"],
      ["In-Process Quality Inspector", "quality-control-inspector"],
      ["IQC Inspector", "quality-control-inspector"],
      ["Quality Control Inspector - Machining", "quality-control-inspector"],
      ["Food Safety Inspector", null],
      ["Quality Engineer", "qa-automation-engineer"],
      ["Export-Import Executive", "export-import-executive"],
      ["EXIM Executive", "export-import-executive"],
      ["Import Export Executive", "export-import-executive"],
      ["Senior Executive - EXIM and DGFT", "export-import-executive"],
      ["DGFT and Customs Executive", "export-import-executive"],
      ["Foreign Trade Executive", "export-import-executive"],
      ["Export Executive", "logistics-coordinator"],
      ["Logistics and EXIM Executive", "logistics-coordinator"],
      // Fresher roles (batch F1): each read only from the titles built for it.
      ["Management Trainee", "management-trainee"],
      ["Management Trainee - Sales and Marketing", "management-trainee"],
      ["Graduate Management Trainee", "management-trainee"],
      ["Executive Trainee - Corporate Functions", "management-trainee"],
      ["Leadership Programme Trainee - FMCG", "management-trainee"],
      ["Management Trainee - Engineering", null],
      ["Management Intern", null],
      ["Back Office Executive", "back-office-executive"],
      ["Operations Associate - Back Office", "back-office-executive"],
      ["Banking Operations Executive", "back-office-executive"],
      ["Policy Issuance Executive", "back-office-executive"],
      ["Non-Voice Process Associate", "back-office-executive"],
      ["Voice Process Associate", null],
      ["Operations Executive", null],
      ["CA Article Assistant", "article-assistant-ca"],
      ["Articled Assistant", "article-assistant-ca"],
      ["CA Articleship Trainee", "article-assistant-ca"],
      ["Audit Article Assistant", "article-assistant-ca"],
      ["Article Writer", null],
      ["Probationary Officer", "bank-probationary-officer"],
      ["Bank PO", "bank-probationary-officer"],
      ["Assistant Manager - Probationary Officer", "bank-probationary-officer"],
      ["Management Trainee - Public Sector Bank", "bank-probationary-officer"],
      ["Scale I Officer - Branch Banking", "bank-probationary-officer"],
      ["Assistant Manager - Young Bankers Programme", "bank-probationary-officer"],
      ["PO Coordinator", null],
      ["Sales Officer - FMCG", "fmcg-sales-officer"],
      ["Territory Sales Officer - General Trade", "fmcg-sales-officer"],
      ["Field Sales Officer - Consumer Goods", "fmcg-sales-officer"],
      ["Sales Trainee - FMCG", "fmcg-sales-officer"],
      ["Territory Sales Officer", "area-sales-manager"],
      ["Field Sales Officer", "business-development-executive"],
      ["Sales Officer", null],
      ["Pharma Sales Officer", "medical-representative"],
      // Core engineering roles (batch F1). A plain "Production Engineer" stays site reliability; one whose title names a
      // plant, a line or a shop-floor process reads as the manufacturing production engineer.
      ["Production Engineer - Manufacturing", "production-engineer"],
      ["Production Engineer - Machining", "production-engineer"],
      ["Production Engineer - Assembly", "production-engineer"],
      ["Junior Production Engineer", "production-engineer"],
      ["Shift Engineer - Production", "production-engineer"],
      ["Assistant Engineer - Production", "production-engineer"],
      ["Production Shift Incharge", "production-engineer"],
      ["Mechanical Production Engineer", "production-engineer"],
      ["Production Engineer", "site-reliability-engineer"],
      ["Senior Production Engineer", "site-reliability-engineer"],
      ["Production Engineer, Infrastructure", "site-reliability-engineer"],
      ["Software Engineer - Production Support", "software-engineer"],
      ["Plant Maintenance Engineer", "maintenance-engineer"],
      ["Maintenance Engineer", "maintenance-engineer"],
      ["Mechanical Maintenance Engineer", "maintenance-engineer"],
      ["Electrical Maintenance Engineer", "maintenance-engineer"],
      ["Junior Engineer - Maintenance", "maintenance-engineer"],
      ["Front Line Engineer - Mechanical Maintenance", "maintenance-engineer"],
      ["Application Maintenance Engineer", null],
      ["Aircraft Maintenance Engineer", null],
      ["GET Mechanical", "graduate-engineer-trainee-mechanical"],
      ["Graduate Engineer Trainee - Mechanical", "graduate-engineer-trainee-mechanical"],
      ["Engineer Trainee - Mechanical", "graduate-engineer-trainee-mechanical"],
      ["Engineering Executive Trainee - Mechanical", "graduate-engineer-trainee-mechanical"],
      ["Graduate Apprentice Trainee - Mechanical", "graduate-engineer-trainee-mechanical"],
      ["Mechanical Engineer Trainee - Manufacturing", "graduate-engineer-trainee-mechanical"],
      ["GET Electrical", "graduate-engineer-trainee-electrical"],
      ["Trainee Engineer - Electrical", "graduate-engineer-trainee-electrical"],
      ["Graduate Trainee Engineer - Power Distribution", "graduate-engineer-trainee-electrical"],
      ["Junior Electrical Engineer - Substation", "graduate-engineer-trainee-electrical"],
      ["Electrical Engineer Trainee - EPC", "graduate-engineer-trainee-electrical"],
      ["Graduate Engineer Trainee - Electronics", null],
      ["Electrical Engineer", null],
      ["Mechanical Design Engineer", "mechanical-design-engineer"],
      ["Junior Design Engineer - Mechanical", "mechanical-design-engineer"],
      ["CAD Design Engineer - Mechanical", "mechanical-design-engineer"],
      ["SolidWorks Design Engineer", "mechanical-design-engineer"],
      ["Creo Design Engineer", "mechanical-design-engineer"],
      ["Graduate Engineer Trainee - Mechanical Design", "mechanical-design-engineer"],
      ["Design Engineer", null],
      ["Civil Site Engineer", "site-engineer-civil"],
      ["Junior Site Engineer - Civil", "site-engineer-civil"],
      ["Graduate Engineer Trainee - Civil", "site-engineer-civil"],
      ["Site Execution Engineer - Civil", "site-engineer-civil"],
      ["Trainee Site Engineer", "site-engineer-civil"],
      ["Junior Engineer - Civil Execution", "site-engineer-civil"],
      ["Telecom Site Engineer", null],
      ["Civil Engineer", null],
      ["Billing Engineer", "billing-quantity-engineer-civil"],
      ["Quantity Surveyor - Civil", "billing-quantity-engineer-civil"],
      ["QS Engineer - Civil", "billing-quantity-engineer-civil"],
      ["Junior Quantity Surveyor", "billing-quantity-engineer-civil"],
      ["Billing and QS Engineer", "billing-quantity-engineer-civil"],
      ["Site Billing Engineer - Civil", "billing-quantity-engineer-civil"],
      ["Estimation and Billing Engineer - Civil", "billing-quantity-engineer-civil"],
      ["Software Engineer - Billing", "software-engineer"],
      ["Telecom Billing Engineer", null],
      // Tech gap batch TG1: chip verification titles move from the chip design rule to design verification, and each new
      // role reads its own titles.
      ["Physical Design Engineer", "physical-design-engineer"],
      ["PD Engineer", "physical-design-engineer"],
      ["STA Engineer", "physical-design-engineer"],
      ["Place and Route Engineer", "physical-design-engineer"],
      ["Physical Verification Engineer", "physical-design-engineer"],
      ["Timing Signoff Engineer", "physical-design-engineer"],
      ["PCB Physical Design Engineer", null],
      ["DV Engineer", "design-verification-engineer"],
      ["ASIC Verification Engineer", "design-verification-engineer"],
      ["Verification Engineer", "design-verification-engineer"],
      ["SoC Verification Engineer", "design-verification-engineer"],
      ["UVM Verification Engineer", "design-verification-engineer"],
      ["Pre-Silicon Verification Engineer", "design-verification-engineer"],
      ["Verification Engineer - ASIC", "design-verification-engineer"],
      ["RTL Design and Verification Engineer", "vlsi-design-engineer"],
      ["FPGA Verification Engineer", "fpga-engineer"],
      ["Functional Safety Engineer", "functional-safety-engineer"],
      ["FuSa Engineer", "functional-safety-engineer"],
      ["ISO 26262 Safety Engineer", "functional-safety-engineer"],
      ["Software Functional Safety Engineer", "functional-safety-engineer"],
      ["Safety Engineer - Automotive Electronics", "functional-safety-engineer"],
      ["Safety Engineer", null],
      ["Infotainment Engineer", "infotainment-engineer"],
      ["IVI Software Engineer", "infotainment-engineer"],
      ["Android Automotive Developer", "infotainment-engineer"],
      ["AAOS Engineer", "infotainment-engineer"],
      ["Qt QML Developer - Automotive HMI", "infotainment-engineer"],
      ["Guidewire Developer", "guidewire-developer"],
      ["Guidewire PolicyCenter Developer", "guidewire-developer"],
      ["Guidewire Integration Developer", "guidewire-developer"],
      ["Guidewire Business Analyst", "business-analyst"],
      ["Finacle Consultant", "core-banking-consultant"],
      ["Temenos T24 Functional Consultant", "core-banking-consultant"],
      ["Oracle FLEXCUBE Technical Consultant", "core-banking-consultant"],
      ["Core Banking Business Analyst", "core-banking-consultant"],
      ["CBS Functional Consultant", "core-banking-consultant"],
      ["Finacle Tester", null],
      ["SAP Fiori Developer", "sap-fiori-ui5-developer"],
      ["SAP UI5 Developer", "sap-fiori-ui5-developer"],
      ["SAPUI5 Developer", "sap-fiori-ui5-developer"],
      ["SAP ABAP Fiori Developer", "sap-abap-developer"],
      ["SAP CPI Developer", "sap-btp-integration-developer"],
      ["SAP BTP Integration Consultant", "sap-btp-integration-developer"],
      ["SAP Integration Suite Developer", "sap-btp-integration-developer"],
      ["SAP PI/PO Developer", null],
      ["Clinical SAS Programmer", "clinical-sas-programmer"],
      ["Statistical Programmer", "clinical-sas-programmer"],
      ["SDTM Programmer", "clinical-sas-programmer"],
      ["ADaM Programmer", "clinical-sas-programmer"],
      ["Statistical Programming Analyst", "clinical-sas-programmer"],
      ["SAS Programmer", null],
      ["WebLogic Administrator", "middleware-administrator"],
      ["WebSphere Administrator", "middleware-administrator"],
      ["JBoss Administrator", "middleware-administrator"],
      ["Middleware Administrator", "middleware-administrator"],
      ["Middleware Engineer", "middleware-administrator"],
      ["Middleware Developer", "integration-developer"],
      ["Service Delivery Manager", "it-service-delivery-manager"],
      ["Service Delivery Manager - AMS", "it-service-delivery-manager"],
      ["Major Incident Manager", "it-service-delivery-manager"],
      ["Service Level Manager", "it-service-delivery-manager"],
      ["Logistics Service Delivery Manager", null],
      ["Change Manager", null],
      ["Data Annotator", "data-annotation-specialist"],
      ["Annotation Analyst", "data-annotation-specialist"],
      ["AI Training Data Analyst", "data-annotation-specialist"],
      ["Data Labelling Associate", "data-annotation-specialist"],
      ["Genome Annotation Scientist", null],
      // Title gaps (Data research, 2026-10-31): seven wrong matches and unmatched titles a live role fits. Principal, staff,
      // director, head-of and intern titles stay dropped by the senior filter.
      ["Oracle APEX Developer", "database-developer"],
      ["APEX Developer", "salesforce-developer"],
      ["Embedded Software Architect", "embedded-software-engineer"],
      ["Embedded Linux Engineer", "embedded-software-engineer"],
      ["Linux Engineer", "system-administrator"],
      ["Mobile Test Engineer", "qa-automation-engineer"],
      ["Mobile Developer", "cross-platform-mobile-developer"],
      ["SAP Analytics Cloud Consultant", "sap-bw-consultant"],
      ["SAP GRC Consultant", "sap-security-grc-consultant"],
      ["GRC Consultant", "information-security-analyst"],
      ["Angular Developer", "frontend-developer"],
      ["Vue.js Developer", "frontend-developer"],
      ["Hadoop Developer", "data-engineer"],
      ["Spark Developer", "data-engineer"],
      ["Snowflake Developer", "data-engineer"],
      ["Scala Developer", "data-engineer"],
      ["Terraform Engineer", "devops-engineer"],
      ["Ansible Engineer", "devops-engineer"],
      ["Kubernetes Administrator", "devops-engineer"],
      ["OpenShift Administrator", "devops-engineer"],
      ["API Developer", "software-engineer"],
      ["Microservices Developer", "software-engineer"],
      ["Java Microservices Developer", "java-backend-developer"],
      ["Member Technical Staff", "software-engineer"],
      ["Senior Member Technical Staff", "software-engineer"],
      ["Principal Member Technical Staff", null],
      ["Sr. Staff Software Engineer", null],
      ["Software Engineer Intern", null],
      ["MongoDB Developer", "database-developer"],
      ["Drupal Developer", "php-developer"],
      ["AS400 Developer", "mainframe-developer"],
      ["Mainframe Tester", "manual-test-engineer"],
      ["Game Tester", "manual-test-engineer"],
      ["Localization Tester", "manual-test-engineer"],
      ["Test Manager", "qa-manager"],
      ["Test Architect", "qa-lead"],
      ["Test Automation Architect", "qa-lead"],
      ["QA Manager", "qa-manager"],
      ["Automation Architect", null],
      ["Data Warehouse Tester", "data-quality-engineer"],
      ["Monitoring Engineer", "site-reliability-engineer"],
      ["Chaos Engineer", "site-reliability-engineer"],
      ["Condition Monitoring Engineer", null],
      ["AIOps Engineer", null],
      ["Java Architect", "solutions-architect"],
      [".NET Architect", "solutions-architect"],
      ["System Architect", null],
      ["Network Architect", "network-engineer"],
      ["Microsoft Dynamics CRM Consultant", "dynamics-365-developer"],
      ["Dynamics 365 Finance and Operations Consultant", null],
      ["Salesforce CPQ Consultant", "salesforce-developer"],
      ["Veeva CRM Developer", "salesforce-developer"],
      ["Camunda Developer", "low-code-developer"],
      ["Workato Developer", "low-code-developer"],
      ["MIS Executive", "data-analyst"],
      ["Growth Analyst", "data-analyst"],
      ["Marketing Analyst", "data-analyst"],
      ["Web Analyst", "data-analyst"],
      ["E-commerce Analyst", "data-analyst"],
      ["Data Specialist", null],
      ["Identity Architect", "security-architect"],
      ["Security Consultant", "cyber-security-analyst"],
      ["Physical Security Consultant", null],
      ["SAP Security Consultant", "sap-security-grc-consultant"],
      ["Compliance Analyst (IT)", "information-security-analyst"],
      ["ISO 27001 Lead Auditor", "information-security-analyst"],
      ["Data Privacy Officer", "privacy-analyst"],
      ["Exploit Developer", "penetration-tester"],
      ["Bug Bounty Hunter", "penetration-tester"],
      ["RF Engineer", "telecom-ran-engineer"],
      ["RF Design Engineer", null],
      ["Wireless Engineer", null],
      ["Telecom Engineer", null],
      ["Instrumentation Engineer", "plc-scada-engineer"],
      ["Instrumentation Maintenance Engineer", null],
      ["BMS Engineer", null],
      ["Computer Vision Scientist", "computer-vision-engineer"],
      ["Computer Vision Research Scientist", "ai-research-scientist"],
      ["Speech Recognition Engineer", "nlp-engineer"],
      ["Quantitative Researcher", null],
      ["Delivery Manager", "delivery-manager"],
      ["Delivery Manager - Logistics", null],
      ["PMO Analyst", "it-project-manager"],
      ["Project Coordinator", null],
      ["Release Train Engineer", "scrum-master"],
      ["Implementation Engineer", "implementation-consultant"],
      ["Physical Design Implementation Engineer", "physical-design-engineer"],
      ["Implementation Engineer - Solar", null],
      ["Onboarding Specialist", null],
      ["Deployment Engineer", null],
      ["Field Application Engineer", "presales-engineer"],
      ["Application Engineer", null],
      ["Developer Community Manager", null],
      // Senior batch TJ: test and QA managers move from the test lead rule, "Delivery Manager" from the IT project rule,
      // ML, data and platform engineering managers from the engineering manager rule, DevOps and SRE managers and IT
      // program titles get a rule, and "GenAI Lead" reads as the ML engineering manager. Senior filter titles stay dropped.
      ["ML Engineering Manager", "ml-engineering-manager"],
      ["AI/ML Engineering Manager", "ml-engineering-manager"],
      ["GenAI Engineering Manager", "ml-engineering-manager"],
      ["GenAI Lead", "ml-engineering-manager"],
      ["Generative AI Lead", "ml-engineering-manager"],
      ["Applied Science Manager", "ml-engineering-manager"],
      ["Manager - Machine Learning", "ml-engineering-manager"],
      ["Engineering Manager - ML", "ml-engineering-manager"],
      ["Product Manager - Generative AI", "ai-product-manager"],
      ["Data Science Manager", "senior-data-scientist"],
      ["Staff ML Engineering Manager", null],
      ["Data Engineering Manager", "data-engineering-manager"],
      ["Data Platform Manager", "data-engineering-manager"],
      ["Engineering Manager - Data Platform", "data-engineering-manager"],
      ["Data Engineering Team Lead", "data-engineering-manager"],
      ["Head of Data Engineering", null],
      ["Platform Engineering Manager", "platform-engineering-manager"],
      ["DevOps Manager", "platform-engineering-manager"],
      ["SRE Manager", "platform-engineering-manager"],
      ["Cloud Infrastructure Manager", "platform-engineering-manager"],
      ["Engineering Manager - SRE", "platform-engineering-manager"],
      ["Infrastructure Manager", null],
      ["Platform Manager", null],
      ["Senior Delivery Manager", "delivery-manager"],
      ["Account Delivery Manager", "delivery-manager"],
      ["Project Delivery Manager - Civil", null],
      ["Director, Delivery", null],
      ["IT Program Manager", "it-program-manager"],
      ["Transformation Program Manager", "it-program-manager"],
      ["Program Manager - Digital Transformation", "it-program-manager"],
      ["IT Portfolio Manager", "it-program-manager"],
      ["Portfolio Manager", null],
      ["Program Manager - Construction", null],
      ["Principal Program Manager", null],
      ["Testing Manager", "qa-manager"],
      ["Quality Engineering Manager", "qa-manager"],
      ["Senior Test Manager", "qa-manager"],
      ["QA Manager - Pharma", null],
      ["Quality Assurance Manager", null],
      ["Hardware Test Manager", null],
      ["Head of QA", null],
      // Batch B5: legal, healthcare administration and hospitality titles, read only after every other rule. Legal titles
      // read only as the three legal rules; "Compliance Testing Analyst" is a compliance title, not a tester. A litigation
      // counsel or associate, a construction contract administrator, a plain "Front Office Executive", "Receptionist",
      // "Revenue Manager", "AR Executive", "Claims Executive" or "Admissions Executive", and an "Executive Housekeeper"
      // have none. Senior filter titles (head of, director, chief, intern) stay dropped.
      ["Associate Legal Counsel", "corporate-legal-associate"],
      ["Associate Corporate Counsel", "corporate-legal-associate"],
      ["Legal Counsel - Commercial Contracts", "corporate-legal-associate"],
      ["Legal Associate - Corporate and Commercial", "corporate-legal-associate"],
      ["Associate - General Corporate Practice", "corporate-legal-associate"],
      ["In-house Legal Associate", "corporate-legal-associate"],
      ["Corporate Legal Counsel", "corporate-legal-associate"],
      ["Contract Management Analyst", "contract-management-specialist"],
      ["Contracts Specialist - CLM", "contract-management-specialist"],
      ["Contract Administrator", "contract-management-specialist"],
      ["Senior Analyst - Contracting", "contract-management-specialist"],
      ["Contract Lifecycle Management Analyst", "contract-management-specialist"],
      ["Legal Contracts Analyst", "contract-management-specialist"],
      ["Analyst - Vendor Contracts", "contract-management-specialist"],
      ["Compliance Officer - NBFC", "regulatory-compliance-officer"],
      ["Regulatory Compliance Manager", "regulatory-compliance-officer"],
      ["Regulatory Compliance Specialist", "regulatory-compliance-officer"],
      ["Compliance Testing Analyst", "regulatory-compliance-officer"],
      ["Deputy Manager - Compliance", "regulatory-compliance-officer"],
      ["Compliance Executive - RBI", "regulatory-compliance-officer"],
      ["Compliance Analyst - Securities Broking", "regulatory-compliance-officer"],
      ["Paralegal - Litigation", "litigation-paralegal"],
      ["Legal Executive - Litigation", "litigation-paralegal"],
      ["Litigation Assistant", "litigation-paralegal"],
      ["Legal Assistant - Court Matters", "litigation-paralegal"],
      ["Court Clerk - Law Firm", "litigation-paralegal"],
      ["Litigation Executive", "litigation-paralegal"],
      ["Junior Legal Officer - Litigation", "litigation-paralegal"],
      ["Medical Coding Analyst", "medical-coder"],
      ["Senior Medical Coder", "medical-coder"],
      ["Certified Medical Coder", "medical-coder"],
      ["E/M Coder", "medical-coder"],
      ["IP DRG Coder", "medical-coder"],
      ["HCC Coder", "medical-coder"],
      ["Surgery Coder - Profee", "medical-coder"],
      ["ED Profee Coder", "medical-coder"],
      ["AR Caller - US Healthcare", "medical-billing-specialist"],
      ["AR Associate - RCM", "medical-billing-specialist"],
      ["Denial Management Executive", "medical-billing-specialist"],
      ["Payment Posting Executive", "medical-billing-specialist"],
      ["Charge Entry Executive", "medical-billing-specialist"],
      ["Medical Billing Executive", "medical-billing-specialist"],
      ["Senior AR Executive - Medical Billing", "medical-billing-specialist"],
      ["RCM Executive - US Healthcare", "medical-billing-specialist"],
      ["Executive - Hospital Operations", "hospital-operations-executive"],
      ["Front Office Executive - Hospital", "hospital-operations-executive"],
      ["OPD Executive", "hospital-operations-executive"],
      ["Patient Care Coordinator", "hospital-operations-executive"],
      ["Admission Desk Executive", "hospital-operations-executive"],
      ["Patient Services Executive - Hospital", "hospital-operations-executive"],
      ["Floor Coordinator - Hospital", "hospital-operations-executive"],
      ["Bed Manager - Hospital", "hospital-operations-executive"],
      ["Claims Executive - Health Insurance", "health-insurance-claims-executive"],
      ["Medical Officer - Health Claims", "health-insurance-claims-executive"],
      ["Cashless Claims Executive", "health-insurance-claims-executive"],
      ["Pre-Authorisation Executive - TPA", "health-insurance-claims-executive"],
      ["Reimbursement Claims Executive", "health-insurance-claims-executive"],
      ["TPA Claims Executive", "health-insurance-claims-executive"],
      ["Claims Processing Executive - Health Insurance", "health-insurance-claims-executive"],
      ["Health Claims Adjudicator", "health-insurance-claims-executive"],
      ["Front Office Associate", "front-office-executive-hotel"],
      ["Guest Service Associate - Front Office", "front-office-executive-hotel"],
      ["Guest Service Officer - Front Office", "front-office-executive-hotel"],
      ["Front Desk Agent - Hotel", "front-office-executive-hotel"],
      ["Front Office Assistant - Hotel", "front-office-executive-hotel"],
      ["Hotel Receptionist", "front-office-executive-hotel"],
      ["Night Auditor - Hotel", "front-office-executive-hotel"],
      ["F&B Supervisor", "food-beverage-executive"],
      ["Food and Beverage Supervisor", "food-beverage-executive"],
      ["Restaurant Supervisor - Hotel", "food-beverage-executive"],
      ["Banquet Supervisor", "food-beverage-executive"],
      ["F&B Service Executive", "food-beverage-executive"],
      ["Captain - F&B Service", "food-beverage-executive"],
      ["Assistant Restaurant Manager - Hotel", "food-beverage-executive"],
      ["Revenue Manager - Hotel", "hotel-revenue-manager"],
      ["Assistant Revenue Manager - Hotel", "hotel-revenue-manager"],
      ["Cluster Revenue Manager - Hotels", "hotel-revenue-manager"],
      ["Revenue Management Executive - Hotel", "hotel-revenue-manager"],
      ["Hotel Revenue Analyst", "hotel-revenue-manager"],
      ["Distribution and Revenue Manager - Hotels", "hotel-revenue-manager"],
      ["Housekeeping Executive - Hotel", "housekeeping-supervisor"],
      ["Floor Supervisor - Housekeeping", "housekeeping-supervisor"],
      ["Housekeeping Team Leader", "housekeeping-supervisor"],
      ["Public Area Supervisor", "housekeeping-supervisor"],
      ["Linen Room Supervisor", "housekeeping-supervisor"],
      ["Deputy Housekeeper", "housekeeping-supervisor"],
      ["Assistant Housekeeper - Hotel", "housekeeping-supervisor"],
      ["Legal Counsel", "corporate-legal-associate"],
      ["Senior Legal Counsel", "corporate-legal-associate"],
      ["General Counsel", null],
      ["Director - Legal", null],
      ["Head of Legal", null],
      ["Legal Intern", null],
      ["Litigation Counsel", null],
      ["Litigation Associate", null],
      ["Patent Counsel", null],
      ["Legal Manager", null],
      ["Sales Counsel", null],
      ["Contracts Analyst", "contract-management-specialist"],
      ["Contract Specialist", "contract-management-specialist"],
      ["Contract Administrator - Construction", null],
      ["Contracts Engineer", null],
      ["Contract Recruiter", null],
      ["Contract Manager", null],
      ["Compliance Officer", "regulatory-compliance-officer"],
      ["Compliance Manager", "regulatory-compliance-officer"],
      ["AML Compliance Officer", "aml-kyc-analyst"],
      ["Head of Compliance", null],
      ["Chief Compliance Officer", null],
      ["EHS Compliance Officer", null],
      ["Trade Compliance Analyst", null],
      ["Compliance Director", null],
      ["Paralegal", "litigation-paralegal"],
      ["Legal Assistant", "litigation-paralegal"],
      ["Legal Executive", null],
      ["Claims Litigation Executive", null],
      ["Medical Coder", "medical-coder"],
      ["Radiology Coder", "medical-coder"],
      ["Medical Coding Trainee", "medical-coder"],
      ["Python Coder", null],
      ["Coder", null],
      ["Medical Coding Intern", null],
      ["Data Coder", null],
      ["AR Caller", "medical-billing-specialist"],
      ["Prior Authorization Executive", "medical-billing-specialist"],
      ["Eligibility Verification Executive", "medical-billing-specialist"],
      ["AR Executive", null],
      ["AR Associate", null],
      ["Accounts Receivable Executive", "accounts-executive"],
      ["Billing Executive", null],
      ["Hospital Billing Manager", null],
      ["OPD Coordinator", "hospital-operations-executive"],
      ["Patient Relations Executive - Hospital", "hospital-operations-executive"],
      ["IPD Billing Executive", "hospital-operations-executive"],
      ["Guest Relations Executive - Hospital", "hospital-operations-executive"],
      ["Admissions Executive", null],
      ["Admission Counsellor", null],
      ["Floor Coordinator", null],
      ["Floor Manager", null],
      ["Hospital Administrator", null],
      ["Head of Hospital Operations", null],
      ["Staff Nurse", null],
      ["Claims Executive - TPA", "health-insurance-claims-executive"],
      ["Health Claims Executive", "health-insurance-claims-executive"],
      ["Medical Officer - Cashless", "health-insurance-claims-executive"],
      ["TPA Executive", "health-insurance-claims-executive"],
      ["Motor Claims Executive", null],
      ["Claims Executive - US Healthcare", null],
      ["Life Claims Officer", null],
      ["Claims Executive", null],
      ["Medical Officer", null],
      ["Guest Relations Executive", "front-office-executive-hotel"],
      ["Night Auditor", "front-office-executive-hotel"],
      ["Front Desk Associate", "front-office-executive-hotel"],
      ["Front Office Executive - Resort", "front-office-executive-hotel"],
      ["Front Office Executive", null],
      ["Front Office Assistant", null],
      ["Receptionist", null],
      ["Front Desk Executive", null],
      ["Front Office Manager", null],
      ["Guest Service Agent - Airport", null],
      ["Corporate Front Office Executive", null],
      ["F&B Executive", "food-beverage-executive"],
      ["Restaurant Captain", "food-beverage-executive"],
      ["Bar Supervisor", "food-beverage-executive"],
      ["Banquet Captain", "food-beverage-executive"],
      ["F&B Manager", null],
      ["Restaurant Manager", null],
      ["Food Production Supervisor", null],
      ["Food Safety Officer", null],
      ["Food Technologist", null],
      ["F&B Controller", null],
      ["Delivery Supervisor", null],
      ["Banquet Sales Executive", null],
      ["Food and Beverage Director", null],
      ["Bar Manager", null],
      ["Revenue Analyst - Hotels", "hotel-revenue-manager"],
      ["Rooms Revenue Manager", "hotel-revenue-manager"],
      ["Revenue Manager", null],
      ["Revenue Analyst", null],
      ["Revenue Manager - Airline", null],
      ["Revenue Accountant", null],
      ["Director of Revenue - Hotels", null],
      ["Head of Revenue Management - Hotels", null],
      ["Housekeeping Supervisor", "housekeeping-supervisor"],
      ["Laundry Supervisor", "housekeeping-supervisor"],
      ["Housekeeping Supervisor - Hospital", "housekeeping-supervisor"],
      ["Executive Housekeeper", null],
      ["Floor Supervisor", null],
      ["Housekeeping Manager", null],
      ["Housekeeping Intern", null],
      ["Housekeeper", null],
      ["Head of Housekeeping", null],
      // Tech batch TG2. Chip DFT, analog layout, battery management and MES titles read before the chip, embedded, QA and
      // software rules ("Design for Test Engineer" was QA automation, "BMS Software Engineer" and "MES Software Engineer"
      // were software engineer, "BMS Firmware Engineer" embedded); SAP security and GRC before the security rules ("SAP
      // Security Analyst" was cyber security); Oracle HCM functional titles before the Oracle Fusion technical and business
      // analyst rules. Fraud, trust and safety, graphic design and IT asset titles come after every other rule. A plain
      // "BMS Engineer" (above) or a building management one, a plain "Layout Engineer", "SAP WM Consultant", "Risk
      // Analyst", "Dispute Analyst" or "Content Analyst", a motion graphics designer and an "Asset Management Analyst"
      // have none. Senior filter titles stay dropped.
      ["DFT Engineer", "dft-engineer"],
      ["Design for Test Engineer", "dft-engineer"],
      ["Design for Testability Engineer", "dft-engineer"],
      ["MBIST Engineer", "dft-engineer"],
      ["ASIC DFT Engineer", "dft-engineer"],
      ["SoC DFT Engineer", "dft-engineer"],
      ["DFT ATPG Engineer", "dft-engineer"],
      ["Senior DFT Engineer", "dft-engineer"],
      ["DFT Lead", "dft-engineer"],
      ["Principal DFT Engineer", null],
      ["DFT Intern", null],
      ["PCB DFT Engineer", null],
      ["Analog Layout Engineer", "analog-layout-engineer"],
      ["Custom Layout Engineer", "analog-layout-engineer"],
      ["Analog Layout Design Engineer", "analog-layout-engineer"],
      ["Mixed-Signal Layout Engineer", "analog-layout-engineer"],
      ["AMS Layout Engineer", "analog-layout-engineer"],
      ["Analog IC Layout Engineer", "analog-layout-engineer"],
      ["IC Layout Engineer", "analog-layout-engineer"],
      ["Mask Design Engineer", "analog-layout-engineer"],
      ["Layout Engineer", null],
      ["PCB Layout Engineer", null],
      ["Battery Management System Engineer", "bms-engineer"],
      ["BMS Software Engineer", "bms-engineer"],
      ["BMS Firmware Engineer", "bms-engineer"],
      ["BMS Algorithm Engineer", "bms-engineer"],
      ["Battery Controls Engineer", "bms-engineer"],
      ["BMS Engineer - EV", "bms-engineer"],
      ["BMS Engineer - Facility", null],
      ["Building Management System Engineer", null],
      ["BMS Technician", null],
      ["BMS Hardware Engineer", null],
      ["Battery Engineer", null],
      ["MES Engineer", "mes-engineer"],
      ["MES Consultant", "mes-engineer"],
      ["MES Developer", "mes-engineer"],
      ["Siemens Opcenter Developer", "mes-engineer"],
      ["Camstar MES Developer", "mes-engineer"],
      ["Manufacturing Execution Systems Engineer", "mes-engineer"],
      ["MES Software Engineer", "mes-engineer"],
      ["MES Support Engineer", "mes-engineer"],
      ["MES Manager", null],
      ["MES Test Engineer", "qa-automation-engineer"],
      ["SAP EWM Consultant", "sap-ewm-consultant"],
      ["SAP EWM Functional Consultant", "sap-ewm-consultant"],
      ["SAP Extended Warehouse Management Consultant", "sap-ewm-consultant"],
      ["SAP EWM-MFS Consultant", "sap-ewm-consultant"],
      ["SAP S/4HANA EWM Consultant", "sap-ewm-consultant"],
      ["SAP WM/EWM Consultant", "sap-ewm-consultant"],
      ["SAP EWM Lead", "sap-ewm-consultant"],
      ["SAP WM Consultant", null],
      ["SAP EWM Developer", null],
      ["SAP EWM Architect", null],
      ["SAP HCM Consultant", "sap-hcm-consultant"],
      ["SAP HR Consultant", "sap-hcm-consultant"],
      ["SAP HCM Payroll Consultant", "sap-hcm-consultant"],
      ["SAP India Payroll Consultant", "sap-hcm-consultant"],
      ["SAP HCM Time Management Consultant", "sap-hcm-consultant"],
      ["SAP H4S4 Consultant", "sap-hcm-consultant"],
      ["SAP S/4HANA HCM Consultant", "sap-hcm-consultant"],
      ["SAP HR Analyst", "sap-hcm-consultant"],
      ["HR Analyst - SAP", null],
      ["SAP HCM ABAP Developer", "sap-abap-developer"],
      ["SAP HR Recruiter", null],
      ["SAP GRC Access Control Consultant", "sap-security-grc-consultant"],
      ["SAP Security and Authorization Consultant", "sap-security-grc-consultant"],
      ["SAP S/4HANA Security Consultant", "sap-security-grc-consultant"],
      ["SAP Security Analyst", "sap-security-grc-consultant"],
      ["SAP GRC Lead", "sap-security-grc-consultant"],
      ["SAP Security Architect", "security-architect"],
      ["SAP Security Manager", null],
      ["Oracle HCM Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle HCM Functional Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle Fusion HCM Functional Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle Cloud HCM Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle HCM Payroll Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle Absence Management Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle Core HR Consultant", "oracle-hcm-cloud-consultant"],
      ["Oracle HCM Technical Consultant", null],
      ["Oracle HRMS Functional Consultant", "business-analyst"],
      ["Fraud Risk Analyst", "fraud-analyst"],
      ["Fraud Prevention Analyst", "fraud-analyst"],
      ["Fraud Operations Analyst", "fraud-analyst"],
      ["Chargeback Analyst", "fraud-analyst"],
      ["Payment Risk Analyst", "fraud-analyst"],
      ["Fraud Investigator", "fraud-analyst"],
      ["Risk Investigator", "fraud-analyst"],
      ["Dispute Analyst", null],
      ["Fraud Data Scientist", "data-scientist"],
      ["Fraud Engineer", null],
      ["Insurance Fraud Investigator", null],
      ["Fraud and AML Analyst", "aml-kyc-analyst"],
      ["Fraud Risk Manager", null],
      ["Senior Graphic Designer", "graphic-designer"],
      ["Communication Designer", "graphic-designer"],
      ["Creative Designer", "graphic-designer"],
      ["Visual Communication Designer", "graphic-designer"],
      ["Marketing Graphic Designer", "graphic-designer"],
      ["DTP Designer", "graphic-designer"],
      ["Social Media Designer", "graphic-designer"],
      ["Visual Designer", "ui-ux-designer"],
      ["UI Designer", "ui-ux-designer"],
      ["Motion Graphics Designer", null],
      ["Packaging Designer", null],
      ["Graphic Design Intern", null],
      ["Creative Director", null],
      ["Content Moderator", "trust-and-safety-analyst"],
      ["Trust and Safety Analyst", "trust-and-safety-analyst"],
      ["Trust & Safety Specialist", "trust-and-safety-analyst"],
      ["Policy Enforcement Analyst", "trust-and-safety-analyst"],
      ["Content Review Analyst", "trust-and-safety-analyst"],
      ["Platform Integrity Analyst", "trust-and-safety-analyst"],
      ["Content Policy Analyst", "trust-and-safety-analyst"],
      ["Content Analyst", null],
      ["Legal Content Reviewer", null],
      ["Trust and Safety Engineer", null],
      ["Trust and Safety Manager", null],
      ["Software Asset Management Analyst", "software-asset-manager"],
      ["SAM Analyst", "software-asset-manager"],
      ["ITAM Analyst", "software-asset-manager"],
      ["IT Asset Management Analyst", "software-asset-manager"],
      ["Hardware Asset Management Analyst", "software-asset-manager"],
      ["Software Licensing Analyst", "software-asset-manager"],
      ["Licence Compliance Analyst", "software-asset-manager"],
      ["Flexera Administrator", "software-asset-manager"],
      ["IT Asset Manager", "software-asset-manager"],
      ["Software Asset Manager", "software-asset-manager"],
      ["Asset Management Analyst", null],
      ["Fixed Asset Analyst", null],
      ["ServiceNow SAM Pro Developer", "servicenow-developer"],
      ["Software License Manager", null],
      ["Asset Manager", null],
      ["Software Asset Manager - Flexera", "software-asset-manager"],
      ["BMS Engineer - Battery", "bms-engineer"],
      ["EV BMS Engineer", "bms-engineer"],
      // Tech batch TG3. Analog and mixed-signal chip design, motor control and CAE titles read before the chip, board
      // hardware, embedded and software rules ("Analog Circuit Design Engineer" was hardware design, "Motor Control
      // Software Engineer" software engineer, "Motor Drive Firmware Engineer" embedded); SAP BW and SAP Analytics Cloud
      // consultant titles before the BI developer rule; actuarial, biostatistics and clinical data titles after the
      // clinical SAS rule; Duck Creek after Guidewire; marketing automation, CRM and lifecycle marketing titles before
      // digital marketing ("Lifecycle Marketing Manager" was digital marketing). Ad operations, video editor and game
      // designer titles come after every other rule. A plain "Actuary", "Statistician", "Simulation Engineer", "Systems
      // Designer" or "CRM Executive", a "Project Data Manager" and a motor design engineer have none. Senior filter
      // titles stay dropped.
      ["Analog IC Design Engineer", "analog-ic-design-engineer"],
      ["Analog Mixed Signal Design Engineer", "analog-ic-design-engineer"],
      ["Analog Mixed-Signal Design Engineer", "analog-ic-design-engineer"],
      ["Analog Circuit Design Engineer", "analog-ic-design-engineer"],
      ["AMS Circuit Design Engineer", "analog-ic-design-engineer"],
      ["Senior Analog Design Engineer", "analog-ic-design-engineer"],
      ["PLL Design Engineer", "analog-ic-design-engineer"],
      ["ADC Design Engineer", "analog-ic-design-engineer"],
      ["Power Management IC Design Engineer", "analog-ic-design-engineer"],
      ["Analog Design Verification Engineer", "design-verification-engineer"],
      ["Analog Applications Engineer", null],
      ["Analog Hardware Design Engineer", "hardware-design-engineer"],
      ["Principal Analog Design Engineer", null],
      ["Motor Control Engineer", "motor-control-engineer"],
      ["Motor Control Software Engineer", "motor-control-engineer"],
      ["Motor Control Firmware Engineer", "motor-control-engineer"],
      ["Motor Controls Engineer", "motor-control-engineer"],
      ["Motor Drive Firmware Engineer", "motor-control-engineer"],
      ["Traction Inverter Controls Engineer", "motor-control-engineer"],
      ["Motor Control Applications Engineer", "motor-control-engineer"],
      ["Motor Design Engineer", null],
      ["Motor Drive Service Engineer", null],
      ["Motor Control Test Engineer", "qa-automation-engineer"],
      ["Motor Control Hardware Engineer", null],
      ["CAE Engineer", "cae-simulation-engineer"],
      ["CAE Analyst", "cae-simulation-engineer"],
      ["FEA Engineer", "cae-simulation-engineer"],
      ["FEA Analyst", "cae-simulation-engineer"],
      ["CFD Engineer", "cae-simulation-engineer"],
      ["Durability CAE Engineer", "cae-simulation-engineer"],
      ["Thermal Simulation Engineer", "cae-simulation-engineer"],
      ["NVH CAE Engineer", "cae-simulation-engineer"],
      ["Simulation Engineer", null],
      ["Structural Analysis Engineer", null],
      ["CAE Software Developer", "software-engineer"],
      ["Signal Integrity Simulation Engineer", null],
      ["Ad Operations Specialist", "ad-operations-specialist"],
      ["Ad Ops Executive", "ad-operations-specialist"],
      ["Ad Operations Analyst", "ad-operations-specialist"],
      ["Ad Trafficker", "ad-operations-specialist"],
      ["Campaign Trafficking Specialist", "ad-operations-specialist"],
      ["Programmatic Specialist", "ad-operations-specialist"],
      ["Programmatic Ad Operations Executive", "ad-operations-specialist"],
      ["Digital Ad Ops Specialist", "ad-operations-specialist"],
      ["Ad Operations Engineer", null],
      ["Ad Sales Executive", null],
      ["Ad Operations Manager", null],
      ["SAP BW Consultant", "sap-bw-consultant"],
      ["SAP BW/4HANA Consultant", "sap-bw-consultant"],
      ["SAP BW on HANA Consultant", "sap-bw-consultant"],
      ["SAP BW Developer", "sap-bw-consultant"],
      ["SAP BW HANA Developer", "sap-bw-consultant"],
      ["SAP BI/BW Consultant", "sap-bw-consultant"],
      ["SAP BW Support Consultant", "sap-bw-consultant"],
      ["SAP BW/4HANA Developer", "sap-bw-consultant"],
      ["SAP SAC Consultant", "sap-bw-consultant"],
      ["SAP Analytics Cloud Developer", "bi-developer"],
      ["SAP BW ABAP Developer", "sap-abap-developer"],
      ["SAP BW Architect", null],
      ["Duck Creek Developer", "duck-creek-developer"],
      ["Duck Creek Policy Developer", "duck-creek-developer"],
      ["Duck Creek Technical Consultant", "duck-creek-developer"],
      ["Duck Creek Manuscript Developer", "duck-creek-developer"],
      ["Duck Creek Integration Developer", "duck-creek-developer"],
      ["Duck Creek Business Analyst", "business-analyst"],
      ["Duck Creek QA Engineer", "qa-automation-engineer"],
      ["Actuarial Analyst", "actuarial-analyst"],
      ["Associate Actuarial Analyst", "actuarial-analyst"],
      ["Actuarial Associate", "actuarial-analyst"],
      ["Actuarial Trainee", "actuarial-analyst"],
      ["Reserving Analyst - Actuarial", "actuarial-analyst"],
      ["Pricing Analyst - Actuarial", "actuarial-analyst"],
      ["Actuarial Executive", "actuarial-analyst"],
      ["Actuary", null],
      ["Pricing Analyst", null],
      ["Actuarial Manager", null],
      ["Actuarial Systems Developer", null],
      ["Biostatistician", "biostatistician"],
      ["Statistician (clinical)", "biostatistician"],
      ["Clinical Statistician", "biostatistician"],
      ["Clinical Trial Statistician", "biostatistician"],
      ["Biostatistics Associate", "biostatistician"],
      ["Statistician - Clinical Research", "biostatistician"],
      ["Senior Biostatistician", "biostatistician"],
      ["Statistician", null],
      ["Principal Biostatistician", null],
      ["Biostatistics Manager", null],
      ["Biostatistical Programmer", "clinical-sas-programmer"],
      ["Clinical Data Manager", "clinical-data-manager"],
      ["Clinical Data Associate", "clinical-data-manager"],
      ["Clinical Data Coordinator", "clinical-data-manager"],
      ["Clinical Data Specialist", "clinical-data-manager"],
      ["Clinical Data Management Associate", "clinical-data-manager"],
      ["CDM Associate", "clinical-data-manager"],
      ["Project Data Manager", null],
      ["Clinical Data Scientist", "data-scientist"],
      ["Clinical Data Entry Operator", null],
      ["Data Management Associate", null],
      ["Video Editor", "video-editor"],
      ["Executive Video Editor", "video-editor"],
      ["Post-Production Editor", "video-editor"],
      ["Short-Form Video Editor", "video-editor"],
      ["Video Editor and Colourist", "video-editor"],
      ["Film Editor", "video-editor"],
      ["Content Editor", "content-writer"],
      ["Hair Colourist", null],
      ["Video Editing Intern", null],
      ["Game Designer", "game-designer"],
      ["Level Designer", "game-designer"],
      ["Associate Game Designer", "game-designer"],
      ["Gameplay Designer", "game-designer"],
      ["Systems Designer - Games", "game-designer"],
      ["Game Economy Designer", "game-designer"],
      ["LiveOps Game Designer", "game-designer"],
      ["Game UI Designer", "ui-ux-designer"],
      ["Game Artist", null],
      ["Systems Designer", null],
      ["Principal Game Designer", null],
      ["Marketing Automation Specialist", "marketing-automation-specialist"],
      ["Marketing Automation Manager", "marketing-automation-specialist"],
      ["CRM Marketing Executive", "marketing-automation-specialist"],
      ["Lifecycle Marketing Executive", "marketing-automation-specialist"],
      ["Lifecycle Marketing Manager", "marketing-automation-specialist"],
      ["CRM Manager - Lifecycle Marketing", "marketing-automation-specialist"],
      ["Retention Marketing Manager", "marketing-automation-specialist"],
      ["CRM Executive - Retention", "marketing-automation-specialist"],
      ["Marketo Specialist", "marketing-automation-specialist"],
      ["Marketing Operations Specialist", "marketing-automation-specialist"],
      ["Email Marketing Executive", "digital-marketing-executive"],
      ["CRM Executive", null],
      ["Marketing Automation Engineer", null],
      ["Salesforce Marketing Cloud Developer", "salesforce-developer"],
    ];
    expect(cases.map(([title]) => [title, classify(title)])).toEqual(cases);
    const roles = readdirSync(resolve(root, "src/content/roles")).map((f) => f.replace(/\.json$/, "")).sort();
    expect(Object.keys(ROLE_TITLES).sort()).toEqual(roles);
  });

  it("keeps India and remote-India posts only, with an https link and a title", () => {
    const at = (location: string, remote = false, url = "https://jobs.example.com/1") =>
      postRow("lever", { token: "examplecart", company: "Examplecart" }, { externalId: "1", title: "Data Analyst", url, location, remote, workType: "full_time", postedAt: null, lines: ["SQL", "Excel"] }, matchers);
    expect(at("Bengaluru")?.city).toBe("Bengaluru");
    expect(at("Remote - India", true)?.city).toBe("Remote");
    expect(at("Remote", true)).toBeNull();
    expect(at("London, United Kingdom")).toBeNull();
    expect(at("Pune", false, "http://jobs.example.com/1")).toBeNull();
    expect(at("Pune", false, "javascript:alert(1)")).toBeNull();
  });

  it("never keeps a posted time dated after the fetch (T90)", () => {
    const now = new Date(Date.UTC(2026, 9, 20, 6));
    const post = (postedAt: Date | null) =>
      postRow("lever", { token: "examplecart", company: "Examplecart" }, { externalId: "1", title: "Data Analyst", url: "https://jobs.example.com/1", location: "Pune", remote: false, workType: "full_time", postedAt, lines: ["SQL"] }, matchers, now)?.postedAt;
    const earlier = new Date(Date.UTC(2026, 9, 19));
    expect(post(earlier)).toEqual(earlier);
    expect(post(null)).toBeNull();
    expect(post(now)).toEqual(now);
    expect(post(new Date(now.getTime() + FUTURE_SKEW_MS))).toEqual(now);
    expect(post(new Date(now.getTime() + FUTURE_SKEW_MS + 1))).toBeNull();
    expect(post(new Date(Date.UTC(2027, 0, 1)))).toBeNull();
    expect(postedAtOf(new Date(Date.UTC(2030, 0, 1)), now)).toBeNull();
    // So a far-future post can't take a cap's place from a real one.
    const row = (externalId: string, postedAt: Date | null) => ({ ats: "lever", boardToken: "a", externalId, postedAt: postedAtOf(postedAt, now) });
    expect(capPosts([row("future", new Date(Date.UTC(2027, 0, 1))), row("real", earlier)], 1, 10).map((r) => r.externalId)).toEqual(["real"]);
  });

  it("caps posts per board and in all, keeping the newest", () => {
    const row = (ats: string, boardToken: string, externalId: string, day: number) => ({ ats, boardToken, externalId, postedAt: new Date(Date.UTC(2026, 9, day)) });
    const rows = [row("lever", "a", "1", 1), row("lever", "a", "2", 5), row("lever", "a", "3", 3), row("ashby", "b", "4", 2), row("ashby", "b", "5", 4)];
    expect(capPosts(rows, 2, 10).map((r) => r.externalId)).toEqual(["2", "5", "3", "4"]);
    expect(capPosts(rows, 2, 3).map((r) => r.externalId)).toEqual(["2", "5", "3"]);
  });

  it("checks each row: https only, title 2 to 160, skill ids as slugs", () => {
    const ok = { ats: "lever", boardToken: "examplecart", externalId: "1", url: "https://jobs.lever.co/examplecart/1", title: "Data Analyst", company: "Examplecart", city: "Pune", workType: "full_time", experienceNote: null, roleSlug: "data-analyst", requiredSkillIds: ["sql"], niceSkillIds: [], postedAt: null };
    expect(jobPostRow.safeParse(ok).success).toBe(true);
    expect(jobPostRow.safeParse({ ...ok, url: "http://jobs.lever.co/examplecart/1" }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, title: "D" }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, title: "x".repeat(161) }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, requiredSkillIds: ["Not a slug"] }).success).toBe(false);
    expect(jobPostRow.safeParse({ ...ok, ats: "naukri" }).success).toBe(false);
  });

  it("reads each saved answer through its schema into posts", () => {
    const gh = FEED_SCHEMAS.greenhouse;
    const jobs = gh.jobs(gh.board.parse(fixture("greenhouse")));
    const parsed = jobs.map((j: unknown) => gh.job.safeParse(j));
    // One posting has no title, so it alone is skipped.
    expect(parsed.filter((p: { success: boolean }) => !p.success)).toHaveLength(1);
    const first = rawPost("greenhouse", gh.job.parse(jobs[0]), "examplelabs");
    expect(first).toMatchObject({ externalId: "4001", title: "Junior Data Analyst", location: "Pune, Maharashtra, India", workType: "full_time" });
    expect(first.lines).toContain("Requirements");
    expect(FEED_SCHEMAS.lever.board.safeParse({ jobs: [] }).success).toBe(false);
  });
});

describe("getJson", () => {
  it("names a failed board by status only, times out after the limit, and refuses an answer over the size cap", async () => {
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: fakeFetch({}) })).toEqual({ ok: false, error: "404" });
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init!.signal!.reason))),
    ) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: hang, timeoutMs: 20 })).toEqual({ ok: false, error: "timeout" });
    const big = vi.fn(async () => new Response("x".repeat(2000))) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: big, maxBytes: 1000 })).toEqual({ ok: false, error: "too_large" });
    const notJson = vi.fn(async () => new Response("<html>")) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: notJson })).toEqual({ ok: false, error: "not_json" });
    const sent = fakeFetch({ "https://api.lever.co/v0/postings/x?mode=json": [] });
    expect(await getJson("https://api.lever.co/v0/postings/x?mode=json", { fetchImpl: sent })).toEqual({ ok: true, data: [] });
    expect(vi.mocked(sent).mock.calls[0][1]).toMatchObject({ headers: { "user-agent": USER_AGENT }, redirect: "error" });
  });

  it("refuses an answer that ended up anywhere but https", async () => {
    const plain = vi.fn(async () => Object.defineProperty(json([]), "url", { value: "http://api.lever.co/v0/postings/x" })) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: plain })).toEqual({ ok: false, error: "network" });
    const thrown = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await getJson("https://api.lever.co/v0/postings/x", { fetchImpl: thrown })).toEqual({ ok: false, error: "network" });
  });
});

describe("collect", () => {
  it("reads every board once, keeps checked India rows, skips a failed board with its status, and logs nothing", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetchImpl = fakeFetch(allAnswers());
    const { rows, results } = await collect(boards, matchers, { fetchImpl });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(boards.length);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    expect(results.find((r) => r.token === "gone")).toEqual({ ats: "lever", token: "gone", ok: false, posts: 0, error: "404" });
    expect(results.filter((r) => r.ok).map((r) => [r.token, r.posts]).sort()).toEqual([
      ["ExampleWorks", 1],
      ["examplecart", 2],
      ["examplelabs", 3],
      ["examplepay", 1],
    ]);
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    expect(byId.get("4001")).toMatchObject({ company: "Example Labs", city: "Pune", experienceNote: "2 to 4 years", roleSlug: "data-analyst", requiredSkillIds: ["sql", "excel"], niceSkillIds: ["python"] });
    expect(byId.get("4003")).toMatchObject({ city: "Remote" });
    // Too few skills found: kept, and Departures shows it with no fit.
    expect(byId.get("4004")).toMatchObject({ requiredSkillIds: [], roleSlug: null });
    expect(byId.get("a1b2c3d4-0001")).toMatchObject({ city: "Bengaluru", roleSlug: "qa-automation-engineer", requiredSkillIds: ["java", "selenium", "api-testing"], niceSkillIds: ["docker"] });
    expect(byId.get("a1b2c3d4-0002")).toMatchObject({ city: "Mumbai", workType: "part_time" });
    expect(byId.get("9f1e0000-aaaa-4bbb-8ccc-000000000001")).toMatchObject({ city: "Gurugram", experienceNote: "5+ years", requiredSkillIds: ["typescript", "react"], niceSkillIds: ["kubernetes"] });
    expect(byId.get("744000000000001")).toMatchObject({ city: "Chennai", url: "https://jobs.smartrecruiters.com/ExampleWorks/744000000000001" });
    // Not in India, http, no title, remote without India: left out.
    for (const id of ["4002", "4005", "4006", "a1b2c3d4-0003", "9f1e0000-aaaa-4bbb-8ccc-000000000002", "744000000000002"]) expect(byId.has(id)).toBe(false);
    for (const r of rows) expect(jobPostRow.safeParse(r).success).toBe(true);
    // No post text in a row: only these fields.
    expect(Object.keys(rows[0]).sort()).toEqual(["ats", "boardToken", "city", "company", "experienceNote", "externalId", "niceSkillIds", "postedAt", "requiredSkillIds", "roleSlug", "title", "url", "workType"]);
  });

  it("fails a board whose answer doesn't fit its schema, and the summary names boards and counts only", async () => {
    const { rows, results } = await collect(boards.slice(0, 1), matchers, { fetchImpl: fakeFetch({ [feedUrl("greenhouse", "examplelabs")]: { postings: [] } }) });
    expect(rows).toEqual([]);
    expect(results).toEqual([{ ats: "greenhouse", token: "examplelabs", ok: false, posts: 0, error: "invalid" }]);
    const full = await collect(boards, matchers, { fetchImpl: fakeFetch(allAnswers()) });
    const text = summaryLines(full.results, full.rows.length, { open: 7, closed: 1 }).join("\n");
    expect(text).toContain("Boards read: 4 of 5. Posts kept: 7.");
    expect(text).toContain("Skipped lever/gone: last_error 404");
    expect(text).not.toMatch(/Analyst|Engineer|SQL|Pune/);
  });

  it("reports the rollup as counts only, and a rollup failure as its code only", () => {
    const stats = { month: "2026-10-01", rows: 12, counted: 9, unmatched: 4, indiaOnly: 2, previous: "2026-09-01" };
    const text = summaryLines([], 0, { open: 9, closed: 0 }, stats).join("\n");
    expect(text).toContain(
      "Market 2026-10: 12 rows from 9 posts new this month or open; 4 matched no live role and are left out; 2 counted in India only",
    );
    expect(text).toContain("Market 2026-09 was behind its last run, so it was rewritten as of that run.");
    expect(summaryLines([], 0, null, null).join("\n")).not.toContain("Market");

    // A Postgres error's message can quote a row's values; only its SQLSTATE is printed.
    const pg = Object.assign(new Error('duplicate key value violates unique constraint: (data-analyst, MH, Pune)'), { code: "23505" });
    expect(failureCode(pg)).toBe("23505");
    expect(failureCode(new TypeError("Cannot read Pune of undefined"))).toBe("TypeError");
    expect(failureCode(Object.assign(new Error("x"), { code: "not a code", name: "Error with Pune" }))).toBe("error");
    expect(failureCode(null)).toBe("error");
    const failed = summaryLines([], 0, { open: 9, closed: 0 }, { failed: failureCode(pg) }).join("\n");
    expect(failed).toContain("Market rollup failed (23505): this month's market_openings_monthly rows were not updated.");
    expect(failed).not.toMatch(/Pune|duplicate|data-analyst/);
  });

  it("marks a board the caps cut and a full SmartRecruiters page, keeps every post it saw, and closes only on the board read whole (T79)", async () => {
    const capped = await collect(boards, matchers, { fetchImpl: fakeFetch(allAnswers()), perBoard: 1 });
    const gh = capped.results.find((r) => r.token === "examplelabs");
    expect(gh).toMatchObject({ ok: true, posts: 3, capped: true });
    expect(capped.rows.filter((r) => r.boardToken === "examplelabs")).toHaveLength(1);
    expect(capped.seen.filter((s) => s.k === "greenhouse:examplelabs")).toHaveLength(3);
    expect(capped.results.find((r) => r.token === "examplepay")?.capped).toBeUndefined();
    const closing = boardsToClose([], capped.results, boards, false);
    // Read whole though capped: it closes what left it, and writeRun keeps the posts it saw (seen) open.
    expect(closing).toContain("greenhouse:examplelabs");
    expect(closing).toContain("ashby:examplepay");
    expect(summaryLines(capped.results, capped.rows.length, null).join("\n")).toContain("Capped greenhouse/examplelabs: over the post caps");

    const page = fixture("smartrecruiters") as { content: unknown[] };
    const full = { content: Array.from({ length: FEED_LIMITS.smartRecruitersPage }, (_, i) => page.content[i % page.content.length]) };
    const sr = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch({ [feedUrl("smartrecruiters", "ExampleWorks")]: full }) });
    expect(sr.results[0]).toMatchObject({ ok: true, truncated: true });
    expect(boardsToClose([], sr.results, boards, false)).toEqual([]);
    const more = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch({ [feedUrl("smartrecruiters", "ExampleWorks")]: { ...page, totalFound: 250 } }) });
    expect(more.results[0]).toMatchObject({ truncated: true });
    const whole = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch(allAnswers()) });
    expect(whole.results[0].truncated).toBeUndefined();
    expect(summaryLines(sr.results, sr.rows.length, null).join("\n")).toContain("Kept open smartrecruiters/ExampleWorks: answer cut short");
  });

  it("spaces SmartRecruiters requests, and tries once more after a 429's Retry-After", async () => {
    const page = fixture("smartrecruiters");
    const url = feedUrl("smartrecruiters", "ExampleWorks");
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    let calls = 0;
    const busyOnce = vi.fn(async () => {
      calls++;
      return calls === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "3" } }) : json(page);
    }) as unknown as typeof fetch;
    const read = await collect(boards.slice(3, 4), matchers, { fetchImpl: busyOnce, sleep, gapMs: 0 });
    expect(read.results[0]).toMatchObject({ ok: true });
    expect(calls).toBe(2);
    expect(waits).toContain(3000);
    // A second 429 is the board's answer for this run.
    const busy = vi.fn(async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    const failed = await collect(boards.slice(3, 4), matchers, { fetchImpl: busy, sleep, gapMs: 0 });
    expect(failed.results[0]).toMatchObject({ ok: false, error: "429" });
    expect(busy).toHaveBeenCalledTimes(2);
    // Requests a gap apart wait for it.
    waits.length = 0;
    await collect([boards[3], boards[3]], matchers, { fetchImpl: fakeFetch({ [url]: page }), sleep, gapMs: 500, concurrency: 1 });
    expect(waits.some((ms) => ms > 0 && ms <= 500)).toBe(true);
  });

  it("reads a SmartRecruiters board page by page, and counts it whole once every page came back", async () => {
    const page = fixture("smartrecruiters") as { content: unknown[] };
    const n = FEED_LIMITS.smartRecruitersPage;
    const fill = (length: number) => Array.from({ length }, (_, i) => page.content[i % page.content.length]);
    const url = (offset = 0) => feedUrl("smartrecruiters", "ExampleWorks", undefined, offset);
    const two = { [url()]: { content: fill(n), totalFound: n + 3 }, [url(n)]: { content: fill(3), totalFound: n + 3 } };
    const whole = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch(two) });
    expect(whole.results[0].truncated).toBeUndefined();
    expect(whole.seen).toHaveLength((await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch({ [url()]: { content: fill(n + 3) } }) })).seen.length);
    expect(boardsToClose([], whole.results, boards, false)).toEqual(["smartrecruiters:ExampleWorks"]);

    // A later page that fails keeps what came back, and the board closes nothing.
    const broken = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch({ [url()]: two[url()], [url(n)]: 500 }) });
    expect(broken.results[0]).toMatchObject({ ok: true, truncated: true });
    expect(broken.seen.length).toBeGreaterThan(0);

    // Past the last page read, the board is cut short.
    const pages = Object.fromEntries(Array.from({ length: FEED_LIMITS.smartRecruitersPages }, (_, i) => [url(i * n), { content: fill(n), totalFound: 100 * n }]));
    const capped = await collect(boards.slice(3, 4), matchers, { fetchImpl: fakeFetch(pages), gapMs: 0 });
    expect(capped.results[0]).toMatchObject({ ok: true, truncated: true });
  });

  it("closes only boards it read, and boards taken off the list", () => {
    const results = [
      { ats: "lever" as const, token: "a", ok: true, posts: 1, error: null },
      { ats: "lever" as const, token: "b", ok: false, posts: 0, error: "500" },
    ];
    const listed = jobBoardsFile.parse([board("lever", "a", "A"), board("lever", "b", "B")]);
    expect(boardsToClose(["lever:a", "lever:b", "ashby:old"], results, listed)).toEqual(["ashby:old", "lever:a"]);
    expect(boardsToClose(["lever:a", "lever:b", "ashby:old"], results, listed, false)).toEqual(["lever:a"]);
    expect(boardsToClose(["lever:bad,key}"], [], listed)).toEqual([]);
    expect(boardsToClose(["ashby:flagright.com", "ashby:a..b"], [], listed)).toEqual(["ashby:flagright.com"]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;

describe.skipIf(!sql)("the feed's writes (database)", () => {
  const run = `feed${Date.now()}`;
  const mine = jobBoardsFile.parse([board("greenhouse", `${run}g`, "Example Labs"), board("lever", `${run}l`, "Examplecart")]);
  const runIds: string[] = [];
  const answers = (greenhouse: unknown, lever: unknown) =>
    fakeFetch({ [feedUrl("greenhouse", `${run}g`)]: greenhouse, [feedUrl("lever", `${run}l`)]: lever });
  const posts = () => sql!`select external_id, board_token, closed_at, city from job_posts where board_token in ${sql!(mine.map((b) => b.token))} order by external_id`;
  const t0 = new Date("2026-01-05T01:00:00Z");
  const at = (days: number) => new Date(t0.getTime() + days * 86_400_000);
  const once = async (fetchImpl: typeof fetch, days: number) => {
    const { rows, results } = await collect(mine, matchers, { fetchImpl });
    const written = await writeRun(sql!, { boards: mine, rows, results, startedAt: at(days), now: new Date(at(days).getTime() + 1000), closeUnlisted: false });
    runIds.push(written.runId);
    return written;
  };

  // The rollup's test months are long before any other test's posts, so only this file's posts count in them.
  const rollupMonths = ["2024-05-01", "2024-06-01", "2024-07-01", "2024-08-01", "2024-09-01"];
  afterAll(async () => {
    await sql!`delete from job_posts where board_token in ${sql!(mine.map((b) => b.token))} or board_token = ${`${run}m`}`;
    if (runIds.length) await sql!`delete from job_feed_runs where id in ${sql!(runIds)}`;
    await sql!`delete from job_feed_boards where board_token in ${sql!(mine.map((b) => b.token))}`;
    await sql!`delete from market_openings_monthly where month in ${sql!(rollupMonths)}`;
    await sql!.end();
  });

  it("upserts by external id, closes what left a board it read, closes nothing on a board that failed, and reopens a post that came back", async () => {
    await once(answers(fixture("greenhouse"), fixture("lever")), 0);
    expect((await posts()).map((p) => [p.external_id, p.closed_at])).toEqual([
      ["4001", null],
      ["4003", null],
      ["4004", null],
      ["a1b2c3d4-0001", null],
      ["a1b2c3d4-0002", null],
    ]);

    // Next day: two Greenhouse posts left the board, and Lever failed.
    const gh = fixture("greenhouse") as { jobs: { id: unknown }[] };
    const second = await once(answers({ jobs: gh.jobs.filter((j) => j.id === 4001) }, 500), 1);
    expect(second.closed).toBe(2);
    const after = new Map((await posts()).map((p) => [p.external_id, p.closed_at]));
    expect(after.get("4001")).toBeNull();
    expect(after.get("4003")).not.toBeNull();
    expect(after.get("4004")).not.toBeNull();
    expect(after.get("a1b2c3d4-0001")).toBeNull();
    expect(after.get("a1b2c3d4-0002")).toBeNull();
    const [runRow] = await sql!`select boards_ok, boards_failed, posts_closed, finished_at from job_feed_runs where id = ${second.runId}`;
    expect(runRow).toMatchObject({ boards_ok: 1, boards_failed: 1, posts_closed: 2 });
    expect(runRow.finished_at).not.toBeNull();

    // The day after, 4003 is back on the board: the same row opens again.
    await once(answers({ jobs: gh.jobs.filter((j) => j.id === 4001 || j.id === 4003) }, fixture("lever")), 2);
    const back = new Map((await posts()).map((p) => [p.external_id, p.closed_at]));
    expect(back.get("4003")).toBeNull();
    expect(back.get("4004")).not.toBeNull();
    expect((await posts()).filter((p) => p.external_id === "4003")).toHaveLength(1);
  });

  it("never closes a post the caps left out, but still closes one that left a capped board (T79)", async () => {
    await once(answers(fixture("greenhouse"), fixture("lever")), 3);
    const { rows, results, seen } = await collect(mine, matchers, { fetchImpl: answers(fixture("greenhouse"), fixture("lever")), perBoard: 1 });
    const startedAt = at(4);
    const written = await writeRun(sql!, { boards: mine, rows, results, seen, startedAt, now: new Date(startedAt.getTime() + 1000), closeUnlisted: false });
    runIds.push(written.runId);
    // Both boards were cut to one post; the others were seen, so all stay open.
    expect(written.closed).toBe(0);
    expect((await posts()).filter((p) => p.closed_at !== null).map((p) => p.external_id)).toEqual([]);

    // Next day 4004 is gone from Greenhouse and the caps still cut both boards: 4004 closes, every post seen stays open.
    const gh = fixture("greenhouse") as { jobs: { id: unknown }[] };
    const later = await collect(mine, matchers, { fetchImpl: answers({ jobs: gh.jobs.filter((j) => j.id !== 4004) }, fixture("lever")), perBoard: 1 });
    expect(later.results.every((r) => r.capped)).toBe(true);
    const next = at(5);
    const closing = await writeRun(sql!, { ...later, boards: mine, startedAt: next, now: new Date(next.getTime() + 1000), closeUnlisted: false });
    runIds.push(closing.runId);
    expect(closing.closed).toBe(1);
    expect((await posts()).filter((p) => p.closed_at !== null).map((p) => p.external_id)).toEqual(["4004"]);
  });

  it("replaces a stored posted_at that is still in the future, and keeps a sane one the board stopped sending (T90)", async () => {
    const runAt = new Date("2026-10-20T12:00:00Z");
    const write = async (greenhouse: unknown) => {
      const { rows, results } = await collect(mine, matchers, { fetchImpl: answers(greenhouse, fixture("lever")), now: runAt });
      const written = await writeRun(sql!, { boards: mine, rows, results, startedAt: runAt, now: runAt, closeUnlisted: false });
      runIds.push(written.runId);
    };
    await write(fixture("greenhouse"));
    const token = `${run}g`;
    await sql!`update job_posts set posted_at = '2099-01-01T00:00:00Z' where board_token = ${token} and external_id = '4001'`;
    await sql!`update job_posts set posted_at = '2026-10-17T09:00:00Z' where board_token = ${token} and external_id = '4003'`;
    // The board now sends no date for either.
    const gh = fixture("greenhouse") as { jobs: Record<string, unknown>[] };
    const undated = { jobs: gh.jobs.map((j) => (j.id === 4001 || j.id === 4003 ? { ...j, first_published: undefined, updated_at: undefined } : j)) };
    await write(undated);
    const dated = new Map(
      (await sql!`select external_id, posted_at from job_posts where board_token = ${token} and external_id in ('4001', '4003')`).map((r) => [r.external_id, r.posted_at]),
    );
    expect(dated.get("4001")).toBeNull();
    expect((dated.get("4003") as Date).toISOString()).toBe("2026-10-17T09:00:00.000Z");
  });

  it("writes this month's openings rollup as an idempotent upsert, drops cells the posts no longer give, and catches up only a month that missed its last run", async () => {
    const token = `${run}m`;
    let n = 0;
    const add = async (city: string, roleSlug: string | null, note: string | null, firstSeen: string, closed: string | null = null) => {
      const [p] = await sql!`
        insert into job_posts (ats, board_token, external_id, url, title, company, city, experience_note, role_slug, first_seen_at, last_seen_at, closed_at)
        values ('lever', ${token}, ${String(n++)}, 'https://jobs.lever.co/example/1', 'Data Analyst', 'Example Labs', ${city}, ${note}, ${roleSlug},
          ${firstSeen}, ${firstSeen}, ${closed})
        returning id`;
      return String(p.id);
    };
    const pune = await add("Pune", "data-analyst", "2 to 4 years", "2024-06-03T01:00:00Z");
    await add("Remote", "data-analyst", null, "2024-06-04T01:00:00Z", "2024-06-10T01:00:00Z");
    await add("Bengaluru", null, "5+ years", "2024-06-05T01:00:00Z");
    await add("Hyderabad", "data-analyst", "3+ years", "2024-05-20T01:00:00Z");
    for (const [finished, ok] of [["2024-06-03T01:05:00Z", 7], ["2024-06-04T01:05:00Z", 5], ["2024-06-05T01:05:00Z", 0], ["2024-05-31T01:05:00Z", 2]] as const) {
      const [r] = await sql!`insert into job_feed_runs (started_at, finished_at, boards_ok) values (${finished}, ${finished}, ${ok}) returning id`;
      runIds.push(String(r.id));
    }
    const june = new Date("2024-06-20T01:00:00Z");
    const rowsOf = (month: string) =>
      sql!`select id, role_slug, state, city, band, new_posts, open_at_end, boards_ok, computed_at from market_openings_monthly
        where month = ${month}::date order by role_slug, state, city nulls first, band nulls last`;
    const cells = (rows: Awaited<ReturnType<typeof rowsOf>>) =>
      rows.map((r) => [r.role_slug, r.state, r.city, r.band, r.new_posts, r.open_at_end, r.boards_ok].join("|")).sort();

    const stats = await writeRollup(sql!, { now: june });
    // May has a run but no rows: it is never filled in afterwards.
    expect(stats).toMatchObject({ month: "2024-06-01", counted: 3, unmatched: 1, indiaOnly: 1, previous: null });
    expect(await rowsOf("2024-05-01")).toHaveLength(0);
    const first = await rowsOf("2024-06-01");
    // Pune and Hyderabad count in their city, state and India; Remote only in India; the post with no live role nowhere.
    // boards_ok is June's lowest run that read a board (5): not May's (2), and not the run where every board failed (0).
    expect(cells(first)).toEqual([
      "data-analyst|IN|||1|0|5",
      "data-analyst|IN||0-2|1|1|5",
      "data-analyst|IN||3-5|0|1|5",
      "data-analyst|MH||0-2|1|1|5",
      "data-analyst|MH|Pune|0-2|1|1|5",
      "data-analyst|TG||3-5|0|1|5",
      "data-analyst|TG|Hyderabad|3-5|0|1|5",
    ].sort());

    // The same day again: the same rows, updated in place.
    await writeRollup(sql!, { now: june });
    const again = await rowsOf("2024-06-01");
    expect(cells(again)).toEqual(cells(first));
    expect(again.map((r) => r.id)).toEqual(first.map((r) => r.id));

    // A post's role changed: its old cells go, its new ones come.
    await sql!`update job_posts set role_slug = 'devops-engineer' where id = ${pune}`;
    await writeRollup(sql!, { now: june });
    const changed = cells(await rowsOf("2024-06-01"));
    expect(changed).not.toContain("data-analyst|MH|Pune|0-2|1|1|5");
    expect(changed.some((c) => c.startsWith("data-analyst|MH") || c.startsWith("data-analyst|IN||0-2|"))).toBe(false);
    expect(changed).toContain("devops-engineer|MH|Pune|0-2|1|1|5");

    // A new month: July counts what is still open, June stays as it was (its rows are newer than its last run).
    expect((await writeRollup(sql!, { now: new Date("2024-07-02T01:00:00Z") })).previous).toBeNull();
    expect(cells(await rowsOf("2024-06-01"))).toEqual(changed);
    expect(cells(await rowsOf("2024-07-01"))).toEqual(
      [
        "devops-engineer|IN||0-2|0|1|0",
        "devops-engineer|MH||0-2|0|1|0",
        "devops-engineer|MH|Pune|0-2|0|1|0",
        "data-analyst|IN||3-5|0|1|0",
        "data-analyst|TG||3-5|0|1|0",
        "data-analyst|TG|Hyderabad|3-5|0|1|0",
      ].sort(),
    );

    // June's last run (28 June) wrote a post but its rollup failed: the next run rewrites June as of that run, once.
    await add("Chennai", "data-analyst", "2 to 4 years", "2024-06-28T01:00:00Z");
    const lastJune = "2024-06-28T01:05:00Z";
    const [late] = await sql!`insert into job_feed_runs (started_at, finished_at, boards_ok) values (${lastJune}, ${lastJune}, 6) returning id`;
    runIds.push(String(late.id));
    const july3 = new Date("2024-07-03T01:00:00Z");
    expect((await writeRollup(sql!, { now: july3 })).previous).toBe("2024-06-01");
    const caughtUp = await rowsOf("2024-06-01");
    expect(cells(caughtUp)).toEqual(
      [...changed, "data-analyst|IN||0-2|1|1|5", "data-analyst|TN||0-2|1|1|5", "data-analyst|TN|Chennai|0-2|1|1|5"].sort(),
    );
    expect(new Set(caughtUp.map((r) => (r.computed_at as Date).toISOString()))).toEqual(new Set(["2024-06-28T01:05:00.000Z"]));
    expect((await writeRollup(sql!, { now: july3 })).previous).toBeNull();

    // The table's own checks back the schema.
    await expect(sql!`insert into market_openings_monthly (month, role_slug, state, city) values ('2024-06-02', 'data-analyst', 'MH', null)`).rejects.toThrow();
    await expect(sql!`insert into market_openings_monthly (month, role_slug, state, city) values ('2024-06-01', 'data-analyst', 'IN', 'Pune')`).rejects.toThrow();
    // Nulls are not distinct in the cell key: a second India row with no band is refused.
    await expect(
      sql!`insert into market_openings_monthly (month, role_slug, state, city, band, new_posts) values ('2024-06-01', 'data-analyst', 'IN', null, null, 1)`,
    ).rejects.toThrow();
  });

  it("cuts the rollup's months on the India day: a post and a run after 18:30 UTC on 31 August are September's, and August's catch-up ignores that run", async () => {
    // Its own role, so the posts the test above leaves open never land in these cells.
    const token = `${run}m`;
    const role = "product-manager";
    const add = async (id: string, firstSeen: string, closed: string | null = null) => {
      await sql!`
        insert into job_posts (ats, board_token, external_id, url, title, company, city, experience_note, role_slug, first_seen_at, last_seen_at, closed_at)
        values ('lever', ${token}, ${id}, 'https://jobs.lever.co/example/2', 'Product Manager', 'Example Labs', 'Pune', '2 to 4 years', ${role},
          ${firstSeen}, ${firstSeen}, ${closed})`;
    };
    await add("india-aug", "2024-08-20T01:00:00Z", "2024-08-25T01:00:00Z");
    // 00:30 IST on 1 September.
    await add("india-sep", "2024-08-31T19:00:00Z");
    // 01:30 IST on 1 September: September's run, though its UTC date is 31 August.
    for (const [finished, ok] of [["2024-08-20T01:05:00Z", 9], ["2024-08-31T20:00:00Z", 3]] as const) {
      const [r] = await sql!`insert into job_feed_runs (started_at, finished_at, boards_ok) values (${finished}, ${finished}, ${ok}) returning id`;
      runIds.push(String(r.id));
    }
    const mineIn = async (month: string) =>
      (
        await sql!`select state, city, band, new_posts, open_at_end, boards_ok from market_openings_monthly
          where month = ${month}::date and role_slug = ${role}`
      )
        .map((r) => [r.state, r.city, r.band, r.new_posts, r.open_at_end, r.boards_ok].join("|"))
        .sort();

    await writeRollup(sql!, { now: new Date("2024-08-20T02:00:00Z") });
    const august = ["IN||0-2|1|1|9", "MH||0-2|1|1|9", "MH|Pune|0-2|1|1|9"].sort();
    expect(await mineIn("2024-08-01")).toEqual(august);

    // On UTC days the 20:00 run would be August's last, newer than August's rows, and August would be caught up.
    const september = await writeRollup(sql!, { now: new Date("2024-09-01T01:00:00Z") });
    expect(september).toMatchObject({ month: "2024-09-01", previous: null });
    // The post first seen at 19:00 UTC is new in September, and boards_ok is that run's 3, not August's 9.
    expect(await mineIn("2024-09-01")).toEqual(["IN||0-2|1|1|3", "MH||0-2|1|1|3", "MH|Pune|0-2|1|1|3"].sort());
    expect(await mineIn("2024-08-01")).toEqual(august);
  });

  it("refuses a row the table's checks don't allow", async () => {
    await expect(
      sql!`insert into job_posts (ats, board_token, external_id, url, title, company, city) values ('lever', ${`${run}x`}, '1', 'http://example.com', 'Data Analyst', 'Example', 'Pune')`,
    ).rejects.toThrow();
    await expect(
      sql!`insert into job_posts (ats, board_token, external_id, url, title, company, city) values ('naukri', ${`${run}x`}, '1', 'https://example.com', 'Data Analyst', 'Example', 'Pune')`,
    ).rejects.toThrow();
  });

  it("counts a board's bad runs in a row, names it at the limit, and starts again after a good run", async () => {
    const lever = `lever:${run}l`;
    for (const day of [30, 31]) expect((await once(answers(fixture("greenhouse"), 404), day)).stuck.map((b) => b.key)).not.toContain(lever);
    const third = await once(answers(fixture("greenhouse"), 404), 32);
    expect(third.stuck).toContainEqual({ key: lever, problem: "404", runs: FEED_LIMITS.badRuns });
    expect(third.stuck.map((b) => b.key)).not.toContain(`greenhouse:${run}g`);
    expect(summaryLines([], 0, third).join("\n")).toContain(`lever/${run}l (404, 3 runs)`);
    const good = await once(answers(fixture("greenhouse"), fixture("lever")), 33);
    expect(good.stuck).toEqual([]);
    const [row] = await sql!`select bad_runs, last_problem, last_ok_at from job_feed_boards where ats = 'lever' and board_token = ${`${run}l`}`;
    expect(row).toMatchObject({ bad_runs: 0, last_problem: null });
    expect(row.last_ok_at).not.toBeNull();
  });
});

describe("boardProblem", () => {
  it("names a failure by its code, a board with no India post as empty, and a good board as null", () => {
    const r = { ats: "lever", token: "x", ok: true, posts: 3, error: null } as const;
    expect(boardProblem({ ...r, ok: false, posts: 0, error: "timeout" })).toBe("timeout");
    expect(boardProblem({ ...r, posts: 0 })).toBe("empty");
    expect(boardProblem(r)).toBeNull();
    expect(FEED_LIMITS.badRuns).toBe(FEED_BAD_RUNS);
  });
});

describe("placeLine", () => {
  it("counts kept posts by city, most first, then Remote and India with no city", () => {
    const rows = ["Mumbai", "Bengaluru", "Bengaluru", "Remote", "India", "Pune", "Mumbai", "Bengaluru"].map((city) => ({ city }));
    expect(placeLine(rows)).toBe("Posts kept by place: Bengaluru 3, Mumbai 2, Pune 1, Remote 1, India (no city) 1.");
  });

  it("folds cities past the top ones into one count, and says nothing with no posts", () => {
    expect(placeLine([{ city: "Mumbai" }, { city: "Pune" }, { city: "Pune" }], 1)).toBe("Posts kept by place: Pune 2, other cities 1.");
    expect(placeLine([])).toBeNull();
  });
});

describe("roleLine and unmatchedLine", () => {
  const rows = [
    { title: "Data Analyst", roleSlug: "data-analyst" },
    { title: "Cloud Engineer", roleSlug: "cloud-engineer" },
    { title: "Data Analyst II", roleSlug: "data-analyst" },
    { title: "Sales Manager - Pune", roleSlug: null },
    { title: "Sales  manager (Mumbai)", roleSlug: null },
    { title: "Accountant", roleSlug: null },
  ];

  it("counts kept posts by role, most first, then those with no role", () => {
    expect(roleLine(rows)).toBe("Posts kept by role: data-analyst 2, cloud-engineer 1, no role 3.");
    expect(roleLine([])).toBeNull();
  });

  it("lists the commonest unmatched titles, folding place and case", () => {
    expect(unmatchedLine(rows)).toBe("Commonest titles with no role: sales manager 2; accountant 1.");
    expect(unmatchedLine(rows, 1)).toBe("Commonest titles with no role: sales manager 2.");
    expect(unmatchedLine(rows.slice(0, 3))).toBeNull();
  });

  it("writes the unmatched titles as a tab-separated file, commonest first", () => {
    expect(unmatchedTsv(rows)).toBe("count\ttitle\n2\tsales manager\n1\taccountant\n");
    expect(unmatchedTsv(rows, 1)).toBe("count\ttitle\n2\tsales manager\n");
    expect(unmatchedTsv(rows.slice(0, 3))).toBe("count\ttitle\n");
  });
});
