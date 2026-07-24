/**
 * Symbol table extraction. Walks the AIM's known collection paths and gathers
 * every declared id + its JSON Pointer definition site. Also surfaces
 * duplicate-id errors when two definitions collide (case-sensitive compare).
 */

import type {
  AimDocument,
  AimDuplicateIdError,
  AimSymbol,
  AimSymbolKind,
  AimSymbolTable,
} from "./types.js";

/**
 * Ordered list of `{arrayKey, symbolKind}` pairs \u2014 order matches the AIM v0.1
 * schema. Only elements that carry cross-referenceable ids are included.
 */
const SYMBOL_COLLECTIONS: readonly (readonly [string, AimSymbolKind])[] = [
  ["roles", "role"],
  ["enums", "enum"],
  ["entities", "entity"],
  ["stateMachines", "state-machine"],
  ["operations", "operation"],
  ["rules", "rule"],
];

export function collectSymbolTable(aim: AimDocument): AimSymbolTable {
  const byId = new Map<string, AimSymbol>();
  const byKind = new Map<AimSymbolKind, AimSymbol[]>();
  const duplicates: AimDuplicateIdError[] = [];

  for (const [key, kind] of SYMBOL_COLLECTIONS) {
    const list = extractArray(aim, key);
    if (list === undefined) continue;
    const bucket: AimSymbol[] = [];
    byKind.set(kind, bucket);
    list.forEach((item, index) => {
      const id = extractId(item);
      if (id === undefined) return;
      const symbol: AimSymbol = {
        kind,
        id,
        definedAt: `/${key}/${index}/id`,
      };
      const existing = byId.get(id);
      if (existing !== undefined) {
        duplicates.push({
          id,
          kind,
          firstDefinedAt: existing.definedAt,
          duplicateDefinedAt: symbol.definedAt,
        });
        return;
      }
      byId.set(id, symbol);
      bucket.push(symbol);
    });
  }

  return {
    byId,
    byKind,
    duplicates,
  };
}

function extractArray(aim: AimDocument, key: string): readonly unknown[] | undefined {
  const value = (aim as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
}

function extractId(item: unknown): string | undefined {
  if (item === null || typeof item !== "object") return undefined;
  const id = (item as Record<string, unknown>)["id"];
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
