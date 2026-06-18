/**
 * Secret redaction for anything that might be surfaced (errors, traces, logs).
 * Credentials are never intentionally logged, but this is a defense-in-depth pass
 * that masks known secret values and common token shapes.
 *
 * @packageDocumentation
 */

import type { Env } from "../env.js";

/** Token-shaped patterns to mask even if the exact secret value isn't known. */
const TOKEN_PATTERNS: RegExp[] = [
  /gh[posur]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /\b[A-Za-z0-9_-]{40,}\b/g, // long opaque blobs
];

/** Mask known secret values from the environment plus token-shaped substrings. */
export function redact(env: Env, text: string): string {
  let out = text;
  const secrets = [env.COPILOT_TOKEN, env.GH_CLIENT_SECRET, env.GH_TOKEN, env.SESSION_SECRET].filter(Boolean);
  for (const s of secrets) {
    if (s) out = out.split(s).join("«redacted»");
  }
  for (const re of TOKEN_PATTERNS) out = out.replace(re, "«redacted»");
  return out;
}
