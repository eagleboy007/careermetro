import type { Instrumentation } from "next";

/** Runs once per server instance: keeps query parameters out of the error logs Next.js writes (see log-scrub.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installConsoleScrub } = await import("@/lib/log-scrub");
  installConsoleScrub();
}

/**
 * Reports every server error Next.js catches (pages, route handlers, server actions, the proxy) as one structured log
 * line: the route pattern, where it failed, the error's name and code, and React's digest, which matches the one the
 * error page shows. Never the message or the request path, which can carry personal data.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { errorFields, logEvent } = await import("@/lib/log");
  logEvent("error", "request_error", {
    route: context.routePath,
    kind: context.routeType,
    render: context.renderSource,
    method: request.method,
    ...errorFields(error),
  });
};
