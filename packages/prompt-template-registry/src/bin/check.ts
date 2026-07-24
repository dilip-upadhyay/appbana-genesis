#!/usr/bin/env node
/**
 * `prompt-registry-check` — CI enforcement CLI.
 *
 * Usage:
 *   prompt-registry-check <registry-root> [--provenance-refs <json-file>]
 *
 * The optional `<json-file>` supplies an array of `ProvenanceRefRecord` — the
 * result of a query like:
 *   SELECT DISTINCT promptTemplateRef, promptTemplateVersion, promptTemplateHash
 *   FROM ai_provenance;
 *
 * Exit code 0 means the registry is clean AND every referenced version is
 * present with an unchanged hash. Any other exit code means CI must block the
 * merge.
 */

import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import { tryLoadRegistry } from "../load.js";
import type { ProvenanceRefRecord, RegistryProblem } from "../types.js";
import { validateProvenanceRefs } from "../validate.js";

interface CliArgs {
  readonly rootDir: string;
  readonly provenanceRefsFile?: string;
}

async function main(): Promise<number> {
  const parsed = parseArgs(argv.slice(2));
  if (parsed === undefined) return 2;

  const result = await tryLoadRegistry(parsed.rootDir);
  if (result.kind === "error") {
    printProblems("registry structure", result.problems);
    return 1;
  }

  if (parsed.provenanceRefsFile !== undefined) {
    const refs = await loadProvenanceRefs(parsed.provenanceRefsFile);
    if (refs === undefined) return 1;
    const problems = validateProvenanceRefs(result.registry, refs);
    if (problems.length > 0) {
      printProblems("provenance references", problems);
      return 1;
    }
    process.stdout.write(
      `✓ registry OK — ${result.registry.templates.size} template(s), ${refs.length} provenance reference(s) all resolved\n`,
    );
  } else {
    process.stdout.write(
      `✓ registry OK — ${result.registry.templates.size} template(s)\n`,
    );
  }
  return 0;
}

function parseArgs(args: readonly string[]): CliArgs | undefined {
  if (args.length === 0) {
    process.stderr.write(
      "usage: prompt-registry-check <registry-root> [--provenance-refs <file>]\n",
    );
    return undefined;
  }
  const rootDir = args[0]!;
  let provenanceRefsFile: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provenance-refs") {
      const next = args[i + 1];
      if (next === undefined) {
        process.stderr.write("--provenance-refs requires a file path\n");
        return undefined;
      }
      provenanceRefsFile = next;
      i++;
    } else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      return undefined;
    }
  }
  return provenanceRefsFile !== undefined
    ? { rootDir, provenanceRefsFile }
    : { rootDir };
}

async function loadProvenanceRefs(
  file: string,
): Promise<readonly ProvenanceRefRecord[] | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      process.stderr.write(
        `provenance refs file ${file} must contain a JSON array\n`,
      );
      return undefined;
    }
    return parsed as readonly ProvenanceRefRecord[];
  } catch (err) {
    process.stderr.write(
      `cannot read provenance refs file ${file}: ${err instanceof Error ? err.message : "read error"}\n`,
    );
    return undefined;
  }
}

function printProblems(
  scope: string,
  problems: readonly RegistryProblem[],
): void {
  process.stderr.write(`✗ ${scope} — ${problems.length} problem(s):\n`);
  for (const p of problems) {
    const loc = [p.ref, p.version, p.file].filter((s) => s !== undefined).join(" ");
    const locBlock = loc.length > 0 ? `(${loc}) ` : "";
    process.stderr.write(`  [${p.code}] ${locBlock}${p.message}\n`);
  }
}

try {
  const code = await main();
  exit(code);
} catch (err: unknown) {
  const detail =
    err instanceof Error
      ? err.stack ?? err.message
      : errorFallback(err);
  process.stderr.write(`unhandled error: ${detail}\n`);
  exit(2);
}

function errorFallback(err: unknown): string {
  try {
    const s = JSON.stringify(err);
    if (s !== undefined) return s;
  } catch {
    // fall through
  }
  return Object.prototype.toString.call(err);
}
