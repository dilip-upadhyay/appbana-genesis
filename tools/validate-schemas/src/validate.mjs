#!/usr/bin/env node
// Validates canonical JSON Schemas in docs/schemas/ against reference example
// artifacts declared in schemas.manifest.json. Exits non-zero on the first
// failed schema load or example validation, printing a human-readable report.
//
// Usage:
//   node tools/validate-schemas/src/validate.mjs
//   pnpm --filter @appbana/validate-schemas run validate
//   pnpm validate:schemas   (via root package.json)

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/validate-schemas/src/validate.mjs -> repo root is two levels up from tools/validate-schemas
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MANIFEST_PATH = resolve(HERE, "..", "schemas.manifest.json");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function ok(msg) {
  console.log(`${GREEN}\u2713${RESET} ${msg}`);
}

function fail(msg) {
  console.error(`${RED}\u2717${RESET} ${msg}`);
}

function info(msg) {
  console.log(`${DIM}${msg}${RESET}`);
}

async function readJson(absPath) {
  const raw = await readFile(absPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${relative(REPO_ROOT, absPath)}: ${err.message}`);
  }
}

function formatAjvErrors(errors) {
  return errors
    .map((e) => {
      const where = e.instancePath || "(root)";
      const schemaPath = e.schemaPath;
      const details = e.params ? ` ${JSON.stringify(e.params)}` : "";
      return `    at ${where}: ${e.message}${details}  [schema: ${schemaPath}]`;
    })
    .join("\n");
}

async function main() {
  info(`Repo root: ${REPO_ROOT}`);
  info(`Manifest:  ${relative(REPO_ROOT, MANIFEST_PATH)}`);

  const manifest = await readJson(MANIFEST_PATH);
  if (!Array.isArray(manifest.pairs) || manifest.pairs.length === 0) {
    fail("Manifest has no 'pairs' entries. Nothing to validate.");
    process.exit(1);
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true
  });
  addFormats(ajv);

  let totalExamples = 0;
  let failedExamples = 0;
  let failedSchemas = 0;

  for (const pair of manifest.pairs) {
    const label = pair.name ?? pair.schema;
    console.log(`\n${label}`);

    const schemaAbs = resolve(REPO_ROOT, pair.schema);
    if (!existsSync(schemaAbs)) {
      fail(`  schema missing: ${pair.schema}`);
      failedSchemas += 1;
      continue;
    }

    let validate;
    try {
      const schemaDoc = await readJson(schemaAbs);
      validate = ajv.compile(schemaDoc);
      ok(`  loaded schema ${pair.schema}`);
    } catch (err) {
      fail(`  schema compile error in ${pair.schema}: ${err.message}`);
      failedSchemas += 1;
      continue;
    }

    const examples = Array.isArray(pair.examples) ? pair.examples : [];
    if (examples.length === 0) {
      info(`  (no examples declared)`);
      continue;
    }

    for (const examplePath of examples) {
      totalExamples += 1;
      const exampleAbs = resolve(REPO_ROOT, examplePath);
      if (!existsSync(exampleAbs)) {
        fail(`  example missing: ${examplePath}`);
        failedExamples += 1;
        continue;
      }
      try {
        const data = await readJson(exampleAbs);
        const valid = validate(data);
        if (valid) {
          ok(`  ${examplePath}`);
        } else {
          fail(`  ${examplePath}`);
          console.error(formatAjvErrors(validate.errors ?? []));
          failedExamples += 1;
        }
      } catch (err) {
        fail(`  ${examplePath}: ${err.message}`);
        failedExamples += 1;
      }
    }
  }

  console.log("");
  const summary = `Validated ${totalExamples} example(s) across ${manifest.pairs.length} schema pair(s). Schema failures: ${failedSchemas}. Example failures: ${failedExamples}.`;
  if (failedSchemas === 0 && failedExamples === 0) {
    ok(summary);
    process.exit(0);
  } else {
    fail(summary);
    process.exit(1);
  }
}

main().catch((err) => {
  fail(err.stack || String(err));
  process.exit(1);
});
