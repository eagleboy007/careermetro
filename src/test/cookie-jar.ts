/**
 * An in-memory stand-in for next/headers cookies(), for tests of code that reads or sets cookies outside a request.
 * Use with vi.mock("next/headers", () => ({ cookies: async () => jar, headers: async () => new Headers() })).
 */
export type CookieOptions = { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number };

export function cookieJar() {
  const values = new Map<string, string>();
  const options = new Map<string, CookieOptions>();
  return {
    values,
    options,
    get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
    set: (name: string, value: string, opts: CookieOptions = {}) => {
      values.set(name, value);
      options.set(name, opts);
    },
    delete: (name: string) => {
      values.delete(name);
      options.delete(name);
    },
    clear: () => {
      values.clear();
      options.clear();
    },
  };
}
