/**
 * Stateless, signed session + CSRF-state tokens.
 *
 * A token is `base64url(json).signature`, where the signature is HMAC-SHA256 over
 * the payload using `SESSION_SECRET`. Both carry an `exp` (epoch seconds) so they
 * expire without server-side storage.
 *
 * @packageDocumentation
 */

import type { SessionInfo } from "@second-brain/shared";
import type { Env } from "../env.js";
import { b64urlDecode, b64urlEncode, hmacSign, hmacVerify } from "../util/crypto.js";

interface SessionPayload extends SessionInfo {
  /** GitHub numeric user id. */
  uid: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
const STATE_TTL_SECONDS = 60 * 10; // 10m

async function sign(env: Env, payload: object): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacSign(env.SESSION_SECRET, body);
  return `${body}.${sig}`;
}

async function verify<T>(env: Env, token: string): Promise<T | null> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!(await hmacVerify(env.SESSION_SECRET, body, sig))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body)) as { exp?: number };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as T;
  } catch {
    return null;
  }
}

/** Issue a signed session token for the authenticated owner. */
export function issueSession(env: Env, info: SessionInfo, uid: number): Promise<string> {
  return sign(env, { ...info, uid, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
}

/** Verify a session token; returns the session info or null. */
export async function verifySession(env: Env, token: string): Promise<SessionInfo | null> {
  const payload = await verify<SessionPayload>(env, token);
  if (!payload) return null;
  return { login: payload.login, avatarUrl: payload.avatarUrl };
}

/** Issue a signed CSRF state nonce for the OAuth redirect. */
export function issueState(env: Env): Promise<string> {
  return sign(env, { n: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS });
}

/** Validate a previously issued CSRF state nonce. */
export async function verifyState(env: Env, state: string): Promise<boolean> {
  return (await verify<{ n: string; exp: number }>(env, state)) !== null;
}
