import { describe, expect, it } from "vitest";
import { findRef } from "@/lib/schemas";
import { createHash } from "node:crypto";
import { findRefKeys, findRefsAvailable, openRef, sealRef } from "./find-ref";

const USER = "6b1f0a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";
const OTHER_USER = "7c2f0a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";
const ORG = "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";
const OTHER_ORG = "4f9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a73";
const env = { FIND_REF_KEY: "test-only-find-ref-key" };

describe("find refs (pending item 19)", () => {
  it("seal a person's id into an opaque ref that opens again for the same company", () => {
    const ref = sealRef(USER, ORG, env)!;
    expect(findRef.safeParse(ref).success).toBe(true);
    expect(openRef(ref, ORG, env)).toBe(USER);
    // Nothing of the id shows in the ref.
    for (const part of USER.split("-")) expect(ref.toLowerCase()).not.toContain(part);
  });

  it("are stable for one company and differ for every other company and person", () => {
    expect(sealRef(USER, ORG, env)).toBe(sealRef(USER, ORG, env));
    expect(sealRef(USER, OTHER_ORG, env)).not.toBe(sealRef(USER, ORG, env));
    expect(sealRef(OTHER_USER, ORG, env)).not.toBe(sealRef(USER, ORG, env));
  });

  it("open nothing for another company, another key, or an altered ref", () => {
    const ref = sealRef(USER, ORG, env)!;
    expect(openRef(ref, OTHER_ORG, env)).toBeNull();
    expect(openRef(ref, ORG, { FIND_REF_KEY: "another-key" })).toBeNull();
    const flipped = ref.slice(0, 30) + (ref[30] === "A" ? "B" : "A") + ref.slice(31);
    expect(openRef(flipped, ORG, env)).toBeNull();
    expect(openRef(ref.slice(1), ORG, env)).toBeNull();
    expect(openRef("not a ref", ORG, env)).toBeNull();
  });

  it("are off in production without a key, and fall back elsewhere", () => {
    expect(findRefsAvailable({ VERCEL_ENV: "production" })).toBe(false);
    expect(sealRef(USER, ORG, { NODE_ENV: "production" })).toBeNull();
    expect(findRefsAvailable({ VERCEL_ENV: "production", NAME_HASH_KEY: "k" })).toBe(true);
    expect(findRefsAvailable({ VERCEL_ENV: "production", FIND_REF_KEY: "k" })).toBe(true);
    expect(findRefsAvailable({})).toBe(true);
    expect(openRef(sealRef(USER, ORG, {})!, ORG, {})).toBe(USER);
  });

  it("never use CRON_SECRET: off in production with only that, and it changes nothing elsewhere", () => {
    expect(findRefsAvailable({ VERCEL_ENV: "production", CRON_SECRET: "cron" })).toBe(false);
    expect(sealRef(USER, ORG, { NODE_ENV: "production", CRON_SECRET: "cron" })).toBeNull();
    expect(openRef(sealRef(USER, ORG, env)!, ORG, { NODE_ENV: "production", CRON_SECRET: "cron" })).toBeNull();
    expect(sealRef(USER, ORG, { CRON_SECRET: "cron" })).toBe(sealRef(USER, ORG, { CRON_SECRET: "other" }));
    // FIND_REF_KEY wins over NAME_HASH_KEY.
    expect(sealRef(USER, ORG, { FIND_REF_KEY: "a", NAME_HASH_KEY: "b" })).toBe(sealRef(USER, ORG, { FIND_REF_KEY: "a" }));
    expect(sealRef(USER, ORG, { FIND_REF_KEY: "a", NAME_HASH_KEY: "b" })).not.toBe(sealRef(USER, ORG, { NAME_HASH_KEY: "b" }));
  });

  it("derive separate encryption and IV subkeys with HKDF", () => {
    const keys = findRefKeys(env)!;
    expect(keys.enc).toHaveLength(32);
    expect(keys.iv).toHaveLength(32);
    expect(keys.enc.equals(keys.iv)).toBe(false);
    // Neither is the plain hash of the secret, and another secret gives other subkeys.
    const plain = createHash("sha256").update(`find-ref|${env.FIND_REF_KEY}`).digest();
    expect(keys.enc.equals(plain) || keys.iv.equals(plain)).toBe(false);
    const other = findRefKeys({ FIND_REF_KEY: "another-key" })!;
    expect(other.enc.equals(keys.enc) || other.iv.equals(keys.iv)).toBe(false);
    expect(findRefKeys({ VERCEL_ENV: "production" })).toBeNull();
  });
});
