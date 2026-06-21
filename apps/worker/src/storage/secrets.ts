/**
 * Secrets storage: owner-only, server-side secret values that must NEVER reach
 * the LLM or the markdown wiki (which is itself LLM-readable). Values are kept in
 * Workers KV, encrypted at rest with AES-256-GCM under a key derived from
 * `SESSION_SECRET`, and are only ever decrypted server-side at the point of use
 * (e.g. substituting a `{{secret:NAME}}` reference into an MCP server URL).
 *
 * The UI is WRITE-ONLY: it can list secret NAMES and set/overwrite or delete a
 * value, but can never read a stored value back. There is intentionally no route
 * that returns plaintext.
 *
 * @packageDocumentation
 */

import type { TurnContext } from "../runtime/context.js";
import { aesDecrypt, aesEncrypt } from "../util/crypto.js";

const PREFIX = "secret:";

/** Valid secret names: a small, safe identifier charset. */
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Whether a proposed secret name is well-formed. */
export function isValidSecretName(name: string): boolean {
  return NAME_RE.test(name);
}

/** List the names of all stored secrets (never the values). */
export async function listSecretNames(ctx: TurnContext): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  // Page through KV keys under the secret prefix.
  do {
    const res = await ctx.env.CACHE.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) });
    for (const k of res.keys) out.push(k.name.slice(PREFIX.length));
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Read and decrypt a secret value. SERVER-INTERNAL ONLY — never expose the result
 * over an HTTP response or in a trace. Returns null when the secret is absent or
 * cannot be decrypted.
 */
export async function getSecret(ctx: TurnContext, name: string): Promise<string | null> {
  if (!isValidSecretName(name)) return null;
  const raw = await ctx.env.CACHE.get(`${PREFIX}${name}`);
  if (!raw) return null;
  try {
    return await aesDecrypt(ctx.env.SESSION_SECRET, raw);
  } catch {
    return null;
  }
}

/** Encrypt and store (set or overwrite) a secret value. */
export async function putSecret(ctx: TurnContext, name: string, value: string): Promise<void> {
  if (!isValidSecretName(name)) throw new Error("invalid_secret_name");
  const encrypted = await aesEncrypt(ctx.env.SESSION_SECRET, value);
  await ctx.env.CACHE.put(`${PREFIX}${name}`, encrypted);
}

/** Delete a stored secret. */
export async function deleteSecret(ctx: TurnContext, name: string): Promise<void> {
  if (!isValidSecretName(name)) return;
  await ctx.env.CACHE.delete(`${PREFIX}${name}`);
}

/**
 * Resolve `{{secret:NAME}}` references inside a string by substituting the stored
 * (decrypted) value server-side. Unknown references are replaced with an empty
 * string so a missing secret never leaks the placeholder to a remote server.
 * Used to inject secrets into MCP server URLs at connect time.
 */
export async function resolveSecrets(ctx: TurnContext, text: string): Promise<string> {
  const refs = [...text.matchAll(/\{\{\s*secret:([A-Za-z0-9_.-]{1,64})\s*\}\}/g)];
  if (refs.length === 0) return text;
  let out = text;
  for (const m of refs) {
    const value = (await getSecret(ctx, m[1]!)) ?? "";
    out = out.split(m[0]).join(value);
  }
  return out;
}
