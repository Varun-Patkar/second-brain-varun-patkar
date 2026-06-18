# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is
A single-user, free-tier "second brain": a GitHub Pages chat frontend + a Cloudflare Worker backend
(built on the `agent-framework-js` npm package) that maintains a markdown wiki on a git `brain`
branch, indexed by Cloudflare D1 (graph + FTS5). Read [ARCHITECTURE.md](ARCHITECTURE.md) first — it
is the source of truth for design decisions.

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
- **Secrets** come only from `getCredential` callbacks / Worker env; never log or persist them.
  Pass anything user-facing through `redact()` (`src/middleware/redaction.ts`).

## Architecture map (worker)
- `src/index.ts` — router (CORS, auth routes, SSE `/chat`).
- `src/turn.ts` — turn orchestration: brain agent (streamed) → conditional consolidator.
- `src/agents/` — `brain.ts` (single tool-using loop), `consolidator.ts` (dry-run → validate → apply).
- `src/tools/` — `graph_search`, `read_markdown`, `write_brain` (the only brain tools).
- `src/storage/` — `d1.ts`, `kv.ts`, `github.ts`, `writes.ts` (single write path + trash).
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
