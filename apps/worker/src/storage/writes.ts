/**
 * The single write path for the brain: persist a batch of node writes as one git
 * commit, then update the D1 index (via the outbox) idempotently, refresh the KV
 * cache, and mark the touched nodes dirty for consolidation.
 *
 * Also implements `trashNode`: move a node's markdown to `_deleted/` (recoverable
 * from git) and drop it from the D1/FTS index so it no longer pollutes search.
 *
 * @packageDocumentation
 */

import type { BrainEdge, BrainNode, BrainWrite, NodeDocument, NodeFrontmatter, WriteResult } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { markDirty } from "../runtime/context.js";
import { genId, nowIso, contentHash } from "../util/ids.js";
import { nodePath, parseDocument, serializeDocument } from "../util/markdown.js";
import { commitBatch, readFile } from "./github.js";
import { getNodes, upsertNodes, upsertEdges, deleteNode, bumpAccess, stageOutbox, completeOutbox, setNodeArchived } from "./d1.js";
import { putCachedDoc, invalidateDoc } from "./kv.js";

/** Persist a batch of writes (one commit + idempotent index update). */
export async function persistWrites(ctx: TurnContext, writes: BrainWrite[]): Promise<WriteResult> {
  if (writes.length === 0) return { commitSha: "", results: [] };

  // Preserve createdAt for existing nodes.
  const existingIds = writes.map((w) => w.id).filter((id): id is string => Boolean(id));
  const existing = existingIds.length > 0 ? await getNodes(ctx, existingIds) : [];
  const existingById = new Map(existing.map((n) => [n.id, n]));

  const ts = nowIso();
  const files: Array<{ path: string; content: string }> = [];
  const nodes: Array<BrainNode & { tags?: string[]; contentHash: string }> = [];
  const edges: BrainEdge[] = [];
  const results: WriteResult["results"] = [];
  const cacheDocs: NodeDocument[] = [];

  for (const w of writes) {
    const id = w.id ?? genId("node");
    const prior = w.id ? existingById.get(w.id) : undefined;
    const createdAt = prior?.createdAt ?? ts;
    const mdPath = prior?.mdPath ?? nodePath(w.type, id);
    const fm: NodeFrontmatter = {
      id,
      type: w.type,
      title: w.title,
      summary: w.summary,
      createdAt,
      updatedAt: ts,
      ...(w.tags ? { tags: w.tags } : {}),
      ...(w.edges ? { edges: w.edges } : {}),
    };
    const doc = serializeDocument(fm, w.body);
    const hash = contentHash(w.title, w.summary, w.body, (w.tags ?? []).join(","), JSON.stringify(w.edges ?? []));

    files.push({ path: mdPath, content: doc });
    nodes.push({
      id,
      type: w.type,
      title: w.title,
      mdPath,
      summary: w.summary,
      refCount: prior?.refCount ?? 0,
      createdAt,
      updatedAt: ts,
      ...(prior?.lastAccessed ? { lastAccessed: prior.lastAccessed } : {}),
      archived: false,
      tags: w.tags ?? [],
      contentHash: hash,
    });
    for (const e of w.edges ?? []) {
      edges.push({ id: genId("edge"), src: id, dst: e.to, type: e.type, weight: 1 });
    }
    results.push({ id, path: mdPath, action: prior ? "updated" : "created" });
    cacheDocs.push({ id, mdPath, body: w.body, frontmatter: fm });
  }

  // 1) Stage the index mutation, 2) commit markdown, 3) apply index, 4) complete.
  const outboxId = genId("outbox");
  await stageOutbox(ctx, outboxId, { nodes, edges });
  const commitSha = await commitBatch(ctx, {
    message: `brain: update ${results.length} node(s)`,
    writes: files,
  });
  await upsertNodes(ctx, nodes);
  await upsertEdges(ctx, edges);
  await completeOutbox(ctx, outboxId, commitSha);

  // Refresh cache + mark dirty + count writes.
  for (const doc of cacheDocs) await putCachedDoc(ctx, doc);
  const ids = nodes.map((n) => n.id);
  markDirty(ctx, ...ids);
  await bumpAccess(ctx, ids, "write");

  return { commitSha, results };
}

/**
 * Toggle a task's completion state, keeping markdown + D1 in sync as one unit:
 *  - markdown frontmatter `status` becomes `done`/`open` (committed once), and
 *  - the D1 `archived` flag mirrors it, so a done task is EXCLUDED from `search()`
 *    (and therefore from normal LLM context) without being deleted.
 *
 * Returns false when the node does not exist or is not a task.
 */
export async function setTaskStatus(ctx: TurnContext, id: string, done: boolean): Promise<boolean> {
  const [node] = await getNodes(ctx, [id]);
  if (!node || node.type !== "task") return false;

  // Update the markdown source of truth (best-effort: if the file is missing we
  // still flip the D1 flag so the page/state stay consistent).
  const file = await readFile(ctx, node.mdPath);
  if (file) {
    const { frontmatter, body } = parseDocument(file.text);
    frontmatter.status = done ? "done" : "open";
    frontmatter.updatedAt = nowIso();
    await commitBatch(ctx, {
      message: `brain: ${done ? "complete" : "reopen"} task ${id}`,
      writes: [{ path: node.mdPath, content: serializeDocument(frontmatter, body) }],
    });
  }

  // Mirror into D1 (archived = done) so done tasks drop out of search/context.
  await setNodeArchived(ctx, id, done);
  await invalidateDoc(ctx, id);
  markDirty(ctx, id);
  return true;
}

/** Move a node's markdown to `_deleted/` and drop it from the index. */
export async function trashNode(ctx: TurnContext, id: string): Promise<{ movedTo: string } | null> {
  const [node] = await getNodes(ctx, [id]);
  if (!node) return null;
  const file = await readFile(ctx, node.mdPath);
  const content = file?.text ?? `---\nid: ${id}\n---\n(trashed; original content unavailable)\n`;
  const movedTo = `_deleted/${node.mdPath}`;
  await commitBatch(ctx, {
    message: `brain: trash ${id}`,
    writes: [{ path: movedTo, content }],
    deletes: [node.mdPath],
  });
  await deleteNode(ctx, id);
  await invalidateDoc(ctx, id);
  markDirty(ctx, id);
  return { movedTo };
}
