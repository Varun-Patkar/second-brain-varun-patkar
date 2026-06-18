# Second Brain

A personal, single-user, **free-for-life** LLM-maintained knowledge base. You chat with it; a team
of agents plans, retrieves, writes, and continuously tidies a markdown wiki on your behalf.

- **Frontend** — static React app on **GitHub Pages** (chat UI, provider picker, GitHub login).
- **Backend** — a **Cloudflare Worker** (free tier) built on [`agent-framework-js`](https://www.npmjs.com/package/agent-framework-js).
- **Storage** — **Cloudflare D1** (graph + FTS5 + outbox) + a markdown wiki on a dedicated git
  `brain` branch (never merges to `main`) + **Workers KV** hot cache.
- **Agents** — one tool-using *brain* agent (plan + fetch + edit) and a safe, incremental
  *consolidator*; a monthly **GitHub Actions** job archives stale nodes and snapshots D1 to git.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design and rationale.

## Repository layout

```text
packages/shared   # domain types + wire contracts (used by worker and web)
apps/worker       # Cloudflare Worker: agents, tools, storage adapters, auth
apps/web          # React + Vite + Tailwind chat frontend (GitHub Pages)
.github/workflows # CI, Pages deploy, monthly maintenance
```

## Local development

```bash
npm install

# Apply the D1 schema to a local (miniflare) database:
npm run db:migrate:local --workspace apps/worker

# Run the worker (http://localhost:8787) and the web app (http://localhost:5173):
npm run dev:worker
npm run dev:web
```

For local auth/LLM calls, create `apps/worker/.dev.vars` (gitignored) with the secrets listed below,
and `apps/web/.env` with `VITE_WORKER_URL=http://localhost:8787`.

## One-time setup checklist

You said you already have a Cloudflare account and a Copilot token. Here's everything else.

### 1. Create the storage

```bash
cd apps/worker
npx wrangler d1 create second_brain          # → paste database_id into wrangler.toml
npx wrangler kv namespace create CACHE       # → paste id into wrangler.toml
npx wrangler d1 migrations apply second_brain --remote
```

### 2. Create the `brain` branch (wiki data; never merged to main)

```bash
git switch --orphan brain
git commit --allow-empty -m "brain: init"
git push -u origin brain
git switch main
```

### 3. Create a GitHub OAuth App (identity only)

GitHub → Settings → Developer settings → **OAuth Apps** → New.
- **Homepage URL**: your Pages URL, e.g. `https://<you>.github.io/second-brain-varun-patkar/`
- **Authorization callback URL**: the **same** Pages URL.
- Copy the **Client ID** into `wrangler.toml` (`GH_CLIENT_ID`) and keep the **Client Secret** for the next step.

### 4. Set worker secrets

```bash
cd apps/worker
npx wrangler secret put COPILOT_TOKEN     # your GitHub Copilot token
npx wrangler secret put GH_CLIENT_SECRET  # OAuth app client secret
npx wrangler secret put GH_TOKEN          # PAT (fine-grained, contents:read/write on this repo)
npx wrangler secret put OWNER_GH_ID       # your numeric GitHub user id (https://api.github.com/users/<you>)
npx wrangler secret put SESSION_SECRET    # 32+ random bytes, e.g. `openssl rand -base64 48`
```

Also confirm the `[vars]` in `wrangler.toml`: `GH_REPO`, `BRAIN_BRANCH`, `ALLOWED_ORIGIN`,
`COPILOT_MODELS`.

### 5. Deploy the worker

```bash
npx wrangler deploy   # note the printed *.workers.dev URL
```

### 6. Configure & deploy the frontend (GitHub Pages)

In repo **Settings → Pages**, set Source = **GitHub Actions**.
In **Settings → Secrets and variables → Actions → Variables**, add:
- `VITE_WORKER_URL` = your deployed worker URL.
- `VITE_BASE` = `/second-brain-varun-patkar/` (or `/` for a custom domain).

Push to `main` → the **Deploy web to GitHub Pages** workflow publishes the site.

### 7. Monthly maintenance (archival + D1 snapshot)

Add Actions secrets `CLOUDFLARE_API_TOKEN` (D1 read/write + export) and `CLOUDFLARE_ACCOUNT_ID`.
The **Monthly brain maintenance** workflow runs on the 1st of each month (or via *Run workflow*).

## Scripts

```bash
npm run typecheck     # all workspaces
npm run build         # all workspaces
npm run dev:worker    # wrangler dev
npm run dev:web       # vite dev
```

## License

MIT
