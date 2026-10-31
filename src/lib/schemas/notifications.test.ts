import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, SYSTEM_NOTIFICATION_KINDS } from "./constants";
import { notificationExport, notificationView, notifyInput, openNotificationsInput } from "./notifications";
import { NOTIFICATION_REF } from "@/lib/notifications/rules";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const R = "00000000-0000-4000-8000-00000000000c";

describe("notifyInput", () => {
  it("takes each kind with exactly the reference it needs", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const ref = NOTIFICATION_REF[kind];
      const system = (SYSTEM_NOTIFICATION_KINDS as readonly string[]).includes(kind);
      expect(notifyInput.safeParse({ kind, userId: A, ...(system ? {} : { actorId: B }), [ref]: R }).success).toBe(true);
      // CareerMetro's own notices never carry an actor, so no admin or reporter is ever named.
      if (system) expect(notifyInput.safeParse({ kind, userId: A, actorId: B, [ref]: R }).success).toBe(false);
    }
  });

  it("holds Junction's references only on Junction's kinds", () => {
    expect(notifyInput.safeParse({ kind: "junction_comment", userId: A, actorId: B }).success).toBe(false);
    expect(notifyInput.safeParse({ kind: "junction_post_hidden", userId: A, commentId: R }).success).toBe(false);
    expect(notifyInput.safeParse({ kind: "connection_request", userId: A, actorId: B, connectionRequestId: R, postId: R }).success).toBe(false);
  });

  it("refuses a missing, wrong or extra reference, and an unknown kind", () => {
    expect(notifyInput.safeParse({ kind: "connection_request", userId: A, actorId: B }).success).toBe(false);
    expect(notifyInput.safeParse({ kind: "connection_request", userId: A, actorId: B, applicationId: R }).success).toBe(false);
    expect(notifyInput.safeParse({ kind: "application_moved", userId: A, actorId: B, applicationId: R, interviewId: R }).success).toBe(false);
    expect(notifyInput.safeParse({ kind: "message", userId: A, actorId: B, connectionRequestId: R }).success).toBe(false);
    expect(notifyInput.safeParse({ kind: "interview_scheduled", userId: "me", actorId: B, interviewId: R }).success).toBe(false);
  });
});

describe("notificationView", () => {
  const row = { id: A, kind: "connection_request", text: "Ravi Menon asked to connect.", href: "/network?tab=requests", when: "2 h ago", isNew: true };

  it("is strict: nothing but the sentence, its link and time", () => {
    expect(notificationView.parse(row)).toEqual(row);
    expect(notificationView.safeParse({ ...row, actorId: B }).success).toBe(false);
    expect(notificationView.safeParse({ ...row, email: "ravi@example.com" }).success).toBe(false);
  });

  it("links only inside the app", () => {
    expect(notificationView.safeParse({ ...row, href: "/u/ravi-menon" }).success).toBe(true);
    expect(notificationView.safeParse({ ...row, href: "https://example.com" }).success).toBe(false);
    expect(notificationView.safeParse({ ...row, href: "//example.com" }).success).toBe(false);
  });
});

describe("openNotificationsInput", () => {
  it("takes nothing", () => {
    expect(openNotificationsInput.safeParse({}).success).toBe(true);
    expect(openNotificationsInput.safeParse({ userId: A }).success).toBe(false);
  });
});

describe("the export v29 shape", () => {
  it("holds the kind and dates, with company and job only where they apply, and no names or ids", () => {
    const at = "2026-10-20T09:00:00.000Z";
    expect(notificationExport.safeParse({ kind: "application_moved", created_at: at, read_at: null, company: "Example Labs", job: "SOC Analyst L1" }).success).toBe(true);
    expect(notificationExport.safeParse({ kind: "connection_request", created_at: at, read_at: at }).success).toBe(true);
    expect(notificationExport.safeParse({ kind: "connection_request", created_at: at, read_at: at, name: "Ravi Menon" }).success).toBe(false);
    expect(notificationExport.safeParse({ kind: "connection_request", created_at: at, read_at: at, id: A }).success).toBe(false);
  });
});
