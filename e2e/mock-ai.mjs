// A stand-in for the Claude API in end-to-end runs and local copies (docs/local-setup.md). The parse call gets a
// profile: for a synthetic resume from fixtures/evals (matched by its first line, "Name | City"), one built from that
// resume's reviewed skills and quotes; for anything else, the fixed profile of fixtures/resumes/priya-sharma. The
// parse-jd call ("Check against a job") gets the skills listed for a fixture posting. Every other call gets text that
// fails its schema, so the app's plain-code fallbacks are used.
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";

const root = new URL("..", import.meta.url);
const skillNames = new Map(JSON.parse(readFileSync(new URL("src/content/skills.json", root), "utf8")).map((s) => [s.id, s.name]));
const evalsDir = new URL("fixtures/evals/", root);
const personas = readdirSync(evalsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, evalsDir), "utf8")))
  .map((e) => {
    const firstLine = e.resumeText.split("\n")[0];
    const [name, city] = firstLine.split("|").map((p) => p.trim());
    return {
      key: `${name} | ${city}`,
      profile: {
        headline: e.persona,
        totalYearsExperience: e.expected.totalYearsExperience ?? null,
        roles: [],
        skills: e.expected.skills.map((s) => ({ name: skillNames.get(s.skillId) ?? s.skillId, lastUsed: null, evidence: [s.quote] })),
        education: [],
        certifications: [],
        personName: name,
      },
    };
  });
const profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [
    {
      title: "Data Analyst",
      employer: "Example Retail Pvt Ltd",
      start: "2022-06",
      end: null,
      highlights: ["Wrote SQL queries for weekly sales reports across 40 stores", "Built Excel dashboards with pivot tables for regional managers"],
    },
    {
      title: "Junior Analyst",
      employer: "Sample Analytics LLP",
      start: "2021-07",
      end: "2022-05",
      highlights: ["Prepared monthly MIS reports in Excel"],
    },
  ],
  skills: [
    { name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] },
    { name: "Excel", lastUsed: null, evidence: ["Built Excel dashboards with pivot tables for regional managers"] },
    { name: "Python", lastUsed: "2022-05", evidence: ["Used Python (pandas) to merge vendor files"] },
    { name: "Power BI", lastUsed: null, evidence: [] },
  ],
  education: [{ qualification: "B.Com", institution: "Savitribai Phule Pune University", year: "2021" }],
  certifications: [{ name: "Google Data Analytics Professional Certificate", earned: null, expires: null }],
  personName: "Priya Sharma",
};
// Job postings (prompts/parse-jd): for a synthetic posting from fixtures/job-postings, its listed skills (quotes from the
// posting, plus one invented on purpose that the app must drop); for any other posting, no skills.
const postingsDir = new URL("fixtures/job-postings/", root);
const postings = readdirSync(postingsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, postingsDir), "utf8")));
// MOCK_AI_DELAY_MS holds each answer back, as a real call takes 10 to 40 seconds (the load test, e2e/load-upload.mjs).
const delay = Number(process.env.MOCK_AI_DELAY_MS ?? 0);
let n = 0;
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const id = ++n;
      const j = JSON.parse(body || "{}");
      const sys = typeof j.system === "string" ? j.system : JSON.stringify(j.system ?? "");
      const sent = JSON.stringify(j.messages ?? "");
      const isJd = /job posting/i.test(sys) && sent.includes("<job_posting>");
      const isParse = !isJd && /resume/i.test(sys) && /<resume|resume_text|wrap/i.test(sent);
      const persona = isParse ? personas.find((p) => sent.includes(p.key)) : undefined;
      const content = typeof j.messages?.[0]?.content === "string" ? j.messages[0].content : "";
      const posting = isJd ? postings.find((p) => content.includes(p.text.split("\n")[0])) : undefined;
      const text = isJd ? JSON.stringify({ skills: posting?.skills ?? [] }) : isParse ? JSON.stringify(persona?.profile ?? profile) : "not json";
      console.log(id, req.url, isJd ? "parse-jd" : isParse ? "parse" : "other", sys.slice(0, 60).replace(/\n/g, " "));
      const answer = () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_" + id,
            type: "message",
            role: "assistant",
            model: j.model,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1000, output_tokens: 300 },
            content: [{ type: "text", text }],
          }),
        );
      };
      if (delay > 0) setTimeout(answer, delay);
      else answer();
    });
  })
  .listen(Number(process.env.MOCK_AI_PORT ?? 4011), () => console.log(`mock on ${process.env.MOCK_AI_PORT ?? 4011}`));
