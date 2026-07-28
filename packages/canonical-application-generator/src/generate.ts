/**
 * Top-level orchestrator: AIM v0.1 -> CAM v0.1 (10 sub-model envelope).
 *
 * The generator is a **pure function** of its inputs: identical `AimDocument`
 * plus identical `GenerateCamOptions` (crucially, identical `generatedAt`)
 * produces byte-identical CAM output when re-serialised with the canonical
 * JSON writer in `./hash.ts`.
 *
 * Consumers control determinism by injecting `generatedAt`. The generator
 * never reads the wall clock, never uses `Math.random`, never introspects the
 * environment.
 */

import type {
  AimDocument,
  GenerateCamOptions,
  GenerateCamResult,
  JsonObject,
} from "./types.js";
import { DiagnosticCollector } from "./diagnostics.js";
import { buildDataModel } from "./data-model.js";
import { buildWorkflowModel } from "./workflow-model.js";
import { buildRuleModel } from "./rule-model.js";
import { buildOperationModel } from "./operation-model.js";
import { buildSecurityModel } from "./security-model.js";
import { buildInteractionModel } from "./interaction-model.js";
import { buildObservabilityModel } from "./observability-model.js";
import { buildIntegrationModel } from "./integration-model.js";
import { buildDeploymentModel } from "./deployment-model.js";
import { buildMetadataModel } from "./metadata-model.js";
import { buildEnvelopeMetadata } from "./envelope-metadata.js";
import { contentHash } from "./hash.js";

const DEFAULT_ENVELOPE_VERSION = "1.0";
const DEFAULT_SUBMODEL_VERSION = "0.1.0";

export function generateCam(aim: AimDocument, opts: GenerateCamOptions): GenerateCamResult {
  const diagnostics = new DiagnosticCollector();
  const subModelVersion = opts.subModelVersion ?? DEFAULT_SUBMODEL_VERSION;
  const envelopeVersion = opts.envelopeVersion ?? DEFAULT_ENVELOPE_VERSION;

  const roles = readArray(aim.roles);
  const enums = readArray(aim.enums);
  const entities = readArray(aim.entities);
  const stateMachines = readArray(aim.stateMachines);
  const rules = readArray(aim.rules);
  const operations = readArray(aim.operations);
  const interactionFlows = readArray(aim.interactionFlows);

  const DataModel = buildDataModel(entities, enums, subModelVersion, diagnostics);
  const workflow = buildWorkflowModel(stateMachines, subModelVersion, diagnostics);
  const WorkflowModel = workflow.model;
  const RuleModel = buildRuleModel(rules, subModelVersion, diagnostics);
  const OperationModel = buildOperationModel(operations, entities, subModelVersion, diagnostics);
  const SecurityModel = buildSecurityModel(roles, entities, rules, subModelVersion, diagnostics);
  const InteractionModel = buildInteractionModel(
    roles,
    entities,
    interactionFlows,
    subModelVersion,
    diagnostics,
  );
  const ObservabilityModel = buildObservabilityModel(
    workflow.emittedEventKinds,
    operations,
    subModelVersion,
    diagnostics,
  );
  const IntegrationModel = buildIntegrationModel(subModelVersion);
  const DeploymentModel = buildDeploymentModel(subModelVersion);
  const MetadataModel = buildMetadataModel(aim, opts, subModelVersion);

  const metadata = buildEnvelopeMetadata(aim, opts);

  const cam: JsonObject = {
    envelopeVersion,
    metadata,
    InteractionModel,
    WorkflowModel,
    RuleModel,
    OperationModel,
    DataModel,
    IntegrationModel,
    SecurityModel,
    ObservabilityModel,
    DeploymentModel,
    MetadataModel,
  };

  const camContentHash = contentHash(cam);

  emitDroppedSectionDiagnostics(aim, diagnostics);

  return {
    cam,
    diagnostics: diagnostics.toArray(),
    camContentHash,
  };
}

function readArray(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

const DROPPABLE_SECTIONS = ["nonFunctional", "traceability", "openIssues", "documents"] as const;

function emitDroppedSectionDiagnostics(aim: AimDocument, diagnostics: DiagnosticCollector): void {
  for (const key of DROPPABLE_SECTIONS) {
    if (aim[key] !== undefined) {
      diagnostics.info(
        "CAM_GEN_AIM_SECTION_DROPPED",
        `/${key}`,
        `AIM section '${key}' has no CAM v0.1 representation; dropped.`,
      );
    }
  }
}
