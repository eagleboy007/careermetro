import { describe, expect, it } from "vitest";
import { hasBearer } from "./secret";

const req = (auth?: string) => new Request("https://x.test/", { headers: auth ? { authorization: auth } : {} });

describe("hasBearer", () => {
  it("accepts only the exact bearer secret, and nothing when no secret is set", () => {
    expect(hasBearer(req("Bearer s3cret"), "s3cret")).toBe(true);
    expect(hasBearer(req("Bearer s3cre"), "s3cret")).toBe(false);
    expect(hasBearer(req("s3cret"), "s3cret")).toBe(false);
    expect(hasBearer(req(), "s3cret")).toBe(false);
    expect(hasBearer(req("Bearer "), undefined)).toBe(false);
    expect(hasBearer(req("Bearer "), "")).toBe(false);
  });
});
