/**
 * Small utilities that appear across sub-model builders:
 *   - a mutable diagnostic collector,
 *   - JSON-Pointer escaping,
 *   - id-slug helpers.
 */

import type { CamGeneratorDiagnostic } from "./types.js";

export class DiagnosticCollector {
  private readonly items: CamGeneratorDiagnostic[] = [];

  emit(severity: CamGeneratorDiagnostic["severity"], code: string, path: string, message: string): void {
    this.items.push({ severity, code, path, message });
  }

  info(code: string, path: string, message: string): void {
    this.emit("info", code, path, message);
  }
  warn(code: string, path: string, message: string): void {
    this.emit("warning", code, path, message);
  }
  err(code: string, path: string, message: string): void {
    this.emit("error", code, path, message);
  }

  toArray(): readonly CamGeneratorDiagnostic[] {
    return this.items.slice();
  }
}

export function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Strip the leading `<kind>.` prefix (e.g. `role.applicant` -> `applicant`). */
export function stripKindPrefix(id: string): string {
  const dot = id.indexOf(".");
  return dot < 0 ? id : id.slice(dot + 1);
}

/** True when a string looks like an AIM field path (`entity.<x>.<field>`). */
export function looksLikePath(value: string): boolean {
  return /^entity\.[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*/.test(value);
}
