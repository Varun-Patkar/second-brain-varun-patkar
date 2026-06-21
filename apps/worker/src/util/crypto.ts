/**
 * Web Crypto helpers: HMAC-SHA256 signing/verification and base64url encoding.
 * Used to sign stateless session tokens and CSRF `state` values.
 *
 * @packageDocumentation
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** base64url-encode a byte array or string. */
export function b64urlEncode(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? enc.encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url-decode to a UTF-8 string. */
export function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return dec.decode(bytes);
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Sign `data` with HMAC-SHA256, returning a base64url signature. */
export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlEncode(sig);
}

/** Constant-time-ish verify of an HMAC-SHA256 signature. */
export async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, data);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Derive a stable 256-bit AES-GCM key from an arbitrary secret string. */
async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypt `plaintext` with AES-256-GCM under a key derived from `secret`. The
 * random 12-byte IV is prepended to the ciphertext and the whole blob is returned
 * base64url-encoded, so it round-trips through string storage (e.g. Workers KV).
 */
export async function aesEncrypt(secret: string, plaintext: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const blob = new Uint8Array(iv.length + ct.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ct), iv.length);
  return b64urlEncode(blob.buffer);
}

/**
 * Decrypt a blob produced by {@link aesEncrypt}. Throws if the data is malformed
 * or the key/secret does not match (GCM authentication failure).
 */
export async function aesDecrypt(secret: string, encoded: string): Promise<string> {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const key = await aesKey(secret);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}
