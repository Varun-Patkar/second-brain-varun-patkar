# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is
A single-user, free-tier "second brain": a GitHub Pages chat frontend + a Cloudflare Worker backend
(built on the `agent-framework-js` npm package) that maintains a markdown wiki on a git `brain`
branch, indexed by Cloudflare D1 (graph + FTS5). Read [ARCHITECTURE.md](ARCHITECTURE.md) first — it
is the source of truth for design decisions.

## Layout & docs (read these, don't duplicate)
npm workspaces monorepo (Node ≥ 20, ESM):
- `packages/shared` — domain types + wire contracts, imported as `@second-brain/shared`.
- `apps/worker` — Cloudflare Worker (agents, tools, storage, auth). See [architecture map](#architecture-map-worker).
- `apps/web` — React + Vite + Tailwind chat UI (GitHub Pages): streaming chat, provider/model picker,
  voice input (Whisper STT over a devtunnel), image attachments for vision models, and a settings
  bottom-sheet on mobile. Provider/STT config persists in `localStorage`.
- `scripts/` — dev helpers (e.g. `tunnels.ps1`: dev tunnels for LM Studio and/or the STT server).

Source-of-truth docs: [ARCHITECTURE.md](ARCHITECTURE.md) (design + rationale),
[README.md](README.md) (local dev, one-time setup, scripts). Link to these instead of restating them.

## Build, run & validate
Run from the repo root unless noted:
- `npm run typecheck` — all workspaces. **This is the only check CI runs** ([ci.yml](.github/workflows/ci.yml)); always run it before finishing. There are no unit tests yet (`npm test` is a no-op).
- `npx wrangler deploy --dry-run --outdir dist` — from `apps/worker`, validates the Worker bundle.
- `npm run dev:worker` (`:8787`) / `npm run dev:web` (`:5173`) — local dev.
- `npm run db:migrate:local --workspace apps/worker` — apply D1 schema to the local miniflare DB.

Local secrets/vars live in `apps/worker/.dev.vars` and `apps/web/.env` (both gitignored) — see
[README](README.md#local-development); never commit or log them.

## Hard constraints (do not violate)
- **Free tier only.** No paid services. The Worker Free tier caps matter: 10 ms CPU/request,
  **50 subrequests/request**, 6 simultaneous outgoing connections, 128 MB.
- **Every LLM, GitHub API, and D1 call is a subrequest.** Keep per-turn counts low. Charge the
  `Budget` (`src/runtime/budget.ts`) for every git/D1 call; the provider middleware charges LLM calls.
- **Markdown is the source of truth; D1 is a rebuildable index.** Never make D1 authoritative.
- **One commit per turn** via the Git Data API (`src/storage/github.ts` → `commitBatch`). Never write
  one-commit-per-file.
- **No hard deletes.** Trash moves markdown to `_deleted/` and drops the node from D1/FTS.
- **The `brain` branch never merges to `main`.**
- **MCP servers must be remote (HTTPS).** stdio can't run in the Worker. Each MCP connect/tool call
  is a subrequest — charge the `Budget` and keep per-turn counts low. MCP servers + skills are
  configured in `mcp.json` + `skills/*.md` on the `brain` branch (KV-cached; agent-editable via
  `write_config`).
- **Secrets** come only from `getCredential` callbacks / Worker env; never log or persist them.
  Pass anything user-facing through `redact()` (`src/middleware/redaction.ts`).

## Architecture map (worker)
- `src/index.ts` — router (CORS, auth routes, SSE `/chat`).
- `src/turn.ts` — turn orchestration: load brain config (MCP + skills) → brain agent (streamed) → conditional consolidator.
- `src/agents/` — `brain.ts` (single tool-using loop; accepts MCP tools + skills), `consolidator.ts` (dry-run → validate → apply).
- `src/tools/` — `graph_search`, `read_markdown`, `write_brain`, `write_config` (brain tools); MCP server tools are attached at runtime.
- `src/storage/` — `d1.ts`, `kv.ts`, `github.ts`, `writes.ts` (single write path + trash), `config.ts` (`mcp.json` + `skills/`, KV-cached), `mcp.ts` (remote MCP connections).
- `src/providers/` — `index.ts` (Copilot / LM Studio; reports `supportsVision`).
- `src/auth/` — `oauth.ts` (owner-locked GitHub OAuth + CSRF state), `session.ts` (HMAC sessions).
- `src/runtime/` — `budget.ts`, `context.ts` (per-turn context + dirty set).

## Conventions
- TypeScript, ESM, `.js` import specifiers (NodeNext/Bundler resolution). Keep files < 500 lines.
- Extensive doc comments on every exported function/type (see existing files).
- Shared types live in `packages/shared`; import via `@second-brain/shared`.
- Always run `npm run typecheck` before finishing. Validate the worker bundle with
  `npx wrangler deploy --dry-run --outdir dist` from `apps/worker`.

## When adding a tool
1. Implement under `src/tools/`, return via `defineTool`, charge the budget inside storage calls.
2. Only expose it to the brain agent via `src/tools/index.ts` if the agent should call it directly.
3. Emit a trace event (`ctx.emitTrace`) so the UI shows the activity.
