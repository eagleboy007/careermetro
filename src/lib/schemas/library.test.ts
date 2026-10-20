import { describe, expect, it } from "vitest";
import { cleanSuggestedUrl, linkKey } from "@/lib/library/links";
import {
  brokenLinkRow,
  libraryActionInput,
  libraryExport,
  resourceDecisionInput,
  resourceReportExport,
  resourceReportInput,
  resourceSuggestionExport,
  suggestionDecisionInput,
  suggestionInput,
  suggestionRow,
} from "@/lib/schemas";

// Library part 2 (docs/plans/library-part-2-plan.md): what the browser may send, and what the admin page and the
// download hold. Every link here is made up or a public documentation page.
const ID = "6f1c2b9e-0000-4000-8000-000000000001";

describe("Library marks, reports and suggestions: input", () => {
  it("takes a resource id, one of the three marks and on or off, and nothing else", () => {
    for (const mark of ["saved", "finished", "onRide"]) expect(libraryActionInput.safeParse({ resourceId: ID, mark, on: true }).success).toBe(true);
    expect(libraryActionInput.safeParse({ resourceId: ID, mark: "liked", on: true }).success).toBe(false);
    expect(libraryActionInput.safeParse({ resourceId: "r1", mark: "saved", on: true }).success).toBe(false);
    expect(libraryActionInput.safeParse({ resourceId: ID, mark: "saved", on: "yes" }).success).toBe(false);
    // The user comes from the session, never the browser.
    expect(libraryActionInput.safeParse({ resourceId: ID, mark: "saved", on: true, userId: ID }).success).toBe(false);
  });

  it("takes a report with a fixed reason and no note", () => {
    for (const reason of ["broken", "not_free", "outdated", "other"]) expect(resourceReportInput.safeParse({ resourceId: ID, reason }).success).toBe(true);
    expect(resourceReportInput.safeParse({ resourceId: ID, reason: "spam" }).success).toBe(false);
    expect(resourceReportInput.safeParse({ resourceId: ID, reason: "broken", note: "The page says 404" }).success).toBe(false);
  });

  it("cleans a suggested link: https, tracking and affiliate parameters stripped, fragment dropped", () => {
    const out = suggestionInput.parse({ url: "  https://Learn.Example.org/sql/intro?utm_source=x&id=7&ref=abc&affid=9&tag=t-21&fbclid=1&gclid=2#part-2 ", skillId: "sql" });
    expect(out).toEqual({ url: { url: "https://learn.example.org/sql/intro?id=7", host: "learn.example.org" }, skillId: "sql" });
    expect(suggestionInput.parse({ url: "https://www.youtube.com/watch?v=abc123", skillId: null }).url.host).toBe("www.youtube.com");
  });

  it("refuses http, user info, ports, IP addresses, localhost, intranet names and anything that isn't a link", () => {
    for (const url of [
      "http://learn.example.org/",
      "https://me:secret@learn.example.org/",
      "https://learn.example.org:8443/",
      "https://127.0.0.1/",
      "https://127.1/",
      "https://0x7f000001/",
      "https://10.0.0.5/admin",
      "https://[::1]/",
      "https://localhost/",
      "https://api.localhost/",
      "https://intranet/",
      "javascript:alert(1)",
      "ftp://files.example.org/",
      "learn.example.org/sql",
      "https://learn.example.org/a b",
      "",
      `https://learn.example.org/${"a".repeat(500)}`,
    ]) {
      expect(cleanSuggestedUrl(url), url).toBeNull();
      expect(suggestionInput.safeParse({ url, skillId: null }).success, url).toBe(false);
    }
    // The skill is a taxonomy id or null for Other; nothing else rides along.
    expect(suggestionInput.safeParse({ url: "https://learn.example.org/", skillId: "SQL basics" }).success).toBe(false);
    expect(suggestionInput.safeParse({ url: "https://learn.example.org/", skillId: null, note: "great course" }).success).toBe(false);
  });

  it("compares links without www, a trailing slash, tracking parameters or the fragment", () => {
    expect(linkKey("https://www.kaggle.com/learn/python/?utm_medium=social#top")).toBe(linkKey("https://kaggle.com/learn/python"));
    expect(linkKey("https://docs.python.org/3/tutorial/")).not.toBe(linkKey("https://docs.python.org/3/library/"));
    expect(linkKey("https://example.org/?id=1")).not.toBe(linkKey("https://example.org/?id=2"));
    expect(linkKey("not a link")).toBeNull();
  });
});

describe("Library review: admin input and rows", () => {
  it("takes hide, show or dismiss on one resource", () => {
    for (const decision of ["hide", "show", "dismiss"]) expect(resourceDecisionInput.safeParse({ resourceId: ID, decision }).success).toBe(true);
    expect(resourceDecisionInput.safeParse({ resourceId: ID, decision: "delete" }).success).toBe(false);
    expect(resourceDecisionInput.safeParse({ resourceId: ID, decision: "hide", adminId: ID }).success).toBe(false);
  });

  it("needs a reason for a decline, and only for a decline", () => {
    expect(suggestionDecisionInput.safeParse({ suggestionId: ID, decision: "accepted", declineReason: null }).success).toBe(true);
    expect(suggestionDecisionInput.safeParse({ suggestionId: ID, decision: "duplicate", declineReason: null }).success).toBe(true);
    for (const reason of ["not_free", "paywall", "affiliate", "off_topic", "other"]) {
      expect(suggestionDecisionInput.safeParse({ suggestionId: ID, decision: "declined", declineReason: reason }).success).toBe(true);
    }
    expect(suggestionDecisionInput.safeParse({ suggestionId: ID, decision: "declined", declineReason: null }).success).toBe(false);
    expect(suggestionDecisionInput.safeParse({ suggestionId: ID, decision: "accepted", declineReason: "affiliate" }).success).toBe(false);
    expect(suggestionDecisionInput.safeParse({ suggestionId: ID, decision: "open", declineReason: null }).success).toBe(false);
  });

  it("reads rows with counts and ids only: no reporter or suggester", () => {
    const row = {
      id: ID,
      title: "The Python Tutorial",
      provider: "Python Software Foundation",
      url: "https://docs.python.org/3/tutorial/",
      counts: { broken: 2, not_free: 0, outdated: 1, other: 0 },
      firstReported: "2026-10-18",
      healthy: false,
      lastChecked: "2026-10-19",
      hidden: false,
    };
    expect(brokenLinkRow.safeParse(row).success).toBe(true);
    expect(brokenLinkRow.safeParse({ ...row, counts: { ...row.counts, spam: 1 } }).success).toBe(false);
    expect(suggestionRow.safeParse({ id: ID, url: "https://learn.example.org/sql", host: "learn.example.org", skill: "SQL", sent: "2026-10-20" }).success).toBe(true);
    expect(suggestionRow.parse({ id: ID, url: "https://learn.example.org/sql", host: "learn.example.org", skill: null, sent: "2026-10-20", userId: ID })).not.toHaveProperty("userId");
  });
});

describe("Download your data, version 27", () => {
  it("holds the marks with titles and links, and reports and suggestions with what a reviewer decided", () => {
    const at = "2026-10-20T06:00:00.000Z";
    expect(libraryExport.safeParse({ saved: [{ title: "Python", url: "https://www.kaggle.com/learn/python", at }], finished: [], onRide: [] }).success).toBe(true);
    expect(libraryExport.safeParse({ saved: [] }).success).toBe(false);
    expect(resourceReportExport.safeParse({ title: "Python", reason: "broken", status: "hidden", created_at: at }).success).toBe(true);
    expect(resourceReportExport.safeParse({ title: "Python", reason: "broken", status: "actioned", created_at: at }).success).toBe(false);
    expect(resourceSuggestionExport.safeParse({ url: "https://learn.example.org/sql", status: "declined", created_at: at }).success).toBe(true);
  });
});
