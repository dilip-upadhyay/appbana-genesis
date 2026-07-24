/**
 * Adapter configuration and init-time context.
 *
 * Traces to ADR-015 § *Discovery and Binding*. Config is opaque to the platform —
 * each adapter package documents its own shape via the AI Adapter Manifest v0.1
 * schema (follow-up deliverable). Secrets referenced by config MUST live in a
 * Kubernetes Secret per ADR-016 `GenesisAdapterBinding.spec.configRef`.
 */

/**
 * Adapter-specific configuration. Deliberately typed as an unknown record; each
 * adapter narrows this via a package-local Zod / JSON-Schema check inside `init()`.
 */
export type AIAdapterConfig = Readonly<Record<string, unknown>>;

/**
 * Init-time context the kernel provides once, before the adapter serves any calls.
 * Carries the deployment mode so adapters can refuse to initialise when their
 * capabilities violate the mode invariants (defense in depth over the kernel's
 * load-time refusal).
 */
export interface AIAdapterInitContext {
  readonly deploymentMode: "saas" | "dedicated-cloud" | "air-gapped";
  readonly platformKernelVersion: string;
  /** Logger provided by the kernel. Adapters MUST use it instead of `console`. */
  readonly logger: {
    readonly debug: (message: string, context?: Record<string, unknown>) => void;
    readonly info: (message: string, context?: Record<string, unknown>) => void;
    readonly warn: (message: string, context?: Record<string, unknown>) => void;
    readonly error: (message: string, context?: Record<string, unknown>) => void;
  };
}
