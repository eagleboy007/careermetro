import { describe, expect, it } from "vitest";
import { readApiReply } from "./api-reply";

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
});
