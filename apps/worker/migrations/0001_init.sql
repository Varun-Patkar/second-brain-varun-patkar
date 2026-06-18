-- Second Brain — D1 schema (knowledge graph + FTS5 + outbox).
-- Markdown is the source of truth; this DB is a fast, rebuildable index.

-- Nodes: one row per markdown file on the `brain` branch.
CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  md_path       TEXT NOT NULL,
  summary       TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '',  -- space-separated, fed to FTS5
  ref_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_accessed TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  content_hash  TEXT NOT NULL DEFAULT ''   -- idempotent upserts key on (id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_archived ON nodes(archived);
CREATE INDEX IF NOT EXISTS idx_nodes_last_accessed ON nodes(last_accessed);

-- Typed, directed edges between nodes.
CREATE TABLE IF NOT EXISTS edges (
  id     TEXT PRIMARY KEY,
  src    TEXT NOT NULL,
  dst    TEXT NOT NULL,
  type   TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_triple ON edges(src, dst, type);

-- Access log feeding ref_count / archival decisions.
CREATE TABLE IF NOT EXISTS access_log (
  node_id TEXT NOT NULL,
  ts      TEXT NOT NULL,
  kind    TEXT NOT NULL  -- read | write | edge_traverse
);
CREATE INDEX IF NOT EXISTS idx_access_node ON access_log(node_id);

-- Outbox: stages graph mutations so D1<->git stays reconcilable on partial failure.
CREATE TABLE IF NOT EXISTS outbox (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,   -- JSON: staged node/edge mutations
  commit_sha TEXT,            -- set after the git commit succeeds
  status     TEXT NOT NULL,   -- pending | done
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);

-- Full-text search over title + summary + tags (BM25 ranking, runs inside D1).
-- Standalone FTS5 table maintained from application code (no triggers), so the
-- migration SQL splitter never sees a multi-statement BEGIN...END body.
-- node_id is stored UNINDEXED so we can join back to `nodes`.
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  node_id UNINDEXED,
  title,
  summary,
  tags
);
