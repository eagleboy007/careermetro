/**
 * Keeps query parameters out of the logs Next.js writes itself. When a page or route fails without catching, Next
 * prints the error with console.error. A database error from Drizzle carries every query parameter in its message and
 * properties (session ids, profile text), and a Postgres error's message and `detail` can quote a value ("Key
 * (email)=(…) already exists", `invalid input syntax for type uuid: "…"`). scrubError rewrites such errors before
 * they reach the console: the SQL, name, code, constraint, table, column and digest stay; the parameters, the
 * Postgres message and `detail` go. It also looks inside causes, AggregateError.errors, and plain objects and arrays
 * up to a few levels. Other values pass through unchanged. It never throws: a value it can't read is replaced by a
 * placeholder, not passed through, since that value might be the one holding personal data.
 */
const SECRET_PROPS = ["params", "parameters", "detail", "where", "hint", "internal_query", "query_params"];
const KEPT_PROPS = ["code", "digest", "severity", "routine", "query", "constraint_name", "table_name", "column_name"];
const PARAMS_IN_TEXT = /\nparams: [\s\S]*$/;
const MAX_DEPTH = 4;
export const UNLOGGABLE = "[unloggable value]";

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const text = (v: unknown) => (typeof v === "string" ? v : "");

function isPlain(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

type Memo = Map<object, unknown>;
const PENDING = Symbol("pending");
export const CIRCULAR = "[circular]";

function scrubDbError(value: Error, memo: Memo, depth: number): Error {
  const name = text(value.name) || "Error";
  const message = text(value.message);
  const fields = value as unknown as Record<string, unknown>;
  // A Drizzle error's message is the SQL and its parameters; a Postgres error's message can quote the bad value.
  const safeMessage = message.startsWith("Failed query:")
    ? message.replace(PARAMS_IN_TEXT, "\nparams: [hidden]")
    : `${name} ${text(fields.code)}`.trim();
  const cause = value.cause === undefined ? undefined : scrub(value.cause, memo, depth + 1);
  const safe = new Error(safeMessage, cause === undefined ? undefined : { cause });
  safe.name = name;
  const frames = text(value.stack).split("\n").filter((line) => /^\s+at /.test(line));
  safe.stack = [`${name}: ${safeMessage}`, ...frames].join("\n");
  for (const key of KEPT_PROPS) {
    const v = fields[key];
    if (typeof v === "string" || typeof v === "number") Object.assign(safe, { [key]: v });
  }
  return safe;
}

/** Any other error: its cause, AggregateError.errors and own enumerable properties are scrubbed; copied if any changed. */
function scrubError(value: Error, memo: Memo, depth: number): Error {
  if (text(value.message).startsWith("Failed query:") || SECRET_PROPS.some((p) => own(value, p))) {
    return scrubDbError(value, memo, depth);
  }
  const keys = new Set([...Object.keys(value), ...(own(value, "cause") ? ["cause"] : []), ...(own(value, "errors") ? ["errors"] : [])]);
  keys.delete("message");
  keys.delete("stack");
  const changed: [string, unknown][] = [];
  for (const key of keys) {
    const before = (value as unknown as Record<string, unknown>)[key];
    const after = scrub(before, memo, depth + 1);
    if (after !== before) changed.push([key, after]);
  }
  if (!changed.length) return value;
  const copy = Object.create(Object.getPrototypeOf(value)) as Error;
  Object.defineProperties(copy, Object.getOwnPropertyDescriptors(value));
  for (const [key, after] of changed) Object.defineProperty(copy, key, { value: after, configurable: true, writable: true, enumerable: true });
  return copy;
}

function scrubInner(value: object, memo: Memo, depth: number): unknown {
  if (value instanceof Error) return scrubError(value, memo, depth);
  if (!isPlain(value)) return value;
  if (Array.isArray(value)) {
    const out = value.map((v) => scrub(v, memo, depth + 1));
    return out.some((v, i) => v !== value[i]) ? out : value;
  }
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = scrub(v, memo, depth + 1);
    if (out[k] !== v) changed = true;
  }
  return changed ? out : value;
}

/**
 * Every object is scrubbed once per logged value and the result reused, so a value that appears twice (an error next
 * to its own cause, the same error twice in a list) is clean both times. A cycle back to a value still being scrubbed
 * becomes CIRCULAR, never the original.
 */
function scrub(value: unknown, memo: Memo, depth: number): unknown {
  if (typeof value === "string") return value.replace(PARAMS_IN_TEXT, "\nparams: [hidden]");
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) return value;
  if (memo.has(value)) {
    const done = memo.get(value);
    return done === PENDING ? CIRCULAR : done;
  }
  memo.set(value, PENDING);
  const out = scrubInner(value, memo, depth);
  memo.set(value, out);
  return out;
}

/** The value with database details removed, or UNLOGGABLE when it can't be read safely. Never throws. */
export function scrubValue(value: unknown): unknown {
  try {
    return scrub(value, new Map(), 0);
  } catch {
    return UNLOGGABLE;
  }
}

let installed = false;

/** Routes console.error, console.warn and console.log through scrubValue. Safe to call more than once. */
export function installConsoleScrub(target: Pick<Console, "error" | "warn" | "log"> = console): void {
  if (installed && target === console) return;
  if (target === console) installed = true;
  for (const method of ["error", "warn", "log"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(scrubValue));
  }
}
