// Public barrel.

export type {
  ActivateInput,
  ActiveVersionPointer,
  DeploymentMode,
  GovernanceRegistry,
  LoadedAdapterSummary,
  LoadedCam,
  LoadedCamSummary,
  VersionInfo,
} from "./types.js";
export {
  CamKindMismatchError,
  CamNotFoundError,
  CamVersionMismatchError,
  NoActivePointerError,
  PointerHaltedError,
} from "./types.js";

export {
  InMemoryGovernanceRegistry,
  pointerKey,
} from "./governance-registry.js";
export type { InMemoryGovernanceRegistryConfig } from "./governance-registry.js";

export { LoadedCamCache } from "./cache.js";

export { refreshCam, resolveCam } from "./resolver.js";
export type { ResolveCamOptions } from "./resolver.js";

export { buildVersionInfo } from "./version.js";
export type { BuildVersionInfoInput } from "./version.js";
