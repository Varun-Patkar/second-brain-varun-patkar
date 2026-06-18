/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Cloudflare Worker backend. */
  readonly VITE_WORKER_URL?: string;
  /** Vite base path (defaults to the GitHub Pages project path). */
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
