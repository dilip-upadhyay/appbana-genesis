// @appbana/engine-contract — public API.
//
// The executable form of ADR-013. Import the contract from here; deep imports
// into `src/` are not part of the public surface.

export type { Json, JsonObject } from "./json.js";
export { canonicalJson, isJson, jsonViolation } from "./json.js";

export type {
  DispatchOperationEffect,
  EffectDescriptor,
  EffectPayload,
  EffectType,
  EmitEffect,
  NotifyEffect,
  PersistEffect,
  ScheduleEffect,
  TransitionEffect,
} from "./effect.js";
export { EFFECT_TYPES, effectViolation, isEffectDescriptor } from "./effect.js";

export type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";
export { DIAGNOSTIC_SEVERITIES, diagnosticViolation, hasError } from "./diagnostic.js";

export type {
  EngineId,
  TraceAttributeValue,
  TraceContext,
  TraceCorrelation,
  TraceEvent,
  TracePrincipal,
  TraceProducer,
  TraceRedaction,
  TraceScope,
  TraceSeverity,
} from "./trace-event.js";
export {
  ENGINE_IDS,
  ENGINE_SUB_MODEL,
  MANDATED_TRACE_DECISIONS,
  asPayload,
  traceEventViolation,
} from "./trace-event.js";

export type {
  AnyRuntimeEngine,
  EngineCapabilityDeclaration,
  EnginePrincipal,
  EngineResult,
  ExecutionContext,
  RuntimeEngine,
  TraceLogger,
} from "./engine.js";

export type { ExecutionContextSeed } from "./context.js";
export {
  createExecutionContext,
  recordingLogger,
  seededRandom,
  steppedClock,
} from "./context.js";

export type {
  ConformanceCheckId,
  ConformanceFixture,
  ConformanceOptions,
  ConformanceReport,
  ConformanceViolation,
  TraceSchemaValidator,
} from "./conformance.js";
export { formatReport, runConformanceSuite } from "./conformance.js";
