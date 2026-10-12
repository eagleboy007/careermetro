import { beforeEach, describe, expect, it, vi } from "vitest";

// Corporate's server actions: who is signed in, what reaches the store, and the words that come back.
const m = vi.hoisted(() => ({
  account: null as { id: string } | null,
  refresh: vi.fn(),
  store: {
    startCompanySignup: vi.fn(),
    finishCompanySignup: vi.fn(),
    requestAccess: vi.fn(),
    saveCompanyPage: vi.fn(),
    inviteMember: vi.fn(),
    cancelInvite: vi.fn(),
    answerRequest: vi.fn(),
    removeMember: vi.fn(),
    startJoin: vi.fn(),
    finishJoin: vi.fn(),
  },
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => m.account }));
vi.mock("@/lib/corporate/store", async () => {
  const { DOMAIN_TAKEN_TEXT, SIGNUP_CLOSED_TEXT } = await import("@/lib/schemas/constants");
  return {
    ...m.store,
    CORPORATE_ERROR_TEXT: { taken: DOMAIN_TAKEN_TEXT, closed: SIGNUP_CLOSED_TEXT, keep_two_admins: "Keep at least two Recruiter admins. Add another admin first.", not_admin: "Only a Recruiter admin can do that." },
  };
});

import {
  askForAccessAction,
  finishJoinAction,
  finishSignupAction,
  inviteAction,
  inviteSecondAdminAction,
  removeMemberAction,
  startJoinAction,
  startSignupAction,
} from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const details = { type: "company" as const, legalName: "Example Labs Private Limited", name: "Example Labs", website: "example-labs.test", workEmail: "meera@example-labs.test", size: "51 to 200", city: "Pune" };

beforeEach(() => {
  vi.clearAllMocks();
  m.account = { id: ME };
});

describe("corporate actions", () => {
  it("ask a signed-out visitor to sign in, and touch nothing", async () => {
    m.account = null;
    expect(await startSignupAction(details)).toEqual({ ok: false, error: "Please sign in again." });
    expect(await finishSignupAction(details, "123456")).toEqual({ ok: false, error: "Please sign in again." });
    expect(await inviteAction("x@example-labs.test", "hiring")).toBe("Please sign in again.");
    expect(await removeMemberAction(ME)).toBe("Please sign in again.");
    expect(await startJoinAction("x@example-labs.test")).toEqual({ ok: false, error: "Please sign in again." });
    for (const fn of Object.values(m.store)) expect(fn).not.toHaveBeenCalled();
  });

  it("pass the signed-in person's id, never one from the browser, with the raw input for the store to check", async () => {
    m.store.startCompanySignup.mockResolvedValueOnce({ ok: true, testCode: "042917" });
    expect(await startSignupAction(details)).toEqual({ ok: true, testCode: "042917" });
    expect(m.store.startCompanySignup).toHaveBeenCalledWith(ME, details);
    m.store.startCompanySignup.mockResolvedValueOnce({ ok: true });
    expect(await startSignupAction(details)).toEqual({ ok: true });
  });

  it("say a domain is taken without naming anyone, and flag it so the form offers Ask for access", async () => {
    m.store.startCompanySignup.mockResolvedValueOnce({ ok: false, error: "taken" });
    expect(await startSignupAction(details)).toEqual({ ok: false, error: "This company is already on CareerMetro. Ask one of its Recruiter admins to add you.", taken: true });
    m.store.startCompanySignup.mockResolvedValueOnce({ ok: false, error: "closed" });
    expect(await startSignupAction(details)).toEqual({ ok: false, error: "Company sign-up opens soon." });
    m.store.startCompanySignup.mockResolvedValueOnce({ ok: false, error: "invalid", message: "Use your work email at the company." });
    expect(await startSignupAction(details)).toEqual({ ok: false, error: "Use your work email at the company." });
    m.store.requestAccess.mockResolvedValueOnce({ ok: true });
    expect(await askForAccessAction("rahul@example-labs.test")).toEqual({ ok: true });
    expect(m.store.requestAccess).toHaveBeenCalledWith(ME, { workEmail: "rahul@example-labs.test" });
  });

  it("make the company without reloading the page, so the form can go on to the company page step", async () => {
    m.store.finishCompanySignup.mockResolvedValueOnce({ ok: true, orgId: "o1" });
    expect(await finishSignupAction(details, "123456")).toEqual({ ok: true });
    expect(m.store.finishCompanySignup).toHaveBeenCalledWith(ME, { details, code: "123456" });
    m.store.inviteMember.mockResolvedValueOnce({ ok: true });
    expect(await inviteSecondAdminAction("karan@example-labs.test")).toBeNull();
    expect(m.store.inviteMember).toHaveBeenCalledWith(ME, { workEmail: "karan@example-labs.test", role: "admin" });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("reload Team and access after a change, and only after one that worked", async () => {
    m.store.inviteMember.mockResolvedValueOnce({ ok: true });
    expect(await inviteAction("rahul@example-labs.test", "hiring")).toBeNull();
    expect(m.refresh).toHaveBeenCalledTimes(1);
    m.store.removeMember.mockResolvedValueOnce({ ok: false, error: "keep_two_admins" });
    expect(await removeMemberAction(ME)).toBe("Keep at least two Recruiter admins. Add another admin first.");
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("switch a role on with the code, then reload Corporate", async () => {
    m.store.startJoin.mockResolvedValueOnce({ ok: true, testCode: "111222" });
    expect(await startJoinAction("rahul@example-labs.test")).toEqual({ ok: true, testCode: "111222" });
    m.store.finishJoin.mockResolvedValueOnce({ ok: true, orgId: "o1" });
    expect(await finishJoinAction("rahul@example-labs.test", "111222")).toEqual({ ok: true });
    expect(m.store.finishJoin).toHaveBeenCalledWith(ME, { workEmail: "rahul@example-labs.test", code: "111222" });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });
});
