// InMemoryGovernanceRegistry — Phase 1 driver. Backed by a Map keyed by
// pointerKey(appId, tenantId). No history (ADR-017 defines the durable
// append-only history table; Phase 1 in-process only stores the current
// pointer). Idempotency: activate() with identical `(camContentHash,
// camVersion, gateReportId, activatedBy)` returns the existing pointer
// unchanged so the `activatedAt` stamp is stable.

import type {
  ActivateInput,
  ActiveVersionPointer,
  GovernanceRegistry,
} from "./types.js";

export interface InMemoryGovernanceRegistryConfig {
  readonly now?: () => Date;
}

export function pointerKey(appId: string, tenantId: string): string {
  return `${appId}\x00${tenantId}`;
}

export class InMemoryGovernanceRegistry implements GovernanceRegistry {
  private readonly pointers = new Map<string, ActiveVersionPointer>();
  private readonly now: () => Date;

  constructor(config: InMemoryGovernanceRegistryConfig = {}) {
    this.now = config.now ?? (() => new Date());
  }

  async activate(input: ActivateInput): Promise<ActiveVersionPointer> {
    const key = pointerKey(input.appId, input.tenantId);
    const existing = this.pointers.get(key);
    if (isIdempotentReplay(existing, input)) return existing;
    const pointer: ActiveVersionPointer = {
      appId: input.appId,
      tenantId: input.tenantId,
      camContentHash: input.camContentHash,
      camVersion: input.camVersion,
      gateReportId: input.gateReportId,
      activatedBy: input.activatedBy,
      activatedAt: this.now().toISOString(),
      kind: "active",
    };
    this.pointers.set(key, pointer);
    return pointer;
  }

  async getActive(
    appId: string,
    tenantId: string,
  ): Promise<ActiveVersionPointer | undefined> {
    return this.pointers.get(pointerKey(appId, tenantId));
  }

  async listActive(): Promise<readonly ActiveVersionPointer[]> {
    return [...this.pointers.values()].sort((a, b) => {
      if (a.appId !== b.appId) return a.appId.localeCompare(b.appId);
      return a.tenantId.localeCompare(b.tenantId);
    });
  }
}

function isIdempotentReplay(
  existing: ActiveVersionPointer | undefined,
  input: ActivateInput,
): existing is ActiveVersionPointer {
  return (
    existing?.kind === "active" &&
    existing.camContentHash === input.camContentHash &&
    existing.camVersion === input.camVersion &&
    existing.gateReportId === input.gateReportId &&
    existing.activatedBy === input.activatedBy
  );
}
