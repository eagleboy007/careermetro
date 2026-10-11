import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Phones download every module a client component imports, and every module those import. Zod with every schema
// (about 34 KB gzipped) and the content JSON must stay on the server: the browser gets constants from
// @/lib/schemas/constants and types through `import type`, which ship nothing.
const SRC = resolve(__dirname, "..");
const FORBIDDEN = [/^zod$/, /^@\/lib\/schemas(\/(?!constants$).*)?$/, /^@\/content(\/.*)?$/, /^server-only$/];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

/** Runtime imports only: `import type` and side-effect-free type-only specifiers are skipped. */
function runtimeImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)";/gm)) {
    if (m[1]) continue;
    const names = m[2].replace(/[{}\s]/g, "").split(",").filter(Boolean);
    if (names.length && names.every((n) => n.startsWith("type"))) continue;
    specs.push(m[3]);
  }
  for (const m of source.matchAll(/^import\s+"([^"]+)";/gm)) specs.push(m[1]);
  return specs;
}

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("client bundle", () => {
  it("keeps Zod, the schemas and the content JSON out of everything client components import", () => {
    const clients = files(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(clients.length).toBeGreaterThan(10);
    const problems: string[] = [];
    const seen = new Set<string>();
    const walk = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      // A server action module reaches the browser as a reference only; its imports stay on the server.
      if (/^\s*["']use server["']/.test(source)) return;
      for (const spec of runtimeImports(source)) {
        if (FORBIDDEN.some((re) => re.test(spec))) problems.push([...chain, relative(SRC, file), spec].join(" -> "));
        const next = resolveLocal(spec, file);
        if (next) walk(next, [...chain, relative(SRC, file)]);
      }
    };
    for (const c of clients) walk(c, []);
    expect(problems).toEqual([]);
  });
});
