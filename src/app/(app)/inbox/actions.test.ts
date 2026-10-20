import { beforeEach, describe, expect, it, vi } from "vitest";

// The Inbox's End chat action (FR-52): who is signed in, what reaches the store, and the words that come back.
const m = vi.hoisted(() => ({
  account: null as { id: string } | null,
  refresh: vi.fn(),
  end: vi.fn(),
  report: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => m.account }));
vi.mock("@/lib/inbox/store", () => ({
  endFoundChat: m.end,
  report: m.report,
  acceptRequest: vi.fn(),
  deleteRequest: vi.fn(),
  markRead: vi.fn(),
  sendMessage: vi.fn(),
  INBOX_ERROR_TEXT: { not_found: "That chat isn't available." },
}));
vi.mock("@/lib/corporate/interviews-store", () => ({ INTERVIEW_ERROR_TEXT: {}, offerTimes: vi.fn() }));
vi.mock("@/lib/account/availability-store", () => ({ AVAILABILITY_MESSAGES: {}, saveUsuallyFree: vi.fn() }));

import { endInboxChat } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const CHAT = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";

beforeEach(() => {
  vi.clearAllMocks();
  m.account = { id: ME };
});

describe("endInboxChat", () => {
  it("refuses an id that isn't a chat id before reading the session", async () => {
    expect(await endInboxChat("not-a-uuid")).toBe("That didn't work. Please try again.");
    expect(m.end).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in and ends nothing", async () => {
    m.account = null;
    expect(await endInboxChat(CHAT)).toBe("Please sign in again.");
    expect(m.end).not.toHaveBeenCalled();
  });

  it("ends the chat for the signed-in person, files no report, then refreshes", async () => {
    m.end.mockResolvedValue({ ok: true });
    expect(await endInboxChat(CHAT)).toBeNull();
    expect(m.end).toHaveBeenCalledWith(ME, CHAT);
    expect(m.report).not.toHaveBeenCalled();
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("answers a refusal in words and doesn't refresh", async () => {
    m.end.mockResolvedValue({ ok: false, error: "not_found" });
    expect(await endInboxChat(CHAT)).toBe("That chat isn't available.");
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
