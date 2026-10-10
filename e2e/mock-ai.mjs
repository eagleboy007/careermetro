// A stand-in for the Claude API in end-to-end runs: the parse call gets a fixed profile of the synthetic fixture
// resume, and every other call gets text that fails its schema, so the app's plain-code fallbacks are used.
import http from "node:http";
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
  certifications: ["Google Data Analytics Professional Certificate"],
};
let n = 0;
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      n++;
      const j = JSON.parse(body || "{}");
      const sys = typeof j.system === "string" ? j.system : JSON.stringify(j.system ?? "");
      const isParse = /resume/i.test(sys) && /<resume|resume_text|wrap/i.test(JSON.stringify(j.messages));
      const text = isParse ? JSON.stringify(profile) : "not json";
      console.log(n, req.url, isParse ? "parse" : "other", sys.slice(0, 60).replace(/\n/g, " "));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_" + n,
          type: "message",
          role: "assistant",
          model: j.model,
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 300 },
          content: [{ type: "text", text }],
        }),
      );
    });
  })
  .listen(Number(process.env.MOCK_AI_PORT ?? 4011), () => console.log("mock on 4011"));
