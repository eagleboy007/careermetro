import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const check = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/proofs/credly-store", () => ({ checkCertificateWithCredly: (...a: unknown[]) => check(...a) }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));
const startJob = vi.fn();
const finishJob = vi.fn();
vi.mock("@/lib/me/job-email-check", () => ({ startJobCheck: (...a: unknown[]) => startJob(...a), finishJobCheck: (...a: unknown[]) => finishJob(...a) }));

const store = vi.hoisted(() => ({
  saveMeRole: vi.fn(),
  deleteMeRole: vi.fn(),
  saveMeEducation: vi.fn(),
  deleteMeEducation: vi.fn(),
  saveStory: vi.fn(),
  deleteStory: vi.fn(),
  addInterest: vi.fn(),
  removeInterest: vi.fn(),
}));
vi.mock("@/lib/me/edit-store", () => ({
  ...store,
  ME_EDIT_MESSAGES: { not_found: "That isn't on your profile any more. Refresh the page to see the latest.", limit: "Try again tomorrow." },
}));

const { checkCertificateOnCredly, confirmJobCheckCode, sendJobCheckCode, saveMeRoleAction, deleteMeRoleAction, saveStoryAction, deleteStoryAction, addInterestAction, removeInterestAction, saveMeEducationAction, deleteMeEducationAction } =
  await import("./actions");
const id = "00000000-0000-4000-8000-0000000c0001";

describe("checkCertificateOnCredly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
  });

  it("checks nothing for a signed-out person or a bad id", async () => {
    account.mockResolvedValue(null);
    expect((await checkCertificateOnCredly(id)).status).toBe("refused");
    account.mockResolvedValue({ id: "u1" });
    expect((await checkCertificateOnCredly({ id })).status).toBe("refused");
    expect(check).not.toHaveBeenCalled();
  });

  it("checks the person's own proof and says what came of it in plain words", async () => {
    check.mockResolvedValueOnce({ status: "verified" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "verified", message: expect.stringMatching(/^Verified with Credly/) });
    expect(check).toHaveBeenCalledWith("u1", id);
    expect(refresh).toHaveBeenCalledTimes(1);
    check.mockResolvedValueOnce({ status: "added", note: "issuer" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "added", message: "Still Added by you. The Credly badge is from a different issuer." });
    check.mockResolvedValueOnce({ status: "held" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "held", message: expect.stringMatching(/review it/) });
    check.mockResolvedValueOnce({ status: "refused", reason: "too_many" });
    expect(await checkCertificateOnCredly(id)).toMatchObject({ status: "refused", message: expect.stringMatching(/tomorrow/) });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("says a badge Credly hasn't confirmed is still pending, an expired one moves to Renew, and another name is refused", async () => {
    check.mockResolvedValueOnce({ status: "pending", note: "unreachable" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "pending", message: expect.stringMatching(/^Check pending, so it doesn't fill the goal yet\. Credly didn't answer/) });
    check.mockResolvedValueOnce({ status: "added", note: "expired" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "added", message: expect.stringMatching(/Renew/) });
    check.mockResolvedValueOnce({ status: "rejected", reason: "name" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "refused", message: expect.stringMatching(/doesn't match your account/) });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("says so when something breaks, logging no id", async () => {
    check.mockRejectedValueOnce(new Error("boom"));
    expect((await checkCertificateOnCredly(id)).status).toBe("refused");
    expect(JSON.stringify(log.mock.calls)).not.toContain(id);
  });
});

describe("work-email check of the current job (FR-47)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
  });

  it("sends nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect((await sendJobCheckCode("meera@garudasec.com")).ok).toBe(false);
    expect((await confirmJobCheckCode("meera@garudasec.com", "123456")).ok).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(finishJob).not.toHaveBeenCalled();
  });

  it("checks for the signed-in person only, refreshes the profile after a right code, and logs nothing typed", async () => {
    startJob.mockResolvedValueOnce({ ok: true, testCode: "123456" });
    expect(await sendJobCheckCode("meera@garudasec.com")).toEqual({ ok: true, testCode: "123456" });
    expect(startJob).toHaveBeenCalledWith("u1", { workEmail: "meera@garudasec.com" });
    finishJob.mockResolvedValueOnce({ ok: false, error: "That code isn't right. Check the latest email and try again." });
    expect((await confirmJobCheckCode("meera@garudasec.com", "000000")).ok).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    finishJob.mockResolvedValueOnce({ ok: true, status: "verified" });
    expect(await confirmJobCheckCode("meera@garudasec.com", "123456")).toEqual({ ok: true });
    expect(finishJob).toHaveBeenLastCalledWith("u1", { workEmail: "meera@garudasec.com", code: "123456" });
    expect(refresh).toHaveBeenCalledOnce();
    finishJob.mockRejectedValueOnce(new Error("down"));
    expect((await confirmJobCheckCode("meera@garudasec.com", "123456")).ok).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain("garudasec");
  });
});

describe("Me editing (docs/plans/me-editing-plan.md)", () => {
  const rowId = "00000000-0000-4000-8000-0000000e0001";
  const story = { title: "Cut missed alerts", where: "", situation: "", task: "", action: "", result: "Alerts fell from 9 to 1.", boxes: ["Learning"], goalId: null };
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
    for (const f of Object.values(store)) f.mockResolvedValue({ ok: true });
  });

  it("changes nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect((await saveMeRoleAction(null, {})).error).toMatch(/sign in/);
    expect((await addInterestAction("Chess")).error).toMatch(/sign in/);
    for (const f of Object.values(store)) expect(f).not.toHaveBeenCalled();
  });

  it("passes the session's user id, never one from the browser, and refreshes after a change", async () => {
    expect(await saveMeRoleAction(null, { title: "IT Support Engineer" })).toEqual({ error: null });
    expect(store.saveMeRole).toHaveBeenCalledWith("u1", null, { title: "IT Support Engineer" });
    await deleteMeRoleAction(rowId);
    expect(store.deleteMeRole).toHaveBeenCalledWith("u1", rowId);
    await saveMeEducationAction(rowId, { qualification: "B.Sc. IT" });
    expect(store.saveMeEducation).toHaveBeenCalledWith("u1", rowId, { qualification: "B.Sc. IT" });
    await deleteMeEducationAction(rowId);
    await saveStoryAction(null, story);
    expect(store.saveStory).toHaveBeenCalledWith("u1", null, story);
    await deleteStoryAction(rowId);
    await addInterestAction("Chess");
    expect(store.addInterest).toHaveBeenCalledWith("u1", { name: "Chess" });
    await removeInterestAction("Chess");
    expect(store.removeInterest).toHaveBeenCalledWith("u1", { name: "Chess" });
    expect(refresh).toHaveBeenCalledTimes(8);
  });

  it("says what was refused, with its field, and that someone else's row isn't there", async () => {
    store.saveMeRole.mockResolvedValueOnce({ ok: false, error: "on_resume", message: "That role is already on your resume.", field: "title" });
    expect(await saveMeRoleAction(null, {})).toEqual({ error: "That role is already on your resume.", field: "title" });
    store.deleteStory.mockResolvedValueOnce({ ok: false, error: "not_found" });
    expect(await deleteStoryAction(rowId)).toEqual({ error: "That isn't on your profile any more. Refresh the page to see the latest.", field: undefined });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("logs only an event name when something breaks, never the story text", async () => {
    store.saveStory.mockRejectedValueOnce(new Error("down"));
    expect((await saveStoryAction(null, story)).error).toMatch(/try again/);
    expect(log).toHaveBeenCalledWith("error", "story_save_failed", {});
    expect(JSON.stringify(log.mock.calls)).not.toContain("Cut missed alerts");
  });
});
