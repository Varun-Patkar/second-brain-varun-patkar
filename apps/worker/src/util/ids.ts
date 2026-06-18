/**
 * Small id and hashing helpers. `contentHash` is a cheap, synchronous FNV-1a hash
 * used only to make graph upserts idempotent (re-applying the same content is a
 * no-op); it is not used for security.
 *
 * @packageDocumentation
 */

/** Generate a stable, sortable-ish node/edge id. */
export function genId(prefix = "node"): string {
  // crypto.randomUUID is available in the Workers runtime.
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** Cheap, synchronous 32-bit FNV-1a hash, returned as 8 hex chars. */
export function contentHash(...parts: string[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("\u0000");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in 32-bit range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Current ISO timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
