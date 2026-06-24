/**
 * MCP config helpers for the management UI: parsing pasted `mcp.json` (in any of
 * the common shapes), extracting accidentally-pasted raw secrets into the secrets
 * store as `{{secret:NAME}}` placeholders, and building a tidy JSON preview for a
 * single server entry.
 *
 * The worker is the source of truth for how `mcp.json` is ultimately serialized;
 * these helpers only translate user input into the in-memory `McpServerConfig`
 * shape the rest of the config page works with.
 *
 * @packageDocumentation
 */

import type { McpServerConfig } from "@second-brain/shared";

/**
 * Header names that almost always carry a secret. Used when importing pasted JSON
 * to decide which literal header values to lift into the secrets store (so the
 * brain branch never records a plaintext token).
 */
const SECRET_HEADER_RE = /(authorization|api[-_]?key|x-api-?key|token|secret|bearer|password|pass\b|auth)/i;

/** Matches a `{{secret:NAME}}` placeholder and captures the secret name. */
const SECRET_REF_RE = /^\{\{\s*secret:([A-Za-z0-9_.-]{1,64})\s*\}\}$/;

/** Build the canonical placeholder string for referencing a stored secret. */
export function secretPlaceholder(name: string): string {
  return `{{secret:${name}}}`;
}

/** If `value` is a `{{secret:NAME}}` reference, return NAME; otherwise null. */
export function parseSecretRef(value: string): string | null {
  const m = SECRET_REF_RE.exec(value.trim());
  return m ? m[1]! : null;
}

/** Coerce arbitrary text into a valid secret name (letters, digits, _ . -). */
export function sanitizeSecretName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "SECRET").slice(0, 64);
}

/** A raw secret lifted out of pasted JSON, ready to persist via the secrets API. */
export interface ExtractedSecret {
  name: string;
  value: string;
}

/** Result of importing a pasted `mcp.json` document. */
export interface ParsedMcpImport {
  servers: McpServerConfig[];
  /** Raw secrets discovered in headers, to be saved before the servers are used. */
  secrets: ExtractedSecret[];
}

/**
 * Strip `//` line comments and block comments from a JSONC string, while leaving
 * the contents of double-quoted strings untouched (so a `//` inside a URL value
 * survives). Comments are a common copy-paste artifact from editor `mcp.json`.
 */
function stripJsonComments(input: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Remove trailing commas (a comma immediately before a closing `}`/`]`), again
 * skipping the inside of double-quoted strings. JSON forbids trailing commas but
 * humans (and editor `mcp.json`) write them constantly.
 */
function stripTrailingCommas(input: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += input[i + 1] ?? "";
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      if (input[j] === "}" || input[j] === "]") continue; // drop the trailing comma
    }
    out += c;
  }
  return out;
}

/**
 * Parse a possibly-messy JSON(C) document: tolerate comments, trailing commas,
 * odd whitespace, and a bare object entry/fragment (e.g. a single
 * `"name": { … }` pair copied without the surrounding braces) by wrapping it.
 */
function relaxedJsonParse(text: string): Record<string, unknown> {
  let t = stripTrailingCommas(stripJsonComments(text)).trim();
  // Wrap a bare `"key": { … }` fragment (or comma-separated fragments) so it
  // becomes a valid object whose keys are server ids.
  if (!t.startsWith("{") && !t.startsWith("[")) t = `{${t}}`;
  // A trailing comma can still sit just before the (now outer) close brace, or at
  // the very end of the document — clean both up.
  t = stripTrailingCommas(t).replace(/,\s*$/, "");
  return JSON.parse(t) as Record<string, unknown>;
}


/** Normalize a single raw entry (from any shape) into a `McpServerConfig`. */
function normalizeEntry(id: string, raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url : "";
  const finalId = (typeof r.id === "string" && r.id) || id;
  if (!finalId || !url) return null;
  const out: McpServerConfig = { id: finalId, url, enabled: r.enabled !== false };
  if (r.type === "http" || r.type === "sse") out.type = r.type;
  if (r.headers && typeof r.headers === "object") {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
    if (Object.keys(headers).length > 0) out.headers = headers;
  }
  return out;
}

/**
 * Parse a pasted `mcp.json` document, tolerating the array form
 * (`{ servers: [...] }`), an object map (`{ servers: { id: {...} } }`), the
 * standard `{ mcpServers: { id: {...} } }` shape, a bare id→entry map (no wrapper
 * key), a single-server object, and even a loose `"id": { ... }` fragment.
 * Comments, trailing commas, and odd whitespace are corrected automatically.
 * Throws only if the text still yields no usable server with a `url`.
 *
 * Any header value that looks like a raw secret (non-placeholder value under a
 * secret-like header name) is lifted into the returned `secrets` list and
 * replaced in-place with a `{{secret:NAME}}` placeholder, so the caller can
 * persist the secret and keep the brain branch free of plaintext.
 */
export function parseMcpJson(text: string, existingSecretNames: string[] = []): ParsedMcpImport {
  const doc = relaxedJsonParse(text);
  // Prefer an explicit wrapper key; otherwise, if it isn't a bare single server,
  // treat the whole document as an id→entry map (covers wrapped fragments and a
  // pasted inner server map). Non-server keys (e.g. `inputs`) are skipped below.
  let source: unknown = doc.servers ?? doc.mcpServers;
  if (!source && typeof doc.url !== "string") source = doc;
  const servers: McpServerConfig[] = [];

  if (Array.isArray(source)) {
    for (const entry of source) {
      const cfg = normalizeEntry("", entry);
      if (cfg) servers.push(cfg);
    }
  } else if (source && typeof source === "object") {
    for (const [id, entry] of Object.entries(source as Record<string, unknown>)) {
      const cfg = normalizeEntry(id, entry);
      if (cfg) servers.push(cfg);
    }
  } else if (typeof doc.url === "string") {
    // A bare single-server object (no wrapper key).
    const cfg = normalizeEntry("", doc);
    if (cfg) servers.push(cfg);
  }

  if (servers.length === 0) throw new Error("No remote MCP server with a 'url' found in the JSON.");


  // Lift raw secrets out of headers so the form only ever holds placeholders.
  const secrets: ExtractedSecret[] = [];
  const used = new Set(existingSecretNames);
  for (const server of servers) {
    if (!server.headers) continue;
    for (const [headerName, value] of Object.entries(server.headers)) {
      if (parseSecretRef(value)) continue; // already a placeholder
      if (!value || !SECRET_HEADER_RE.test(headerName)) continue; // not secret-like
      const base = sanitizeSecretName(`${server.id}_${headerName}`);
      let name = base;
      let n = 1;
      while (used.has(name)) name = `${base}_${n++}`;
      used.add(name);
      secrets.push({ name, value });
      server.headers[headerName] = secretPlaceholder(name);
    }
  }

  return { servers, secrets };
}

/**
 * Build a pretty-printed standard-`mcp.json` preview for a single server entry
 * (object-map keyed by id), so the user can see exactly what will be written.
 */
export function serverToJsonPreview(server: McpServerConfig): string {
  const entry: Record<string, unknown> = { url: server.url || "https://…" };
  if (server.type) entry.type = server.type;
  if (server.headers && Object.keys(server.headers).length > 0) entry.headers = server.headers;
  if (server.enabled === false) entry.enabled = false;
  return JSON.stringify({ mcpServers: { [server.id || "server-id"]: entry } }, null, 2);
}
