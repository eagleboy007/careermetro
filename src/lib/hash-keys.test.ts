import { describe, expect, it } from "vitest";
import { credentialHashKey, ipHashKey, jobTextHashKey, nameHashKeys, workEmailHashKey } from "./hash-keys";

describe("hash keys (H7)", () => {
  it("fall back to CRON_SECRET until their own key is set", () => {
    expect(nameHashKeys({ CRON_SECRET: "c" })).toEqual(["resume-name|c"]);
    expect(ipHashKey({ CRON_SECRET: "c" })).toBe("c");
    expect(ipHashKey({})).toBe("local-development-only");
  });

  it("use their own key once set, keeping the old name key for names saved before", () => {
    expect(nameHashKeys({ CRON_SECRET: "c", NAME_HASH_KEY: "n" })).toEqual(["resume-name|n", "resume-name|c"]);
    expect(ipHashKey({ CRON_SECRET: "c", IP_HASH_KEY: "i" })).toBe("i");
  });

  it("give job posting hashes a key of their own", () => {
    expect(jobTextHashKey({ CRON_SECRET: "c" })).toBe("jobText|c");
    expect(jobTextHashKey({ CRON_SECRET: "c", NAME_HASH_KEY: "n" })).toBe("jobText|n");
    expect(jobTextHashKey({ NAME_HASH_KEY: "n" })).not.toBe(credentialHashKey({ NAME_HASH_KEY: "n" }));
  });

  it("keep work-email hashes apart from the other keys, and fixed with NAME_HASH_KEY", () => {
    // The same key as before whenever NAME_HASH_KEY is set, so invites and codes made earlier still match.
    expect(workEmailHashKey({ CRON_SECRET: "c", NAME_HASH_KEY: "n" })).toBe("work-email|n");
    expect(workEmailHashKey({ NAME_HASH_KEY: "n", NODE_ENV: "production", VERCEL_ENV: "production" })).toBe("work-email|n");
    expect(workEmailHashKey({ NAME_HASH_KEY: "n" })).not.toBe(credentialHashKey({ NAME_HASH_KEY: "n" }));
  });

  it("never use CRON_SECRET for work-email hashes, and are off in production without NAME_HASH_KEY (security review 2026-10-13)", () => {
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview", NODE_ENV: "production" }]) {
      expect(workEmailHashKey({ ...env, CRON_SECRET: "c" })).toBeNull();
      expect(workEmailHashKey(env)).toBeNull();
    }
    // Local copies and tests: a fixed development-only key, whatever CRON_SECRET is.
    expect(workEmailHashKey({ NODE_ENV: "development", CRON_SECRET: "c" })).toBe("work-email|local-development-only");
    expect(workEmailHashKey({ NODE_ENV: "test" })).toBe("work-email|local-development-only");
    expect(workEmailHashKey({ NODE_ENV: "test", CRON_SECRET: "c" })).not.toContain("c|");
  });
});
