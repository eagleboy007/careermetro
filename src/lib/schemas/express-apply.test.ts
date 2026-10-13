import { describe, expect, it } from "vitest";
import { applicationNote, applicationPacket, applyInput, jobCriteria, jobInput, previewInput } from "@/lib/schemas";

/* Express apply (pending item 16; dev/express-apply-plan.md): the job's criteria, the note and the packet. */

const JOB = "1c9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a70";
const req = { required: ["siem", "linux"], oneOf: [["python", "bash-scripting"]], nice: ["digital-forensics"] };
const job = { roleSlug: "cyber-security-analyst", title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req };

const packet = {
  profile: {
    name: "Priya Nair",
    headline: "Working at Konkan Co-operative Bank",
    experience: [{ title: "IT security analyst", employer: "Konkan Co-operative Bank", dates: "Jun 2023 to now" }],
    education: [{ qualification: "B.Sc. IT", institution: "Pune University", year: "2023" }],
    certifications: ["CompTIA Security+"],
  },
  match: { lines: [{ label: "SIEM", state: "proved", group: "required" }], requiredProved: 1, requiredOnResume: 0, requiredTotal: 1 },
  criteria: { lines: [{ kind: "skill", label: "SIEM", met: true }], met: 1, total: 1 },
};

describe("job criteria", () => {
  it("default to none, so older jobs and forms without them still save", () => {
    expect(jobInput.parse(job).criteria).toEqual({ verifiedSkills: [], certificates: [] });
  });

  it("take verified skills from the job's Required skills only", () => {
    expect(jobInput.parse({ ...job, criteria: { verifiedSkills: ["siem"], certificates: [] } }).criteria.verifiedSkills).toEqual(["siem"]);
    for (const skill of ["python", "digital-forensics", "networking-basics"]) {
      const r = jobInput.safeParse({ ...job, criteria: { verifiedSkills: [skill], certificates: [] } });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toBe("Ask for proof only of the job's required skills.");
    }
  });

  it("take at most 3 certificates by id, each once, never free text", () => {
    expect(jobCriteria.safeParse({ verifiedSkills: [], certificates: ["comptia-security-plus"] }).success).toBe(true);
    expect(jobCriteria.safeParse({ verifiedSkills: [], certificates: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(jobCriteria.safeParse({ verifiedSkills: [], certificates: ["a", "a"] }).success).toBe(false);
    expect(jobCriteria.safeParse({ verifiedSkills: ["siem", "siem"], certificates: [] }).success).toBe(false);
    expect(jobCriteria.safeParse({ verifiedSkills: [], certificates: ["Security+ please"] }).error?.issues[0].message).toBe("Pick certificates from the list.");
  });

  it("have no DigiLocker, notice period or gaps-allowed fields", () => {
    const parsed = jobCriteria.parse({ verifiedSkills: [], certificates: [], digilocker: true, noticeDays: 30, gapsAllowed: 2 });
    expect(Object.keys(parsed).sort()).toEqual(["certificates", "verifiedSkills"]);
  });
});

describe("the note", () => {
  it("is optional, trimmed, single-spaced, and keeps at most one blank line", () => {
    expect(applyInput.parse({ jobId: JOB, canJoin: "30", consent: true }).note).toBe("");
    expect(applicationNote.parse("  I run   SIEM triage\r\n\r\n\r\n\r\nat the bank.  ")).toBe("I run SIEM triage\n\nat the bank.");
  });

  it("is capped at 300 characters", () => {
    expect(applicationNote.safeParse("x".repeat(300)).success).toBe(true);
    const r = applicationNote.safeParse("x".repeat(301));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/300 characters/);
    // Spaces trimmed away don't count.
    expect(applicationNote.safeParse(`  ${"x".repeat(300)}  `).success).toBe(true);
  });

  it("refuses email addresses and phone numbers, as the headline does", () => {
    for (const bad of ["Write to priya.n@example.test", "Call 98765 43210", "WhatsApp +91-98765-43210 any time"]) {
      const r = applyInput.safeParse({ jobId: JOB, canJoin: "now", consent: true, note: bad });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toMatch(/Leave out email addresses and phone numbers/);
    }
    expect(applicationNote.safeParse("I closed 40 SIEM alerts a week in 2025 and wrote 3 runbooks.").success).toBe(true);
  });
});

describe("the preview and the packet", () => {
  it("previews one job by id", () => {
    expect(previewInput.safeParse({ jobId: JOB }).success).toBe(true);
    expect(previewInput.safeParse({ jobId: "job-1" }).success).toBe(false);
  });

  it("take the public profile, Match to this job and the criteria, and nothing else", () => {
    expect(applicationPacket.parse(packet)).toEqual(packet);
  });

  it.each([
    ["gaps", { gaps: [{ skill: "SIEM", status: "missing" }] }],
    ["path", { path: [{ step: 1 }] }],
    ["goals", { goals: ["siem"] }],
    ["pay", { pay: 4.2 }],
    ["notice period", { noticeDays: 90 }],
  ])("refuse a packet carrying %s", (_, extra) => {
    expect(applicationPacket.safeParse({ ...packet, ...extra }).success).toBe(false);
  });

  it.each([
    ["email", { email: "priya@example.test" }],
    ["phone", { phone: "+91 98765 43210" }],
    ["resume lines", { lines: ["Ran SIEM triage for 40 branches"] }],
  ])("refuse a profile carrying %s", (_, extra) => {
    expect(applicationPacket.safeParse({ ...packet, profile: { ...packet.profile, ...extra } }).success).toBe(false);
  });

  it("refuse resume lines under a job", () => {
    const experience = [{ ...packet.profile.experience[0], bullets: ["Ran SIEM triage"] }];
    expect(applicationPacket.safeParse({ ...packet, profile: { ...packet.profile, experience } }).success).toBe(false);
  });

  it("refuse evidence on a match line or a criterion", () => {
    const match = { ...packet.match, lines: [{ ...packet.match.lines[0], evidence: "Ran SIEM triage" }] };
    expect(applicationPacket.safeParse({ ...packet, match }).success).toBe(false);
    const criteria = { ...packet.criteria, lines: [{ ...packet.criteria.lines[0], proofFile: "proofs/x.pdf" }] };
    expect(applicationPacket.safeParse({ ...packet, criteria }).success).toBe(false);
  });
});
