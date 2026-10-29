import { describe, expect, it } from "vitest";
import { weeklyEmail, weeklySubject, weeklyView, type WeeklyJob } from "./weekly";

// Monday 26 Oct 2026, 08:30 IST.
const MONDAY = new Date("2026-10-26T03:00:00Z");
const ist = (s: string) => new Date(`${s}+05:30`);

let n = 0;
const job = (over: Partial<WeeklyJob>): WeeklyJob => ({
  ref: { kind: "check", checkId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` },
  company: "Zephyr Pay",
  title: "SOC Analyst",
  status: "applied",
  statusAt: ist("2026-10-12T10:00"),
  appliedAt: ist("2026-10-12T10:00"),
  interviewAt: null,
  open: [],
  only: [],
  ...over,
});

describe("the weekly My jobs email: what goes in", () => {
  it("waits 7 India days from the last status change", () => {
    const six = job({ statusAt: ist("2026-10-20T23:59"), appliedAt: ist("2026-10-20T23:59") });
    const seven = job({ title: "Data Analyst", statusAt: ist("2026-10-19T00:01"), appliedAt: ist("2026-10-19T00:01") });
    const view = weeklyView([six, seven], MONDAY)!;
    expect(view.waiting.map((w) => w.title)).toEqual(["Data Analyst"]);
    expect(view.waiting[0]!.line).toBe("Applied 19 Oct · 7 days, no word yet");
    expect(view.waiting[0]!.href).toBe("/departures?tab=mine");
  });

  it("counts Heard back from when it was heard, and leaves out Saved and closed jobs", () => {
    const heard = job({ status: "heard", statusAt: ist("2026-10-15T09:00"), appliedAt: ist("2026-10-01T09:00") });
    const view = weeklyView([heard, job({ status: "saved" }), job({ status: "no" }), job({ status: "withdrawn" })], MONDAY)!;
    expect(view.waiting).toEqual([{ company: "Zephyr Pay", title: "SOC Analyst", line: "Heard back 15 Oct · 11 days, nothing since", href: "/departures?tab=mine" }]);
  });

  it("takes interviews from now to Sunday 23:59 IST, not next Monday 00:00", () => {
    const sunday = job({ status: "interview", title: "Sunday", interviewAt: ist("2026-11-01T23:59") });
    const nextMonday = job({ status: "interview", title: "Next Monday", interviewAt: ist("2026-11-02T00:00") });
    const passed = job({ status: "offer", title: "Passed", interviewAt: ist("2026-10-26T08:00") });
    const thursday = job({ status: "offer", title: "Thursday", interviewAt: ist("2026-10-29T10:30") });
    const view = weeklyView([sunday, nextMonday, passed, thursday], MONDAY)!;
    expect(view.interviews.map((i) => i.title)).toEqual(["Thursday", "Sunday"]);
    expect(view.interviews[0]).toMatchObject({ when: "Thu 29 Oct, 10:30 IST", link: "Practise" });
    expect(view.interviews[0]!.href).toMatch(/^\/practice\?job=check%3A/);
    expect(weeklyView([thursday], MONDAY, { elite: true })!.interviews[0]).toMatchObject({ link: "Mock interview", href: expect.stringMatching(/^\/mock\?tab=interview&job=/) });
  });

  it("is empty, so no email, when nothing is waiting a week and no interview is coming", () => {
    expect(weeklyView([], MONDAY)).toBeNull();
    expect(weeklyView([job({ statusAt: ist("2026-10-24T10:00") }), job({ status: "saved" }), job({ status: "interview", interviewAt: null })], MONDAY)).toBeNull();
  });

  it("picks three skills: the most asked open ones, then one only a job asks for, in a stable order", () => {
    const a = job({ title: "A", open: ["SIEM", "Threat detection"], only: ["KQL"] });
    const b = job({ title: "B", open: ["SIEM", "Python"], only: ["Splunk"] });
    const view = weeklyView([a, b], MONDAY)!;
    expect(view.skills).toEqual(["SIEM", "Python", "KQL"]);
    expect(view.skillsLine).toBe("A at Zephyr Pay and B at Zephyr Pay ask for them.");
    expect(weeklyView([b, a], MONDAY)!.skills).toEqual(view.skills);
    // Fewer than three: as many as there are.
    expect(weeklyView([job({ open: ["SQL"] })], MONDAY)!.skills).toEqual(["SQL"]);
    expect(weeklyView([job({ open: ["SQL"] })], MONDAY)!.skillsLine).toBe("SOC Analyst at Zephyr Pay asks for it.");
    expect(weeklyView([job({ only: ["KQL", "Splunk"] })], MONDAY)!.skills).toEqual(["KQL", "Splunk"]);
    expect(weeklyView([job({})], MONDAY)!.skills).toEqual([]);
  });

  it("keeps at most 10 waiting and 7 interviews", () => {
    const many = Array.from({ length: 12 }, (_, i) => job({ title: `W${i}` }));
    const talks = Array.from({ length: 9 }, (_, i) => job({ status: "interview", title: `I${i}`, interviewAt: ist(`2026-10-2${7 + (i % 3)}T1${i}:00`) }));
    const view = weeklyView([...many, ...talks], MONDAY)!;
    expect(view.waiting).toHaveLength(10);
    expect(view.interviews).toHaveLength(7);
  });
});

describe("the weekly My jobs email: the words", () => {
  it("says the parts that apply in the subject", () => {
    const waiting = job({ title: "W" });
    const thu = job({ status: "interview", title: "T", interviewAt: ist("2026-10-29T10:30") });
    const fri = job({ status: "interview", title: "F", interviewAt: ist("2026-10-30T10:30") });
    expect(weeklySubject(weeklyView([waiting, job({ title: "W2" }), thu], MONDAY)!)).toBe("2 jobs waiting on a reply, 1 interview Thursday");
    expect(weeklySubject(weeklyView([waiting], MONDAY)!)).toBe("1 job waiting on a reply");
    expect(weeklySubject(weeklyView([thu, fri], MONDAY)!)).toBe("2 interviews this week");
  });

  it("names company and title only: never a note, the job text or the posting's link", () => {
    const view = weeklyView([job({ open: ["SIEM"] }), job({ status: "interview", title: "Data Analyst", company: "Acme", interviewAt: ist("2026-10-29T10:30") })], MONDAY)!;
    const email = weeklyEmail(view, { name: "Priya", site: "https://careermetro.test", offUrl: "https://careermetro.test/api/email/off?t=abc" });
    expect(email.text).toContain("Priya, your week on My jobs.");
    expect(email.text).toContain("SOC Analyst, Zephyr Pay");
    expect(email.text).toContain("Update status: https://careermetro.test/departures?tab=mine");
    expect(email.text).toContain("Turn it off (no sign-in): https://careermetro.test/api/email/off?t=abc");
    expect(email.text).toContain("Nothing here about your chances: that is for you and the company.");
    expect(email.html).toContain("And three skills worth an hour this week.");
    expect(email.html).not.toMatch(/var\(--/);
    // The view carries nothing but these fields, so nothing else can reach the email.
    for (const w of view.waiting) expect(Object.keys(w).sort()).toEqual(["company", "href", "line", "title"]);
    for (const i of view.interviews) expect(Object.keys(i).sort()).toEqual(["company", "href", "link", "title", "when"]);
    expect(email.text).not.toMatch(/\d\s?%|chance of|likely/i);
  });

  it("escapes what the person typed in the HTML", () => {
    const view = weeklyView([job({ company: "<script>x</script> & Co" })], MONDAY)!;
    const email = weeklyEmail(view, { name: null, site: "https://careermetro.test", offUrl: "https://careermetro.test/api/email/off?t=abc" });
    expect(email.html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; Co");
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("Your week on My jobs.");
  });
});
