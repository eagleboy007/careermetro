import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_FAILED, NO_CONNECTION, actionFailed, readApiReply } from "./api-reply";

describe("readApiReply", () => {
  it("returns our JSON as is", async () => {
    const res = Response.json({ ok: false, error: "Nope" }, { status: 429 });
    expect(await readApiReply(res)).toEqual({ ok: false, error: "Nope" });
  });

  it("explains a hosting error page by its status", async () => {
    const page = (status: number) => new Response("<html>error</html>", { status, headers: { "content-type": "text/html" } });
    expect((await readApiReply(page(413))).error).toMatch(/too large/);
    expect((await readApiReply(page(504))).error).toMatch(/too long/);
    expect(await readApiReply(page(502))).toEqual({ ok: false, error: "Something went wrong. Please try again." });
  });

  it("throws an abort while the body is read, so the caller can say it stopped waiting", async () => {
    const giveUp = new AbortController();
    const res = Response.json({ ok: true });
    vi.spyOn(res, "json").mockImplementation(() => {
      giveUp.abort();
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });
    await expect(readApiReply(res, giveUp.signal)).rejects.toThrow(/aborted/);
  });

  it("still reads broken JSON as a plain message when nothing aborted", async () => {
    const res = new Response("{not json", { status: 500, headers: { "content-type": "application/json" } });
    expect(await readApiReply(res)).toEqual({ ok: false, error: "Something went wrong. Please try again." });
  });
});

describe("actionFailed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says the connection is gone only while the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(actionFailed()).toBe(NO_CONNECTION);
    vi.stubGlobal("navigator", { onLine: true });
    expect(actionFailed()).toBe(ACTION_FAILED);
  });
});
