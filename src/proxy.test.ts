import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

describe("signed-in preview proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers 404 in production without the preview flag", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TODAY_PREVIEW", "");
    expect(proxy().status).toBe(404);
  });

  it("lets the request through on previews and with the flag", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(proxy().headers.get("x-middleware-next")).toBe("1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TODAY_PREVIEW", "1");
    expect(proxy().headers.get("x-middleware-next")).toBe("1");
  });

  it("covers the Today route", () => {
    expect(config.matcher).toContain("/today");
  });
});
