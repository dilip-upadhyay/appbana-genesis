// AppBana Genesis — ESLint flat config (workspace-wide).
//
// One config governs every package. Packages do not carry their own config;
// `pnpm lint` at the repo root is the single authoritative lint gate, and each
// package's `lint` script resolves this file by walking up the tree.
//
// Rule philosophy: the platform's core promise is determinism and provenance.
// Rules here are chosen to protect that promise, not to enforce taste.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, dependencies, and generated artifacts are never linted.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.log",
      ".turbo/**",
      ".cache/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
      parserOptions: {
        // Type-aware linting. `projectService` resolves each file to the
        // nearest package tsconfig.json, which is what makes rules like
        // `prefer-optional-chain` and `no-floating-promises` possible.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Determinism guardrails (ADR-013) -------------------------------
      // Engines and generators must take time and randomness as injected
      // dependencies. The one sanctioned exception is the default-injection
      // idiom `config.now ?? (() => new Date())`, which *is* the seam: the
      // wall clock is the default, and every caller can override it.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "Date.now() is a wall-clock read. Inject `now: () => Date` and call it instead (ADR-013). If this is a duration measurement, take both readings from the injected clock.",
        },
        {
          selector:
            "NewExpression[callee.name='Date'][arguments.length=0]:not(LogicalExpression[operator='??'] > ArrowFunctionExpression > NewExpression)",
          message:
            "new Date() is a wall-clock read. Inject `now: () => Date` instead (ADR-013). The only sanctioned use is the default-injection idiom `config.now ?? (() => new Date())`.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            "Math.random() is non-deterministic. Inject an id generator or random source instead (ADR-013).",
        },
      ],

      // --- Correctness ----------------------------------------------------
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
          // Inline `import("...").Type` annotations are a legitimate way to
          // reference a type without creating a module-level import cycle.
          disallowTypeAnnotations: false,
        },
      ],
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    // --- ADR-013 engine purity enforcement -------------------------------
    //
    // "A repository-wide ESLint rule bans imports of AI SDKs, direct IO calls,
    // Date.now, Math.random, and console.* from any packages/runtime-* package.
    // CI fails on violation." — ADR-013, Compliance / Validation.
    //
    // Scoped to the eight engine packages named in ADR-013 rather than the
    // `runtime-*` glob, because `runtime-session` is a kernel-side session
    // coordinator, not an engine: it legitimately owns the default-injection
    // seam for the clock. Listing the engines explicitly also means a ninth
    // engine cannot appear without someone editing this list, which is the
    // intended friction — ADR-013 locks the set at eight.
    files: [
      "packages/runtime-interaction-ui/src/**/*.ts",
      "packages/runtime-workflow/src/**/*.ts",
      "packages/runtime-rules/src/**/*.ts",
      "packages/runtime-operations/src/**/*.ts",
      "packages/runtime-data/src/**/*.ts",
      "packages/runtime-integration/src/**/*.ts",
      "packages/runtime-security-policy/src/**/*.ts",
      "packages/runtime-observability/src/**/*.ts",
    ],
    rules: {
      // Engines get time and randomness from ExecutionContext. There is no
      // sanctioned default-injection seam inside an engine — the kernel builds
      // the context, so the `?? (() => new Date())` idiom is banned here too.
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Engines must use `context.now()` (ADR-013). The kernel injects the clock." },
        { name: "Math", message: "Engines must use `context.random()` (ADR-013). `Math.random()` is non-deterministic; other Math members are fine via a local alias if genuinely needed." },
        { name: "process", message: "Engines must not read `process.env` or touch the process (ADR-013). Pass values through ExecutionContext.featureFlags." },
        { name: "crypto", message: "Engines must not generate randomness (ADR-013). Derive ids from `context.random()`." },
        { name: "fetch", message: "Engines perform no IO (ADR-013). Return a `dispatch-operation` or `emit` EffectDescriptor instead." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Engines must use `context.now()` (ADR-013) — no wall-clock reads, not even as a default.",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Engines must use `context.now()` (ADR-013).",
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Engines must use `context.random()` (ADR-013).",
        },
        {
          selector: "CallExpression[callee.object.name='crypto'][callee.property.name='randomUUID']",
          message: "Engines must derive ids deterministically from `context.random()` (ADR-013).",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:fs", message: "Engines perform no filesystem IO (ADR-013). Return an EffectDescriptor." },
            { name: "fs", message: "Engines perform no filesystem IO (ADR-013). Return an EffectDescriptor." },
            { name: "node:fs/promises", message: "Engines perform no filesystem IO (ADR-013)." },
            { name: "node:http", message: "Engines perform no network IO (ADR-013). Return a `dispatch-operation` effect." },
            { name: "node:https", message: "Engines perform no network IO (ADR-013)." },
            { name: "node:child_process", message: "Engines never spawn processes (ADR-013)." },
            { name: "node:crypto", message: "Engines must not source randomness (ADR-013). Use `context.random()`." },
            { name: "pg", message: "Engines never talk to a database (ADR-013). Return a `persist` effect." },
            // ADR-013: "No AI/model SDK imports. Ever."
            { name: "@anthropic-ai/sdk", message: "Engines must never import an AI SDK (ADR-013)." },
            { name: "openai", message: "Engines must never import an AI SDK (ADR-013)." },
            { name: "@appbana/adapter-ai-contract", message: "Engines must never reach the AI adapter layer (ADR-013)." },
            // ADR-013: "No reading of BIM or AIM — only the engine's assigned CAM sub-model."
            { name: "@appbana/business-intent-model", message: "Engines read only their CAM sub-model, never BIM (ADR-013)." },
            { name: "@appbana/application-intent-schema", message: "Engines read only their CAM sub-model, never AIM (ADR-013)." },
            { name: "@appbana/normalization-agent", message: "Engines are downstream of normalization and never invoke it (ADR-013)." },
          ],
          patterns: [
            { group: ["@appbana/adapter-ai-*"], message: "Engines must never import an AI adapter (ADR-013)." },
          ],
        },
      ],
      // Engines emit through context.logger.trace(), never stdout.
      "no-console": "error",
    },
  },

  {
    // Tests and fixtures are outside the deterministic execution path. Fakes
    // deliberately use randomness and wall-clock time to simulate real
    // adapters; the determinism guarantee is asserted, not enforced, here.
    files: ["**/__tests__/**/*.ts"],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
      "no-restricted-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    // Tooling scripts are executables; console output is their interface.
    files: ["tools/**/*.mjs", "tools/**/*.js", "**/*.config.mjs"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
    },
  },
);
