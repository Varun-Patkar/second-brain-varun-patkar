/**
 * D1 adapter: the knowledge graph index (nodes, edges), FTS5 retrieval, access
 * counters, and the write-ahead outbox. Every logical operation charges one
 * subrequest against the turn budget.
 *
 * @packageDocumentation
 */

import type { BrainNode, BrainEdge, SearchResult, NeighborRef, NodeType, EdgeType } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { nowIso } from "../util/ids.js";

interface NodeRow {
  id: string;
  type: string;
  title: string;
  md_path: string;
  summary: string;
  tags: string;
  ref_count: number;
  created_at: string;
  updated_at: string;
  last_accessed: string | null;
  archived: number;
  content_hash: string;
  start_date: string | null;
  end_date: string | null;
  completed_at: string | null;
}

function rowToNode(r: NodeRow): BrainNode {
  return {
    id: r.id,
    type: r.type as NodeType,
    title: r.title,
    mdPath: r.md_path,
    summary: r.summary,
    refCount: r.ref_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessed: r.last_accessed ?? undefined,
    archived: r.archived === 1,
  };
}

/** Turn a free-text query into a safe FTS5 MATCH expression (OR of quoted terms). */
function toFtsQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .replace(/["()*:^-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** Fetch 1-hop neighbors for a set of node ids. */
async function neighborsOf(ctx: TurnContext, ids: string[]): Promise<Map<string, NeighborRef[]>> {
  const map = new Map<string, NeighborRef[]>();
  if (ids.length === 0) return map;
  ctx.budget.d1();
  const placeholders = ids.map(() => "?").join(",");
  const sql = `
    SELECT e.src AS src, e.dst AS dst, e.type AS etype,
           ns.type AS src_type, nd.type AS dst_type
    FROM edges e
    JOIN nodes ns ON ns.id = e.src
    JOIN nodes nd ON nd.id = e.dst
    WHERE e.src IN (${placeholders}) OR e.dst IN (${placeholders})`;
  const res = await ctx.env.DB.prepare(sql)
    .bind(...ids, ...ids)
    .all<{ src: string; dst: string; etype: string; src_type: string; dst_type: string }>();
  for (const row of res.results ?? []) {
    if (ids.includes(row.src)) {
      const list = map.get(row.src) ?? [];
      list.push({ id: row.dst, type: row.dst_type as NodeType, edge: row.etype as EdgeType });
      map.set(row.src, list);
    }
    if (ids.includes(row.dst)) {
      const list = map.get(row.dst) ?? [];
      list.push({ id: row.src, type: row.src_type as NodeType, edge: row.etype as EdgeType });
      map.set(row.dst, list);
    }
  }
  return map;
}

/** FTS5 keyword search + 1-hop graph expansion. Returns summaries only. */
export async function search(
  ctx: TurnContext,
  query: string,
  k = 5,
  types?: NodeType[],
): Promise<SearchResult[]> {
  ctx.budget.d1();
  const match = toFtsQuery(query);
  const typeFilter = types && types.length > 0 ? `AND n.type IN (${types.map(() => "?").join(",")})` : "";
  const sql = `
    SELECT n.id, n.type, n.title, n.md_path, n.summary, bm25(nodes_fts) AS score
    FROM nodes_fts
    JOIN nodes n ON n.id = nodes_fts.node_id
    WHERE nodes_fts MATCH ? AND n.archived = 0 ${typeFilter}
    ORDER BY score
    LIMIT ?`;
  const binds: unknown[] = [match, ...(types ?? []), k];
  const res = await ctx.env.DB.prepare(sql)
    .bind(...binds)
    .all<{ id: string; type: string; title: string; md_path: string; summary: string; score: number }>();
  const rows = res.results ?? [];
  const ids = rows.map((r) => r.id);
  const neighbors = await neighborsOf(ctx, ids);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NodeType,
    title: r.title,
    summary: r.summary,
    mdPath: r.md_path,
    score: -r.score, // bm25 is lower-is-better; negate so higher = more relevant
    neighbors: neighbors.get(r.id) ?? [],
  }));
}

/** List all nodes (id, type, title, path) — a lightweight index for the viewer. */
export async function listAllNodes(
  ctx: TurnContext,
): Promise<Array<{ id: string; type: string; title: string; mdPath: string }>> {
  ctx.budget.d1();
  const res = await ctx.env.DB.prepare("SELECT id, type, title, md_path FROM nodes WHERE archived = 0").all<{
    id: string;
    type: string;
    title: string;
    md_path: string;
  }>();
  return (res.results ?? []).map((r) => ({ id: r.id, type: r.type, title: r.title, mdPath: r.md_path }));
}

/** List all edges (src, dst, type) between non-archived nodes — for the graph viewer. */
export async function listAllEdges(
  ctx: TurnContext,
): Promise<Array<{ src: string; dst: string; type: string }>> {
  ctx.budget.d1();
  const res = await ctx.env.DB.prepare(
    `SELECT e.src AS src, e.dst AS dst, e.type AS type
     FROM edges e
     JOIN nodes ns ON ns.id = e.src AND ns.archived = 0
     JOIN nodes nd ON nd.id = e.dst AND nd.archived = 0`,
  ).all<{ src: string; dst: string; type: string }>();
  return res.results ?? [];
}

/**
 * List all nodes of a given type, INCLUDING archived ones. Used by the tasks page,
 * which must show done (archived) tasks too — unlike `search()`, which filters
 * `archived = 0` so done tasks stay out of normal LLM retrieval.
 */
export async function listNodesByType(
  ctx: TurnContext,
  type: string,
): Promise<
  Array<{
    id: string;
    title: string;
    summary: string;
    mdPath: string;
    archived: boolean;
    createdAt: string;
    startDate?: string;
    endDate?: string;
    completedAt?: string;
  }>
> {
  ctx.budget.d1();
  const res = await ctx.env.DB.prepare(
    "SELECT id, title, summary, md_path, archived, created_at, start_date, end_date, completed_at FROM nodes WHERE type = ? ORDER BY created_at DESC",
  )
    .bind(type)
    .all<{
      id: string;
      title: string;
      summary: string;
      md_path: string;
      archived: number;
      created_at: string;
      start_date: string | null;
      end_date: string | null;
      completed_at: string | null;
    }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    mdPath: r.md_path,
    archived: r.archived === 1,
    createdAt: r.created_at,
    ...(r.start_date ? { startDate: r.start_date } : {}),
    ...(r.end_date ? { endDate: r.end_date } : {}),
    ...(r.completed_at ? { completedAt: r.completed_at } : {}),
  }));
}

/**
 * Set a node's `archived` flag (and bump `updated_at`). Archiving a task removes
 * it from `search()` (and therefore from LLM context) without deleting it, so it
 * still appears — checked — on the tasks page. `completedAt` records (or clears,
 * when reopening) the completion timestamp that drives the past-day grouping.
 */
export async function setNodeArchived(
  ctx: TurnContext,
  id: string,
  archived: boolean,
  completedAt?: string | null,
): Promise<void> {
  ctx.budget.d1();
  await ctx.env.DB.prepare("UPDATE nodes SET archived = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .bind(archived ? 1 : 0, completedAt ?? null, nowIso(), id)
    .run();
}

/** Load full node rows by id. */
export async function getNodes(ctx: TurnContext, ids: string[]): Promise<BrainNode[]> {
  if (ids.length === 0) return [];
  ctx.budget.d1();
  const placeholders = ids.map(() => "?").join(",");
  const res = await ctx.env.DB.prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<NodeRow>();
  return (res.results ?? []).map(rowToNode);
}

/** Idempotent node upsert: no-op when content_hash is unchanged. Also refreshes
 * the standalone FTS index for each node (delete + reinsert). */
export async function upsertNodes(
  ctx: TurnContext,
  nodes: Array<
    BrainNode & {
      tags?: string[];
      contentHash: string;
      startDate?: string;
      endDate?: string;
      completedAt?: string;
    }
  >,
): Promise<void> {
  if (nodes.length === 0) return;
  ctx.budget.d1();
  const upsert = ctx.env.DB.prepare(`
    INSERT INTO nodes (id, type, title, md_path, summary, tags, ref_count, created_at, updated_at, last_accessed, archived, content_hash, start_date, end_date, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, title = excluded.title, md_path = excluded.md_path,
      summary = excluded.summary, tags = excluded.tags, updated_at = excluded.updated_at,
      content_hash = excluded.content_hash, start_date = excluded.start_date,
      end_date = excluded.end_date, completed_at = excluded.completed_at
    WHERE nodes.content_hash <> excluded.content_hash`);
  const ftsDelete = ctx.env.DB.prepare("DELETE FROM nodes_fts WHERE node_id = ?");
  const ftsInsert = ctx.env.DB.prepare(
    "INSERT INTO nodes_fts (node_id, title, summary, tags) VALUES (?, ?, ?, ?)",
  );
  const statements: D1PreparedStatement[] = [];
  for (const n of nodes) {
    const tags = (n.tags ?? []).join(" ");
    statements.push(
      upsert.bind(
        n.id,
        n.type,
        n.title,
        n.mdPath,
        n.summary,
        tags,
        n.refCount,
        n.createdAt,
        n.updatedAt,
        n.lastAccessed ?? null,
        n.archived ? 1 : 0,
        n.contentHash,
        n.startDate ?? null,
        n.endDate ?? null,
        n.completedAt ?? null,
      ),
      ftsDelete.bind(n.id),
      ftsInsert.bind(n.id, n.title, n.summary, tags),
    );
  }
  await ctx.env.DB.batch(statements);
}

/** Idempotent edge upsert keyed on (src, dst, type). */
export async function upsertEdges(ctx: TurnContext, edges: BrainEdge[]): Promise<void> {
  if (edges.length === 0) return;
  ctx.budget.d1();
  const stmt = ctx.env.DB.prepare(`
    INSERT INTO edges (id, src, dst, type, weight) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(src, dst, type) DO UPDATE SET weight = excluded.weight`);
  await ctx.env.DB.batch(edges.map((e) => stmt.bind(e.id, e.src, e.dst, e.type, e.weight)));
}

/** Remove a node and its edges from the index (used when content is trashed). */
export async function deleteNode(ctx: TurnContext, id: string): Promise<void> {
  ctx.budget.d1();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM nodes_fts WHERE node_id = ?").bind(id),
    ctx.env.DB.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").bind(id, id),
    ctx.env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(id),
  ]);
}

/** Bump ref counts + last_accessed and append an access-log row for each id. */
export async function bumpAccess(
  ctx: TurnContext,
  ids: string[],
  kind: "read" | "write" | "edge_traverse",
): Promise<void> {
  if (ids.length === 0) return;
  ctx.budget.d1();
  const ts = nowIso();
  const update = ctx.env.DB.prepare("UPDATE nodes SET ref_count = ref_count + 1, last_accessed = ? WHERE id = ?");
  const log = ctx.env.DB.prepare("INSERT INTO access_log (node_id, ts, kind) VALUES (?, ?, ?)");
  await ctx.env.DB.batch([
    ...ids.map((id) => update.bind(ts, id)),
    ...ids.map((id) => log.bind(id, ts, kind)),
  ]);
}

/** Stage a graph mutation in the outbox (status=pending). */
export async function stageOutbox(ctx: TurnContext, id: string, payload: unknown): Promise<void> {
  ctx.budget.d1();
  await ctx.env.DB.prepare("INSERT INTO outbox (id, payload, status, created_at) VALUES (?, ?, 'pending', ?)")
    .bind(id, JSON.stringify(payload), nowIso())
    .run();
}

/** Mark an outbox row done and record the commit it was bound to. */
export async function completeOutbox(ctx: TurnContext, id: string, commitSha: string): Promise<void> {
  ctx.budget.d1();
  await ctx.env.DB.prepare("UPDATE outbox SET status = 'done', commit_sha = ? WHERE id = ?")
    .bind(commitSha, id)
    .run();
}

/** Number of edges pointing *into* a node (used to gate safe trashing). */
export async function inboundEdgeCount(ctx: TurnContext, id: string): Promise<number> {
  ctx.budget.d1();
  const row = await ctx.env.DB.prepare("SELECT COUNT(*) AS c FROM edges WHERE dst = ?")
    .bind(id)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** Repoint all edges from one node id to another (used when merging nodes). */
export async function repointEdges(ctx: TurnContext, from: string, to: string): Promise<void> {
  ctx.budget.d1();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE OR IGNORE edges SET src = ? WHERE src = ?").bind(to, from),
    ctx.env.DB.prepare("UPDATE OR IGNORE edges SET dst = ? WHERE dst = ?").bind(to, from),
    ctx.env.DB.prepare("DELETE FROM edges WHERE src = dst"),
  ]);
}
