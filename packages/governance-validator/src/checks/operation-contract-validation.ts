// check.operation-contract-validation — REAL Phase 1 implementation.
//
// Verifies that every operation declared in the CAM `OperationModel` and every
// operation referenced by `WorkflowModel` state-machine effects has a matching
// Operation Contract in the injected registry, and that the CAM's declared
// adapter kind and side-effects are consistent with the contract.
//
// The registry is injected via `input.operationContracts` — this check has no
// runtime dependency on the metadata registry package.

import type {
  Diagnostic,
  GateCheck,
  GateCheckContext,
  GateCheckInput,
  GateCheckVerdict,
  Json,
  JsonObject,
} from "../types.js";

export const OP_CONTRACT_CHECK_ID = "check.operation-contract-validation";
export const OP_CONTRACT_CHECK_VERSION = "0.1.0";

export const OP_CONTRACT_FAILURE_CODES = [
  "OP_CONTRACT_MISSING",
  "OP_CONTRACT_ID_MISMATCH",
  "OP_CONTRACT_VERSION_MISMATCH",
  "OP_CONTRACT_ADAPTER_KIND_MISMATCH",
  "OP_SIDE_EFFECT_UNDECLARED",
  "OP_REF_UNDECLARED",
  "OP_MODEL_SHAPE_INVALID",
] as const;

export type OpContractFailureCode = (typeof OP_CONTRACT_FAILURE_CODES)[number];

const EVIDENCE_CONTRACT = {
  type: "object",
  required: ["problemCount", "problems", "checkedOperationCount"],
  additionalProperties: false,
  properties: {
    problemCount: { type: "integer", minimum: 0 },
    checkedOperationCount: { type: "integer", minimum: 0 },
    problems: {
      type: "array",
      items: {
        type: "object",
        required: ["failureCode", "path", "message"],
        additionalProperties: false,
        properties: {
          failureCode: { type: "string" },
          path: { type: "string" },
          message: { type: "string" },
          operationId: { type: "string" },
          operationVersion: { type: "string" },
        },
      },
    },
  },
} as const;

interface Problem {
  readonly failureCode: OpContractFailureCode;
  readonly path: string;
  readonly message: string;
  readonly operationId?: string;
  readonly operationVersion?: string;
}

/** Contract registry key = `<operationId>:v<majorVersion>` — matches the AIM/CAM triggeredBy suffix. */
export function operationContractKey(id: string, version: string): string {
  return `${id}:v${version}`;
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(obj: JsonObject, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readArray(obj: JsonObject, key: string): readonly Json[] {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

function readOperations(cam: JsonObject): readonly JsonObject[] {
  const operationModel = cam["OperationModel"];
  if (!isObject(operationModel)) return [];
  const ops = operationModel["operations"];
  if (!Array.isArray(ops)) return [];
  return ops.filter(isObject);
}

function readStateMachines(cam: JsonObject): readonly JsonObject[] {
  const workflow = cam["WorkflowModel"];
  if (!isObject(workflow)) return [];
  const sms = workflow["stateMachines"];
  if (!Array.isArray(sms)) return [];
  return sms.filter(isObject);
}

/**
 * Parse an `operation.<id>:vN` reference into `{id, version}`. Returns null if
 * the input does not match the pattern.
 */
export function parseOperationRef(
  ref: string,
): { readonly id: string; readonly version: string } | null {
  const idx = ref.lastIndexOf(":v");
  if (idx <= 0) return null;
  const id = ref.slice(0, idx);
  const version = ref.slice(idx + 2);
  if (id.length === 0 || version.length === 0) return null;
  if (!/^\d+$/.test(version)) return null;
  return { id, version };
}

function collectDispatchedRefs(cam: JsonObject): readonly { readonly ref: string; readonly path: string }[] {
  const out: { readonly ref: string; readonly path: string }[] = [];
  const sms = readStateMachines(cam);
  sms.forEach((sm, smIdx) => {
    const transitions = readArray(sm, "transitions");
    transitions.forEach((t, tIdx) => {
      if (!isObject(t)) return;
      const effects = readArray(t, "effects");
      effects.forEach((e, eIdx) => {
        if (!isObject(e)) return;
        if (e["type"] !== "dispatch-operation") return;
        const ref = readString(e, "operationRef");
        if (!ref) return;
        out.push({
          ref,
          path: `/WorkflowModel/stateMachines/${String(smIdx)}/transitions/${String(tIdx)}/effects/${String(eIdx)}/operationRef`,
        });
      });
    });
  });
  return out;
}

function pushOpModelShapeInvalid(problems: Problem[], path: string, message: string): void {
  problems.push({
    failureCode: "OP_MODEL_SHAPE_INVALID",
    path,
    message,
  });
}

function checkOneOperation(
  op: JsonObject,
  index: number,
  registry: ReadonlyMap<string, JsonObject>,
  problems: Problem[],
): void {
  const path = `/OperationModel/operations/${String(index)}`;
  const id = readString(op, "id");
  const version = readString(op, "version");
  if (!id || !version) {
    pushOpModelShapeInvalid(problems, path, "operation is missing id or version");
    return;
  }

  const contract = registry.get(operationContractKey(id, version));
  if (!contract) {
    problems.push({
      failureCode: "OP_CONTRACT_MISSING",
      path,
      message: `no Operation Contract registered for ${operationContractKey(id, version)}`,
      operationId: id,
      operationVersion: version,
    });
    return;
  }

  const contractId = readString(contract, "id");
  const contractVersion = readString(contract, "version");
  if (contractId !== id) {
    problems.push({
      failureCode: "OP_CONTRACT_ID_MISMATCH",
      path,
      message: `CAM operation id ${id} != contract id ${contractId ?? "<missing>"}`,
      operationId: id,
      operationVersion: version,
    });
  }
  if (contractVersion !== version) {
    problems.push({
      failureCode: "OP_CONTRACT_VERSION_MISMATCH",
      path,
      message: `CAM operation version ${version} != contract version ${contractVersion ?? "<missing>"}`,
      operationId: id,
      operationVersion: version,
    });
  }

  checkAdapterKind(op, contract, id, version, path, problems);
  checkSideEffects(op, contract, id, version, path, problems);
}

function checkAdapterKind(
  op: JsonObject,
  contract: JsonObject,
  id: string,
  version: string,
  opPath: string,
  problems: Problem[],
): void {
  const camAdapter = op["adapter"];
  const contractAdapter = contract["adapter"];
  if (!isObject(camAdapter) || !isObject(contractAdapter)) return;
  const camKind = readString(camAdapter, "kind");
  const contractKind = readString(contractAdapter, "kind");
  if (camKind && contractKind && camKind !== contractKind) {
    problems.push({
      failureCode: "OP_CONTRACT_ADAPTER_KIND_MISMATCH",
      path: `${opPath}/adapter/kind`,
      message: `CAM adapter kind "${camKind}" != contract adapter kind "${contractKind}"`,
      operationId: id,
      operationVersion: version,
    });
  }
}

function checkSideEffects(
  op: JsonObject,
  contract: JsonObject,
  id: string,
  version: string,
  opPath: string,
  problems: Problem[],
): void {
  const camSideEffects = readArray(op, "sideEffects").filter(
    (v): v is string => typeof v === "string",
  );
  const contractSideEffects = new Set(
    readArray(contract, "sideEffects").filter((v): v is string => typeof v === "string"),
  );
  camSideEffects.forEach((eff, effIdx) => {
    if (!contractSideEffects.has(eff)) {
      problems.push({
        failureCode: "OP_SIDE_EFFECT_UNDECLARED",
        path: `${opPath}/sideEffects/${String(effIdx)}`,
        message: `CAM declares sideEffect "${eff}" not present in contract sideEffects[]`,
        operationId: id,
        operationVersion: version,
      });
    }
  });
}

function checkDispatchedRefs(
  cam: JsonObject,
  declared: ReadonlySet<string>,
  problems: Problem[],
): void {
  const refs = collectDispatchedRefs(cam);
  refs.forEach(({ ref, path }) => {
    const parsed = parseOperationRef(ref);
    if (!parsed) {
      problems.push({
        failureCode: "OP_REF_UNDECLARED",
        path,
        message: `operationRef "${ref}" is not in canonical operation.<id>:vN form`,
      });
      return;
    }
    if (!declared.has(operationContractKey(parsed.id, parsed.version))) {
      problems.push({
        failureCode: "OP_REF_UNDECLARED",
        path,
        message: `operationRef "${ref}" is not declared in CAM OperationModel.operations[]`,
        operationId: parsed.id,
        operationVersion: parsed.version,
      });
    }
  });
}

function problemToDiagnostic(p: Problem): Diagnostic {
  return {
    severity: "error",
    code: p.failureCode,
    message: p.message,
    path: p.path,
  };
}

function problemToEvidenceEntry(p: Problem): Record<string, string> {
  const out: Record<string, string> = {
    failureCode: p.failureCode,
    path: p.path,
    message: p.message,
  };
  if (p.operationId !== undefined) out["operationId"] = p.operationId;
  if (p.operationVersion !== undefined) out["operationVersion"] = p.operationVersion;
  return out;
}

async function evaluateOperationContractValidation(
  input: GateCheckInput,
  ctx: GateCheckContext,
): Promise<GateCheckVerdict> {
  const evaluatedAt = ctx.clock();
  const startMs = Date.parse(evaluatedAt);

  const operations = readOperations(input.cam);
  const problems: Problem[] = [];

  operations.forEach((op, idx) => {
    checkOneOperation(op, idx, input.operationContracts, problems);
  });

  const declaredKeys = new Set<string>();
  operations.forEach((op) => {
    const id = readString(op, "id");
    const version = readString(op, "version");
    if (id && version) declaredKeys.add(operationContractKey(id, version));
  });

  checkDispatchedRefs(input.cam, declaredKeys, problems);

  if (problems.length === 0) {
    return {
      checkId: OP_CONTRACT_CHECK_ID,
      checkVersion: OP_CONTRACT_CHECK_VERSION,
      outcome: "passed",
      evidence: {
        problemCount: 0,
        checkedOperationCount: operations.length,
        problems: [],
      },
      diagnostics: [],
      evaluatedAt,
      durationMs: Date.parse(ctx.clock()) - startMs,
    };
  }

  const first = problems[0]!;
  return {
    checkId: OP_CONTRACT_CHECK_ID,
    checkVersion: OP_CONTRACT_CHECK_VERSION,
    outcome: "blocked",
    failureCode: first.failureCode,
    evidence: {
      problemCount: problems.length,
      checkedOperationCount: operations.length,
      problems: problems.map(problemToEvidenceEntry),
    },
    diagnostics: problems.map(problemToDiagnostic),
    evaluatedAt,
    durationMs: Date.parse(ctx.clock()) - startMs,
  };
}

export function operationContractValidationCheck(): GateCheck {
  return {
    id: OP_CONTRACT_CHECK_ID,
    version: OP_CONTRACT_CHECK_VERSION,
    timeoutMs: 30_000,
    evidenceContract: EVIDENCE_CONTRACT as unknown as Record<string, never>,
    failureTaxonomy: OP_CONTRACT_FAILURE_CODES,
    evaluate: evaluateOperationContractValidation,
  };
}
