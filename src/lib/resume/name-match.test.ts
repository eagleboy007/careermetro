import { describe, expect, it } from "vitest";
import { checkName, nameHashes, nameWords } from "./name-match";

const env = { CRON_SECRET: "test-secret" };

describe("nameWords", () => {
  it("lowercases, drops accents, punctuation and initials", () => {
    expect(nameWords("  Riya K. Sharma ")).toEqual(["riya", "sharma"]);
    expect(nameWords("Zoë Fernandes-D'Souza")).toEqual(["zoe", "fernandes", "souza"]);
    expect(nameWords(null)).toEqual([]);
  });
});

describe("checkName", () => {
  const resume = nameHashes("SHARMA Riya Kumari", env);

  it("matches first and last name in any order, with middle names", () => {
    expect(checkName("Riya Sharma", resume, env)).toBe("match");
    expect(checkName("riya kumari sharma", resume, env)).toBe("match");
  });

  it("does not match another person, a first name alone, or an initial", () => {
    expect(checkName("Asha Rao", resume, env)).toBe("mismatch");
    expect(checkName("Riya Verma", resume, env)).toBe("mismatch");
    // An initial on the resume is no word to match: "R. Sharma" doesn't show "Riya".
    expect(checkName("Riya Sharma", nameHashes("R. Sharma", env), env)).toBe("mismatch");
    // A one-word account name ("Karthik") needs only that word.
    expect(checkName("Karthik", nameHashes("Karthik R", env), env)).toBe("match");
    // ...but not a resume with a fuller name, so a surname alone doesn't match someone else.
    expect(checkName("Sharma", nameHashes("Amit Sharma", env), env)).toBe("mismatch");
    expect(checkName("R. Sharma", nameHashes("Amit Sharma", env), env)).toBe("mismatch");
  });

  it("is unknown when the resume shows no name, unnamed when the account has none", () => {
    expect(checkName("Riya Sharma", null, env)).toBe("unknown");
    expect(checkName(null, resume, env)).toBe("unnamed");
    expect(checkName("R.", resume, env)).toBe("unnamed");
    expect(checkName("Riya Sharma", nameHashes("", env), env)).toBe("unknown");
  });

  it("stores hashes, never the name, and needs the same secret", () => {
    expect(resume!.join(" ")).not.toMatch(/riya|sharma/i);
    expect(checkName("Riya Sharma", resume, { CRON_SECRET: "other" })).toBe("mismatch");
  });

  it("uses its own key once NAME_HASH_KEY is set, and names saved before still match (H7)", () => {
    const keyed = { ...env, NAME_HASH_KEY: "name-key" };
    const fresh = nameHashes("Riya Sharma", keyed);
    expect(fresh).not.toEqual(nameHashes("Riya Sharma", env));
    expect(checkName("Riya Sharma", fresh, keyed)).toBe("match");
    expect(checkName("Riya Sharma", resume, keyed)).toBe("match");
    // Rotating CRON_SECRET no longer breaks names saved under the name key.
    expect(checkName("Riya Sharma", fresh, { CRON_SECRET: "rotated", NAME_HASH_KEY: "name-key" })).toBe("match");
    expect(checkName("Riya Sharma", fresh, env)).toBe("mismatch");
  });

  it("never mixes keys within one name", () => {
    const keyed = { ...env, NAME_HASH_KEY: "name-key" };
    const mixed = [nameHashes("Riya", env)![0], nameHashes("Sharma", keyed)![0]];
    expect(checkName("Riya Sharma", mixed, keyed)).toBe("mismatch");
  });
});
