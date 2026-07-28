// check.accessibility-validation — ADR-017 gate check #4.
//
// This is a narrow first implementation, not the full accessibility suite. It
// enforces exactly one invariant, the one ADR-018 made enforceable:
//
//   A CAM whose InteractionModel was invented by the generator rather than
//   projected from AIM presentation intent may not activate outside `dev`.
//
// The reasoning is an accessibility argument, not a bookkeeping one. A layout
// derived from a role x entity cross-product has no grouping, no reading order,
// no labels beyond the raw field identifiers, and no step boundaries. It is a
// wall of inputs. Nobody looked at it. Shipping that to a person using a screen
// reader is the accessibility failure — the missing provenance is just how the
// gate can tell.
//
// Everything else this check will eventually assert (contrast, focus order,
// label association, target sizes) is still unimplemented and is reported
// honestly in the evidence rather than being implied by a green verdict.

import type {
  GateCheck,
  GateCheckContext,
  GateCheckInput,
  GateCheckVerdict,
  Json,
  JsonObject,
} from "../types.js";

export const ACCESSIBILITY_CHECK_VERSION = "0.1.0";

const CHECK_ID = "check.accessibility-validation";

/** Environments in which an unreviewed, generator-invented layout is tolerable. */
const PERMISSIVE_ENVIRONMENTS = new Set(["dev"]);

export const ACCESSIBILITY_FAILURE_CODES = {
  /** InteractionModel.origin is `generator-fallback` outside a dev environment. */
  UNREVIEWED_LAYOUT: "ACCESSIBILITY_UNREVIEWED_LAYOUT",
} as const;

const EVIDENCE_CONTRACT = {
  type: "object",
  required: ["origin", "environment", "assertionsImplemented", "assertionsNotYetImplemented"],
  additionalProperties: false,
  properties: {
    origin: { type: ["string", "null"] },
    environment: { type: ["string", "null"] },
    assertionsImplemented: { type: "array", items: { type: "string" } },
    assertionsNotYetImplemented: { type: "array", items: { type: "string" } },
  },
} as const;

const NOT_YET_IMPLEMENTED = [
  "contrast-ratio",
  "focus-order",
  "label-association",
  "target-size",
  "error-identification",
] as const;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function accessibilityValidationCheck(): GateCheck {
  const evaluate = async (
    input: GateCheckInput,
    ctx: GateCheckContext,
  ): Promise<GateCheckVerdict> => {
    const startedAt = ctx.clock();
    const interactionModel = input.cam["InteractionModel"] as JsonObject | undefined;
    const metadata = input.cam["metadata"] as JsonObject | undefined;

    const origin = readString(interactionModel?.["origin"]);
    const environment = readString(metadata?.["environment"]);

    const evidence: Json = {
      origin,
      environment,
      assertionsImplemented: ["layout-provenance"],
      assertionsNotYetImplemented: [...NOT_YET_IMPLEMENTED],
    };

    // Fail closed. An absent environment is not a dev environment.
    const isPermissive = environment !== null && PERMISSIVE_ENVIRONMENTS.has(environment);

    if (origin === "generator-fallback" && !isPermissive) {
      return {
        checkId: CHECK_ID,
        checkVersion: ACCESSIBILITY_CHECK_VERSION,
        outcome: "blocked",
        failureCode: ACCESSIBILITY_FAILURE_CODES.UNREVIEWED_LAYOUT,
        evidence,
        diagnostics: [
          {
            severity: "error",
            code: ACCESSIBILITY_FAILURE_CODES.UNREVIEWED_LAYOUT,
            path: "/InteractionModel/origin",
            message:
              "The InteractionModel was invented by the CAM generator because the AIM carried no " +
              `interactionFlows, and this CAM targets environment '${environment ?? "unspecified"}'. ` +
              "A role x entity cross-product has no field grouping, no reading order and no " +
              "human-authored labels. Add interactionFlows to the AIM (ADR-018) or activate in dev.",
          },
        ],
        evaluatedAt: startedAt,
        durationMs: 0,
      };
    }

    return {
      checkId: CHECK_ID,
      checkVersion: ACCESSIBILITY_CHECK_VERSION,
      outcome: "passed",
      evidence,
      diagnostics:
        origin === "generator-fallback"
          ? [
              {
                severity: "warning",
                code: ACCESSIBILITY_FAILURE_CODES.UNREVIEWED_LAYOUT,
                path: "/InteractionModel/origin",
                message:
                  "The InteractionModel was invented by the CAM generator. Allowed here only " +
                  "because this CAM targets dev; it will block on any other environment.",
              },
            ]
          : [],
      evaluatedAt: startedAt,
      durationMs: 0,
    };
  };

  return {
    id: CHECK_ID,
    version: ACCESSIBILITY_CHECK_VERSION,
    timeoutMs: 1_000,
    evidenceContract: EVIDENCE_CONTRACT as unknown as Record<string, never>,
    failureTaxonomy: [ACCESSIBILITY_FAILURE_CODES.UNREVIEWED_LAYOUT],
    evaluate,
  };
}
