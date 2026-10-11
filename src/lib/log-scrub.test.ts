import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { installConsoleScrub, scrubValue as scrubError, UNLOGGABLE } from "./log-scrub";

const SESSION = "1zNeICW0kj_6j6BRXxhiTqt92ua9KiOrU151lAIGpG8";
const pgError = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    name: "PostgresError",
    code: "23505",
    severity: "ERROR",
    detail: "Key (email)=(priya@example.com) already exists.",
    parameters: ["priya@example.com", "Priya Sharma"],
  });

describe("scrubError", () => {
  it("drops the parameters from a Drizzle query error and keeps the SQL, code and digest", () => {
    const error = Object.assign(new DrizzleQueryError('select * from "resumes" where "id" = $1 and "anonymous_session_id" = $2', ["abc", SESSION], pgError()), { digest: "123" });
    const safe = scrubError(error) as Error & { digest?: string; cause?: Error & { code?: string } };
    const printed = inspect(safe, { depth: 5 });
    for (const leak of [SESSION, "priya@example.com", "Priya Sharma", "Key (email)"]) expect(printed).not.toContain(leak);
    expect(safe.message).toContain('select * from "resumes"');
    expect(safe.message).toContain("params: [hidden]");
    expect(safe.digest).toBe("123");
    expect(safe.cause?.code).toBe("23505");
    expect(safe.stack).toMatch(/^Error: Failed query/);
    expect(safe.stack).toContain("    at ");
  });

  it("scrubs a Postgres error that comes on its own, keeping the code and constraint", () => {
    const printed = inspect(scrubError(Object.assign(pgError(), { constraint_name: "users_email_key" })));
    expect(printed).toContain("23505");
    expect(printed).toContain("users_email_key");
    expect(printed).not.toContain("priya@example.com");
  });

  it("drops a Postgres message that quotes the bad value", () => {
    const cast = Object.assign(new Error('invalid input syntax for type uuid: "Priya Sharma"'), { name: "PostgresError", code: "22P02", severity: "ERROR", where: "unnamed portal parameter $1" });
    const safe = scrubError(cast) as Error;
    expect(safe.message).toBe("PostgresError 22P02");
    expect(inspect(safe)).not.toContain("Priya");
  });

  it("scrubs errors inside AggregateError, plain objects and arrays", () => {
    const aggregate = new AggregateError([pgError()], "several failed");
    expect(inspect(scrubError(aggregate), { depth: 6 })).not.toContain("priya@example.com");
    expect(inspect(scrubError({ err: pgError() }), { depth: 6 })).not.toContain("priya@example.com");
    expect(inspect(scrubError([1, { nested: [pgError()] }]), { depth: 6 })).not.toContain("priya@example.com");
  });

  it("handles circular objects and causes", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(scrubError(a)).toBe(a);
    const e = new Error("loop");
    (e as { cause?: unknown }).cause = e;
    expect(scrubError(e)).toBe(e);
  });

  it.each([
    ["a message that isn't a string", () => Object.assign(new Error("x"), { message: 42, detail: "Priya" })],
    ["a cause getter that throws", () => Object.defineProperty(new Error("x"), "cause", { get: () => { throw new Error("boom"); } })],
    [
      "a message getter that throws on a database error",
      () => Object.defineProperty(Object.assign(new Error("x"), { detail: "Priya" }), "message", { get: () => { throw new Error("boom"); } }),
    ],
    [
      "a revoked proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable(new Error("Priya"), {});
        revoke();
        return proxy;
      },
    ],
  ])("never throws, and never passes through, %s", (_, make) => {
    const value = make();
    let out: unknown;
    expect(() => (out = scrubError(value))).not.toThrow();
    expect(inspect(out, { depth: 4 })).not.toContain("Priya");
  });

  it("scrubs a database error nested as the cause of another error", () => {
    const outer = new Error("render failed", { cause: pgError() });
    const printed = inspect(scrubError(outer), { depth: 5 });
    expect(printed).toContain("render failed");
    expect(printed).not.toContain("priya@example.com");
    expect(outer.cause).toHaveProperty("detail");
  });

  it("leaves other errors and values as they are", () => {
    const plain = new TypeError("x is not a function");
    expect(scrubError(plain)).toBe(plain);
    expect(scrubError(42)).toBe(42);
    expect(scrubError("hello")).toBe("hello");
  });

  it("cuts parameters out of a string that already holds a formatted query error", () => {
    expect(scrubError(`Failed query: select 1\nparams: ${SESSION}`)).toBe("Failed query: select 1\nparams: [hidden]");
  });
});

describe("installConsoleScrub", () => {
  it("scrubs every argument before it reaches the console", () => {
    const error = vi.fn();
    const target = { error, warn: vi.fn(), log: vi.fn() };
    installConsoleScrub(target);
    target.error("⨯", new DrizzleQueryError("select $1", [SESSION]));
    const printed = error.mock.calls[0].map((a) => inspect(a)).join(" ");
    expect(printed).not.toContain(SESSION);
    expect(error.mock.calls[0][0]).toBe("⨯");
  });

  it("keeps logging when an argument can't be read", () => {
    const error = vi.fn();
    const target = { error, warn: vi.fn(), log: vi.fn() };
    installConsoleScrub(target);
    const bad = Object.defineProperty(new Error("x"), "cause", { get: () => { throw new Error("boom"); } });
    expect(() => target.error("failed", bad)).not.toThrow();
    expect(error).toHaveBeenCalledWith("failed", UNLOGGABLE);
  });
});
