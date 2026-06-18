/**
 * Cloudflare Worker environment bindings.
 *
 * Non-secret values come from `[vars]` in wrangler.toml; secrets are injected via
 * `wrangler secret put` and are never committed. The framework reads credentials
 * through `getCredential` callbacks so they are never logged or persisted.
 *
 * @packageDocumentation
 */

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  /** D1: knowledge graph + FTS5 + outbox. */
  DB: D1Database;
  /** KV: hot-node + graph-index cache. */
  CACHE: KVNamespace;

  /* ---- Non-secret vars ---- */
  /** "owner/repo" holding the wiki. */
  GH_REPO: string;
  /** Branch holding the markdown wiki (never merges to main). */
  BRAIN_BRANCH: string;
  /** GitHub Pages origin allowed to call this worker. */
  ALLOWED_ORIGIN: string;
  /** OAuth app client id (public). */
  GH_CLIENT_ID: string;
  /** Comma-separated Copilot model ids the UI may pick. */
  COPILOT_MODELS: string;
  /** Default Copilot model id. */
  COPILOT_DEFAULT_MODEL: string;

  /* ---- Secrets (wrangler secret put) ---- */
  /** GitHub Copilot token (short-lived; manual refresh, loud expiry). */
  COPILOT_TOKEN: string;
  /** OAuth app client secret (code exchange only). */
  GH_CLIENT_SECRET: string;
  /** Token used to read/write the `brain` branch via the GitHub API. */
  GH_TOKEN: string;
  /** The single allowed GitHub user id (numeric, as a string). */
  OWNER_GH_ID: string;
  /** Random secret used to sign session tokens. */
  SESSION_SECRET: string;
}
