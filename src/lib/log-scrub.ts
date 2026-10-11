/**
 * Keeps query parameters out of the logs Next.js writes itself. When a page or route fails without catching, Next
 * prints the error with console.error. A database error from Drizzle carries every query parameter in its message and
 * properties (session ids, profile text), and a Postgres error's `detail` can quote a row ("Key (email)=(…) already
 * exists"). scrubError rewrites such errors before they reach the console: the SQL, name, code and digest stay; the
 * parameters, `detail`, `where` and the like go. Other errors pass through unchanged.
 */
const SECRET_PROPS = ["params", "parameters", "detail", "where", "hint", "internal_query", "query_params"];
const PARAMS_IN_TEXT = /\nparams: [\s\S]*$/;

const isDbError = (e: Error) =>
  e.message.startsWith("Failed query:") || SECRET_PROPS.some((p) => Object.prototype.hasOwnProperty.call(e, p));

export function scrubError(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(PARAMS_IN_TEXT, "\nparams: [hidden]");
  if (!(value instanceof Error) || depth > 4) return value;
  const cause = value.cause === undefined ? undefined : scrubError(value.cause, depth + 1);
  if (!isDbError(value)) {
    if (cause === value.cause) return value;
    const copy = Object.create(Object.getPrototypeOf(value)) as Error;
    Object.defineProperties(copy, Object.getOwnPropertyDescriptors(value));
    Object.defineProperty(copy, "cause", { value: cause, configurable: true, writable: true });
    return copy;
  }
  const message = value.message.replace(PARAMS_IN_TEXT, "\nparams: [hidden]");
  const safe = new Error(message, cause === undefined ? undefined : { cause });
  safe.name = value.name;
  const frames = (value.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
  safe.stack = [`${value.name}: ${message}`, ...frames].join("\n");
  for (const key of ["code", "digest", "severity", "routine", "query"] as const) {
    const v = (value as unknown as Record<string, unknown>)[key];
    if (typeof v === "string" || typeof v === "number") Object.assign(safe, { [key]: v });
  }
  return safe;
}

let installed = false;

/** Routes console.error, console.warn and console.log through scrubError. Safe to call more than once. */
export function installConsoleScrub(target: Pick<Console, "error" | "warn" | "log"> = console): void {
  if (installed && target === console) return;
  if (target === console) installed = true;
  for (const method of ["error", "warn", "log"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map((a) => scrubError(a)));
  }
}
