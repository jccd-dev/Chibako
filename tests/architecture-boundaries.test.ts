import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const sourceRoot = path.resolve("src");

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

function withoutCommentsAndStrings(source: string): string {
  let output = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const current = source[i];
    const next = source[i + 1];
    if (quote) {
      if (current.charCodeAt(0) === 92) i += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (current === "/" && next === "/") {
      const end = source.indexOf(String.fromCharCode(10), i + 2);
      i = end === -1 ? source.length : end - 1;
      continue;
    }
    output += current;
  }
  return output;
}

function executableSqlMarkers(source: string): string[] {
  // These executable database APIs are more reliable than searching for SQL
  // words, which also occur in descriptions and user-facing messages.
  const code = withoutCommentsAndStrings(source);
  return ["getDb", ".prepare(", ".exec("].filter((marker) => code.includes(marker));
}

function imports(source: string): string[] {
  const specs: string[] = [];
  const importPattern = /^\s*import(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["'];?/gm;
  for (const match of source.matchAll(importPattern)) specs.push(match[1]);
  return specs;
}

function resolveLocalImport(from: string, specifier: string): string | null {
  if (specifier.startsWith("next/")) return specifier;
  if (specifier.startsWith("@/")) return path.join(sourceRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(from), specifier);
  return null;
}

function sourceModule(candidate: string): string | null {
  for (const file of [candidate, `${candidate}.ts`, `${candidate}.tsx`, path.join(candidate, "index.ts")]) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

test("HTTP adapters do not own executable SQL", () => {
  const apiRoot = path.join(sourceRoot, "app", "api");
  const violations: string[] = [];
  for (const file of sourceFiles(apiRoot)) {
    const markers = executableSqlMarkers(fs.readFileSync(file, "utf8"));
    if (markers.length > 0) violations.push(`${path.relative(process.cwd(), file)}: ${markers.join(", ")}`);
  }
  assert.deepEqual(violations, [], "API routes must delegate SQL to capability modules");
});

test("MCP adapter does not own capability SQL", () => {
  const violations = sourceFiles(path.join(sourceRoot, "mcp"))
    .flatMap((file) => executableSqlMarkers(fs.readFileSync(file, "utf8")).length > 0 ? [path.relative(process.cwd(), file)] : []);
  assert.deepEqual(violations, [], "MCP tools must delegate SQL to capability modules");
});

test("MCP import graph stays independent of Next-specific adapters", () => {
  const entry = path.join(sourceRoot, "mcp", "server.ts");
  const pending = [entry];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (pending.length > 0) {
    const file = pending.pop()!;
    const resolved = sourceModule(file) ?? file;
    if (visited.has(resolved) || !fs.existsSync(resolved)) continue;
    visited.add(resolved);
    for (const specifier of imports(fs.readFileSync(resolved, "utf8"))) {
      const local = resolveLocalImport(resolved, specifier);
      if (specifier.startsWith("next/") || specifier === "@/lib/api" || specifier === "@/lib/auth") {
        violations.push(`${path.relative(process.cwd(), resolved)} -> ${specifier}`);
      }
      if (local) {
        const module = sourceModule(local);
        if (module) pending.push(module);
        if (module === path.join(sourceRoot, "lib", "api.ts") || module === path.join(sourceRoot, "lib", "auth.ts")) {
          violations.push(`${path.relative(process.cwd(), resolved)} -> ${path.relative(process.cwd(), module)}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], "MCP must not import Next request/auth adapters");
});

test("the source tree does not introduce a placeholder generic repository", () => {
  const violations = sourceFiles(sourceRoot).flatMap((file) => {
    const source = withoutCommentsAndStrings(fs.readFileSync(file, "utf8"));
    return /\b(?:Repository|repository)\s*</.test(source) || /\bclass\s+\w*Repository\b/.test(source)
      ? [path.relative(process.cwd(), file)]
      : [];
  });
  assert.deepEqual(violations, [], "use capability-owned data access until a second persistence adapter exists");
});
