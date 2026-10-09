import { describe, expect, it } from "vitest";
import { signedInPreviewEnabled } from "./preview";

describe("signed-in preview flag", () => {
  it("is on locally and on preview deployments", () => {
    expect(signedInPreviewEnabled({})).toBe(true);
    expect(signedInPreviewEnabled({ VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is off in production unless TODAY_PREVIEW is 1", () => {
    expect(signedInPreviewEnabled({ VERCEL_ENV: "production" })).toBe(false);
    expect(signedInPreviewEnabled({ VERCEL_ENV: "production", TODAY_PREVIEW: "true" })).toBe(false);
    expect(signedInPreviewEnabled({ VERCEL_ENV: "production", TODAY_PREVIEW: "1" })).toBe(true);
  });
});
