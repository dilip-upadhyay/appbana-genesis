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
    // Tests and fixtures are outside the deterministic execution path. Fakes
    // deliberately use randomness and wall-clock time to simulate real
    // adapters; the determinism guarantee is asserted, not enforced, here.
    files: ["**/__tests__/**/*.ts"],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
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
