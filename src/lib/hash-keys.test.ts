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
    expect(workEmailHashKey({ CRON_SECRET: "c" })).toBe("work-email|c");
    expect(workEmailHashKey({ CRON_SECRET: "c", NAME_HASH_KEY: "n" })).toBe("work-email|n");
    expect(workEmailHashKey({ NAME_HASH_KEY: "n" })).not.toBe(credentialHashKey({ NAME_HASH_KEY: "n" }));
  });
});
