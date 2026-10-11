import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

describe("onRequestError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs the route, kind, error name, code and digest, and nothing from the message or path", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("duplicate key: priya@example.com"), { digest: "3141592", cause: { code: "23505" } });
    await onRequestError(
      error,
      { path: "/resume/abc?name=Priya", method: "POST", headers: { cookie: "cm_owner=secret" } },
      { routerKind: "App Router", routePath: "/resume/[id]/gaps/[slug]", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      event: "request_error",
      route: "/resume/[id]/gaps/[slug]",
      kind: "render",
      render: "server-rendering",
      method: "POST",
      error: "Error",
      code: "23505",
      digest: "3141592",
    });
    for (const leak of ["priya", "Priya", "secret", "abc"]) expect(line).not.toContain(leak);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await onRequestError(new Error("x"), { path: "/", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined });
    expect(spy).not.toHaveBeenCalled();
  });
});
