import { describe, expect, it } from "vitest";
import { credentialKey } from "./credential";

const env = { NAME_HASH_KEY: "k1" };

describe("credentialKey", () => {
  it("ignores case, spaces and separators, and never contains the id", () => {
    const key = credentialKey("aws-cloud-practitioner", "ab-12 34", env);
    expect(credentialKey("aws-cloud-practitioner", "AB1234", env)).toBe(key);
    expect(key).not.toContain("AB1234");
  });

  it("differs per certificate and per key", () => {
    const key = credentialKey("aws-cloud-practitioner", "AB1234", env);
    expect(credentialKey("az-900", "AB1234", env)).not.toBe(key);
    expect(credentialKey("aws-cloud-practitioner", "AB1234", { NAME_HASH_KEY: "k2" })).not.toBe(key);
  });
});
