/**
 * Shared test helper: minimal AIProvenanceRecord factory.
 */

import type { AIProvenanceRecord } from "@appbana/adapter-ai-contract";

export function makeRecord(
  overrides: Partial<AIProvenanceRecord> = {},
): AIProvenanceRecord {
  return {
    aiProvenanceVersion: "0.1",
    modelBinding: "ai:local-llama",
    modelName: "llama-3.3-70b-instruct",
    modelVersion: "2025-01-15",
    promptTemplateRef: "prompt.ba-agent.intake",
    promptTemplateVersion: "1.0.0",
    promptTemplateHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    inputHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    outputHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    tokenUsage: { input: 128, output: 64, total: 192 },
    wallClockMs: 1234,
    requestedAt: "2026-07-24T12:00:00.000Z",
    completedAt: "2026-07-24T12:00:01.234Z",
    requestingAgent: "agent.ba-agent",
    redactions: [],
    ...overrides,
  };
}
