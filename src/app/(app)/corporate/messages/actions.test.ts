import { beforeEach, describe, expect, it, vi } from "vitest";

// Corporate Messages' server action: who is signed in, what reaches the store, and the words that come back.
const m = vi.hoisted(() => ({
  account: null as { id: string } | null,
  refresh: vi.fn(),
  send: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => m.account }));
vi.mock("@/lib/corporate/chats-store", () => ({
  sendCompanyMessage: m.send,
  COMPANY_CHAT_ERROR_TEXT: { read_only: "Interviewers can read their candidates' chats but not send in them.", closed: "This chat is closed." },
}));

import { sendCompanyMessageAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const APP = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";

beforeEach(() => {
  vi.clearAllMocks();
  m.account = { id: ME };
});

describe("sendCompanyMessageAction", () => {
  it("asks a signed-out visitor to sign in and sends nothing", async () => {
    m.account = null;
    expect(await sendCompanyMessageAction(APP, "Hello", false)).toBe("Please sign in again.");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("passes the signed-in person's id, the application, the text and whether it is a question, then refreshes", async () => {
    m.send.mockResolvedValue({ ok: true, messageId: "x" });
    expect(await sendCompanyMessageAction(APP, "Which SIEM have you used?", true)).toBeNull();
    expect(m.send).toHaveBeenCalledWith(ME, { applicationId: APP, body: "Which SIEM have you used?", question: true });
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("answers a refusal in words and doesn't refresh", async () => {
    m.send.mockResolvedValue({ ok: false, error: "read_only" });
    expect(await sendCompanyMessageAction(APP, "Hello", false)).toBe("Interviewers can read their candidates' chats but not send in them.");
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
