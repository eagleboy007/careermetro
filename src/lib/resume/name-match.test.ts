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
  });

  it("is unknown when either side has no name", () => {
    expect(checkName("Riya Sharma", null, env)).toBe("unknown");
    expect(checkName(null, resume, env)).toBe("unknown");
    expect(checkName("Riya Sharma", nameHashes("", env), env)).toBe("unknown");
  });

  it("stores hashes, never the name, and needs the same secret", () => {
    expect(resume!.join(" ")).not.toMatch(/riya|sharma/i);
    expect(checkName("Riya Sharma", resume, { CRON_SECRET: "other" })).toBe("mismatch");
  });
});
