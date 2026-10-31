import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Phones download every module a client component imports, and every module those import. Zod with every schema
// (about 34 KB gzipped), the content JSON and server code must stay on the server: the browser gets constants from
// @/lib/schemas/constants and types through `import type`, which ship nothing.
const SRC = resolve(__dirname, "..");
const FORBIDDEN = [
  /^zod(\/.*)?$/,
  /^@\/lib\/schemas(\/(?!constants$).*)?$/,
  /^@\/content(\/.*)?$/,
  /^server-only$/,
  /^@anthropic-ai\/sdk(\/.*)?$/,
  /^drizzle-orm(\/.*)?$/,
  /^drizzle-zod(\/.*)?$/,
  /^postgres$/,
  /\/content\/.*\.json$/,
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.[mc]?[jt]sx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const parse = (source: string) => ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);

/** The file's directive prologue ("use client", "use server"); comments before it are allowed. */
function directives(source: string): string[] {
  const out: string[] = [];
  for (const s of parse(source).statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    out.push(s.expression.text);
  }
  return out;
}

/**
 * Every module the file loads at runtime: imports, re-exports (`export … from`, `export * from`), side-effect imports,
 * dynamic `import()` and `require()`. `import type`, `export type` and imports whose names are all `type` are skipped,
 * since they ship nothing.
 */
function runtimeImports(source: string): string[] {
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause;
      const typeOnly =
        c &&
        (c.isTypeOnly ||
          (!c.name &&
            c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) specs.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return specs;
}

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];
  for (const candidate of [base, ...exts.map((e) => base + e), ...exts.map((e) => join(base, "index" + e))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("runtimeImports", () => {
  it.each([
    ['import { z } from "zod";', ["zod"]],
    ["import { z } from 'zod';", ["zod"]],
    ['import { z } from "zod"', ["zod"]],
    ['import z from "zod"', ["zod"]],
    ['import * as z from "zod"', ["zod"]],
    ['import "zod"', ["zod"]],
    ['export { WORK_TYPES as W2 } from "@/lib/schemas";', ["@/lib/schemas"]],
    ['export * from "@/lib/schemas"', ["@/lib/schemas"]],
    ['export * as s from "@/lib/schemas"', ["@/lib/schemas"]],
    ['const load = () => import("@/lib/schemas");', ["@/lib/schemas"]],
    ['const s = require("@/lib/schemas");', ["@/lib/schemas"]],
    ['import { type Gap, WORK_TYPES } from "@/lib/schemas";', ["@/lib/schemas"]],
    ['import Thing, { type Gap } from "@/lib/schemas";', ["@/lib/schemas"]],
    ['import type { Gap } from "@/lib/schemas";', []],
    ['import { type Gap, type Goal } from "@/lib/schemas";', []],
    ['export type { Gap } from "@/lib/schemas";', []],
    ['export { type Gap } from "@/lib/schemas";', []],
  ])("%s", (source, expected) => {
    expect(runtimeImports(source)).toEqual(expected);
  });

  it("finds a directive after leading comments", () => {
    expect(directives('// note\n/* more */\n"use client";\nimport x from "y";')).toEqual(["use client"]);
    expect(directives('import x from "y";\n"use client";')).toEqual([]);
  });
});

describe("client bundle", () => {
  it("keeps Zod, the schemas, the content JSON and server code out of everything client components import", () => {
    const clients = files(SRC).filter((f) => directives(readFileSync(f, "utf8")).includes("use client"));
    expect(clients.length).toBeGreaterThan(10);
    const problems: string[] = [];
    const seen = new Set<string>();
    const walk = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      // A server action module reaches the browser as a reference only; its imports stay on the server.
      if (directives(source).includes("use server")) return;
      for (const spec of runtimeImports(source)) {
        if (FORBIDDEN.some((re) => re.test(spec))) problems.push([...chain, relative(SRC, file), spec].join(" -> "));
        const next = resolveLocal(spec, file);
        if (next) walk(next, [...chain, relative(SRC, file)]);
      }
    };
    for (const c of clients) walk(c, []);
    expect(problems).toEqual([]);
  });

  // A client component renders on the server (Node) and again in the browser, and the two can carry different ICU data:
  // one writes "28 Sep 2026", the other "28 Sept 2026", and hydration fails (React #418, seen on /design locally while CI
  // agreed). So nothing the browser loads writes a date with Intl or toLocale*: src/lib/day-words.ts does it from fixed
  // names. Numbers may still use toLocaleString("en-IN"), whose grouping doesn't vary.
  it("writes dates with day-words, never Intl or toLocale*, in everything client components import", () => {
    const DATE_INTL = /Intl\.DateTimeFormat|\.toLocaleDateString\(|\.toLocaleTimeString\(/;
    const clients = files(SRC).filter((f) => directives(readFileSync(f, "utf8")).includes("use client"));
    const problems = new Set<string>();
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      if (directives(source).includes("use server")) return;
      if (DATE_INTL.test(source)) problems.add(relative(SRC, file));
      for (const spec of runtimeImports(source)) {
        const next = resolveLocal(spec, file);
        if (next) walk(next);
      }
    };
    for (const c of clients) walk(c);
    expect([...problems].sort()).toEqual([]);
  });
});
