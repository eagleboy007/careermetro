import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("the web app manifest", () => {
  it("shares to /share by POST, so job text never sits in an address", () => {
    const m = manifest();
    expect(m.share_target).toEqual({ action: "/share", method: "POST", enctype: "application/x-www-form-urlencoded", params: { title: "title", text: "text", url: "url" } });
  });

  it("installs as a standalone app that opens on Today, with icons that exist", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/today");
    expect(m.icons?.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons ?? []) expect(existsSync(`public${icon.src}`)).toBe(true);
  });
});
