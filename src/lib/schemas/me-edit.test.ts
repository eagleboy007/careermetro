import { describe, expect, it } from "vitest";
import { hasContactOrLink, hasLink, interestKey } from "@/lib/me/text";
import {
  interestExport,
  interestInput,
  interestRemoveInput,
  meEducationExport,
  meEducationInput,
  meRoleExport,
  meRoleInput,
  storyExport,
  storyInput,
} from "@/lib/schemas";
import { INTERESTS_MAX, ME_CONTACT_TEXT, ME_EDITS_PER_DAY, ME_EDUCATION_MAX, ME_ROLES_MAX, STORIES_MAX } from "@/lib/schemas/constants";

// Me editing (docs/plans/me-editing-plan.md). Every name, company and story here is made up.
const role = { title: "IT Support Engineer", employer: "Konkan Co-operative Bank", startMonth: "2023-06", endMonth: null, isCurrent: true };
const story = {
  title: "Cut missed phishing alerts",
  where: "Konkan Co-operative Bank · 2025",
  situation: "Alerts were piling up.",
  task: "I owned the morning triage.",
  action: "I sorted alerts by sender domain and wrote a checklist.",
  result: "Missed alerts fell from 9 a week to 1.",
  boxes: ["Problem solving", "Ownership"],
  goalId: null,
};
const message = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe("the caps and the daily limit", () => {
  it("are the plan's", () => {
    expect([ME_ROLES_MAX, ME_EDUCATION_MAX, STORIES_MAX, INTERESTS_MAX, ME_EDITS_PER_DAY]).toEqual([20, 12, 50, 30, 100]);
    expect(ME_CONTACT_TEXT).toBe("Leave out email addresses, phone numbers and links.");
  });
});

describe("contact details and links", () => {
  it("are found in text others read", () => {
    for (const bad of ["Write to priya.n@example.test", "Call 98765 43210", "See https://example.test/cv", "www.example.test", "bit.ly/abc", "wa.me/919876543210", "priya.in"])
      expect(hasContactOrLink(bad)).toBe(true);
  });

  it("leave tech names with a dot alone", () => {
    for (const ok of ["Node.js and Vue.js", "ASP.NET Core", "Closed 40 alerts a week in 2025", "B.Tech, 2021 to 2024", "e.g. Photography"]) expect(hasContactOrLink(ok)).toBe(false);
    expect(hasLink("Next.js")).toBe(false);
  });
});

describe("meRoleInput", () => {
  it("takes a current role and an ended one, trimmed", () => {
    expect(meRoleInput.parse({ ...role, title: "  IT   Support Engineer " })).toEqual(role);
    expect(meRoleInput.safeParse({ ...role, endMonth: "2024-02", isCurrent: false }).success).toBe(true);
    expect(meRoleInput.safeParse({ ...role, startMonth: "2024-02", endMonth: "2024-02", isCurrent: false }).success).toBe(true);
  });

  it("keeps the months in order and the end empty only while current", () => {
    expect(message(meRoleInput.safeParse({ ...role, endMonth: "2023-05", isCurrent: false }))).toBe("It can't end before it started.");
    expect(message(meRoleInput.safeParse({ ...role, endMonth: "2024-01" }))).toBe("Leave the end empty while you work here.");
    expect(message(meRoleInput.safeParse({ ...role, isCurrent: false }))).toBe("Pick when it ended, or tick I work here now.");
    for (const bad of ["2023-13", "2023-6", "23-06", "2023-00", ""]) expect(meRoleInput.safeParse({ ...role, startMonth: bad }).success).toBe(false);
  });

  it("refuses empty or long text, contact details, links and extra fields", () => {
    expect(message(meRoleInput.safeParse({ ...role, title: "   " }))).toBe("Add the job title.");
    expect(message(meRoleInput.safeParse({ ...role, employer: "" }))).toBe("Add the company.");
    expect(meRoleInput.safeParse({ ...role, title: "x".repeat(120) }).success).toBe(true);
    expect(message(meRoleInput.safeParse({ ...role, title: "x".repeat(121) }))).toBe("At most 120 characters.");
    expect(message(meRoleInput.safeParse({ ...role, employer: "Call 98765 43210" }))).toBe(ME_CONTACT_TEXT);
    expect(message(meRoleInput.safeParse({ ...role, employer: "konkan.in" }))).toBe(ME_CONTACT_TEXT);
    expect(meRoleInput.safeParse({ ...role, userId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
  });
});

describe("meEducationInput", () => {
  it("takes a free-text year, or none", () => {
    expect(meEducationInput.parse({ qualification: "B.Sc. IT", institution: "Mumbai University", year: "2021 to 2024" })).toEqual({
      qualification: "B.Sc. IT",
      institution: "Mumbai University",
      year: "2021 to 2024",
    });
    expect(meEducationInput.parse({ qualification: "B.Sc. IT", institution: "Mumbai University", year: "  " }).year).toBeNull();
  });

  it("refuses long text, contact details and extra fields", () => {
    const edu = { qualification: "B.Sc. IT", institution: "Mumbai University", year: "" };
    expect(meEducationInput.safeParse({ ...edu, qualification: "x".repeat(160) }).success).toBe(true);
    expect(meEducationInput.safeParse({ ...edu, qualification: "x".repeat(161) }).success).toBe(false);
    expect(meEducationInput.safeParse({ ...edu, year: "x".repeat(41) }).success).toBe(false);
    expect(message(meEducationInput.safeParse({ ...edu, institution: "www.example.test" }))).toBe(ME_CONTACT_TEXT);
    expect(meEducationInput.safeParse({ ...edu, source: "resume" }).success).toBe(false);
  });
});

describe("storyInput", () => {
  it("takes a story, keeps the boxes in board order and line breaks in the parts", () => {
    const out = storyInput.parse({ ...story, action: "I sorted alerts.\r\n\r\n\r\nThen   I wrote a checklist." });
    expect(out.boxes).toEqual(["Ownership", "Problem solving"]);
    expect(out.action).toBe("I sorted alerts.\n\nThen I wrote a checklist.");
    expect(storyInput.parse({ ...story, where: "", situation: "", task: "", action: "", result: "" }).where).toBe("");
  });

  it("needs a title and at least one box", () => {
    expect(message(storyInput.safeParse({ ...story, title: " " }))).toBe("Add a title.");
    expect(message(storyInput.safeParse({ ...story, boxes: [] }))).toBe("Pick at least one box.");
    expect(storyInput.safeParse({ ...story, boxes: ["Leadership"] }).success).toBe(false);
  });

  it("caps each part at 400 characters and refuses contact details and links", () => {
    expect(storyInput.safeParse({ ...story, result: "x".repeat(400) }).success).toBe(true);
    expect(message(storyInput.safeParse({ ...story, result: "x".repeat(401) }))).toBe("At most 400 characters.");
    expect(message(storyInput.safeParse({ ...story, task: "Mail me at priya.n@example.test" }))).toBe(ME_CONTACT_TEXT);
    expect(message(storyInput.safeParse({ ...story, title: "See bit.ly/abc" }))).toBe(ME_CONTACT_TEXT);
  });

  it("takes a goal id or null, and nothing else", () => {
    expect(storyInput.safeParse({ ...story, goalId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(storyInput.safeParse({ ...story, goalId: "goal-1" }).success).toBe(false);
    expect(storyInput.safeParse({ ...story, source: "resume" }).success).toBe(false);
  });
});

describe("interests", () => {
  it("are kept as typed and compared by key", () => {
    expect(interestInput.parse({ name: "  Public   Speaking " })).toEqual({ name: "Public Speaking" });
    expect(interestKey("  Public   Speaking ")).toBe("public speaking");
    expect(interestRemoveInput.parse({ name: "Public Speaking" })).toEqual({ name: "public speaking" });
  });

  it("refuses empty, long or contact text", () => {
    expect(message(interestInput.safeParse({ name: " " }))).toBe("Type an interest first.");
    expect(interestInput.safeParse({ name: "x".repeat(40) }).success).toBe(true);
    expect(interestInput.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(message(interestInput.safeParse({ name: "insta.me/priya" }))).toBe(ME_CONTACT_TEXT);
  });
});

describe("the export v28 shape", () => {
  it("holds what the person added, with no ids", () => {
    const at = "2026-10-20T09:00:00.000Z";
    expect(meRoleExport.parse({ ...role, created_at: at, updated_at: at })).not.toHaveProperty("id");
    expect(meEducationExport.safeParse({ qualification: "B.Sc. IT", institution: "Mumbai University", year: null, created_at: at, updated_at: at }).success).toBe(true);
    expect(storyExport.safeParse({ ...story, goalSkill: "SIEM", source: "user", created_at: at, updated_at: at }).success).toBe(true);
    expect(storyExport.safeParse({ ...story, goalSkill: null, source: "model", created_at: at, updated_at: at }).success).toBe(false);
    expect(interestExport.safeParse({ name: "Photography", created_at: at }).success).toBe(true);
  });
});
