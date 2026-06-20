/**
 * GitHub adapter: reads and writes the markdown wiki on the `brain` branch.
 *
 * All writes for a turn are batched into a **single commit** via the Git Data API
 * (one `trees` + one `commits` + one `refs` update), so the per-turn git
 * subrequest cost stays bounded (~5) regardless of how many files change.
 *
 * @packageDocumentation
 */

import type { TurnContext } from "../runtime/context.js";

const API = "https://api.github.com";
const UA = "second-brain-worker";

interface GhFile {
  path: string;
  content: string;
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
  };
}

/** Charge one git subrequest and perform a GitHub API fetch. */
async function gh(ctx: TurnContext, path: string, init?: RequestInit): Promise<Response> {
  ctx.budget.git();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(ctx.env.GH_TOKEN), ...(init?.headers ?? {}) },
  });
  return res;
}

/** Read a single markdown file from the brain branch. Returns null if absent. */
export async function readFile(
  ctx: TurnContext,
  filePath: string,
): Promise<{ text: string; sha: string } | null> {
  const { GH_REPO, BRAIN_BRANCH } = ctx.env;
  const res = await gh(
    ctx,
    `/repos/${GH_REPO}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(BRAIN_BRANCH)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read ${filePath} failed: ${res.status}`);
  const json = (await res.json()) as { content: string; sha: string; encoding: string };
  const text =
    json.encoding === "base64"
      ? new TextDecoder().decode(Uint8Array.from(atob(json.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)))
      : json.content;
  return { text, sha: json.sha };
}

/**
 * List the files in a directory on the brain branch. Returns an empty array when
 * the directory does not exist. Each entry is a file path relative to the repo.
 */
export async function listDir(ctx: TurnContext, dirPath: string): Promise<string[]> {
  const { GH_REPO, BRAIN_BRANCH } = ctx.env;
  const res = await gh(
    ctx,
    `/repos/${GH_REPO}/contents/${encodeURI(dirPath)}?ref=${encodeURIComponent(BRAIN_BRANCH)}`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list ${dirPath} failed: ${res.status}`);
  const json = (await res.json()) as Array<{ path: string; type: string }>;
  return json.filter((e) => e.type === "file").map((e) => e.path);
}

/**
 * Read a file from the brain branch as raw base64 (for binary assets like images).
 * Returns null when the file is absent.
 */
export async function readBlobBase64(
  ctx: TurnContext,
  filePath: string,
): Promise<{ base64: string } | null> {
  const { GH_REPO, BRAIN_BRANCH } = ctx.env;
  const res = await gh(
    ctx,
    `/repos/${GH_REPO}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(BRAIN_BRANCH)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read blob ${filePath} failed: ${res.status}`);
  const json = (await res.json()) as { content: string; encoding: string };
  return { base64: json.content.replace(/\n/g, "") };
}

/**
 * Create a git blob from base64 content and return its sha. Used to store binary
 * assets (e.g. chat images) that can then be referenced by sha in a commit tree.
 */
export async function createBlob(ctx: TurnContext, base64: string): Promise<string> {
  const { GH_REPO } = ctx.env;
  const res = await gh(ctx, `/repos/${GH_REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: base64, encoding: "base64" }),
  });
  if (!res.ok) throw new Error(`Cannot create blob: ${res.status}`);
  return ((await res.json()) as { sha: string }).sha;
}

/**
 * Commit a batch of writes and/or deletes as one commit on the brain branch.
 * Deletes here mean "remove from this path" — callers implement trash by deleting
 * the old path and writing the same content under `_deleted/`.
 *
 * @returns the new commit SHA.
 */
export async function commitBatch(
  ctx: TurnContext,
  opts: {
    message: string;
    writes?: GhFile[];
    deletes?: string[];
    /** Pre-created blobs to include by sha (e.g. binary image assets). */
    blobs?: Array<{ path: string; sha: string }>;
  },
): Promise<string> {
  const { GH_REPO, BRAIN_BRANCH } = ctx.env;
  const writes = opts.writes ?? [];
  const deletes = opts.deletes ?? [];
  const blobs = opts.blobs ?? [];
  if (writes.length === 0 && deletes.length === 0 && blobs.length === 0) {
    throw new Error("commitBatch called with no changes");
  }

  // 1) Current branch head.
  const refRes = await gh(ctx, `/repos/${GH_REPO}/git/ref/heads/${encodeURIComponent(BRAIN_BRANCH)}`);
  if (!refRes.ok) {
    throw new Error(
      `Cannot read ref heads/${BRAIN_BRANCH}: ${refRes.status}. Ensure the brain branch exists with an initial commit.`,
    );
  }
  const ref = (await refRes.json()) as { object: { sha: string } };
  const headSha = ref.object.sha;

  // 2) Base tree of the head commit.
  const commitRes = await gh(ctx, `/repos/${GH_REPO}/git/commits/${headSha}`);
  if (!commitRes.ok) throw new Error(`Cannot read base commit: ${commitRes.status}`);
  const baseCommit = (await commitRes.json()) as { tree: { sha: string } };

  // 3) New tree (inline blob content; pre-created blobs by sha; deletions use sha:null).
  const tree = [
    ...writes.map((w) => ({ path: w.path, mode: "100644", type: "blob", content: w.content })),
    ...blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
    ...deletes.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null })),
  ];
  const treeRes = await gh(ctx, `/repos/${GH_REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });
  if (!treeRes.ok) throw new Error(`Cannot create tree: ${treeRes.status} ${await treeRes.text()}`);
  const newTree = (await treeRes.json()) as { sha: string };

  // 4) Commit pointing at the new tree.
  const newCommitRes = await gh(ctx, `/repos/${GH_REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: opts.message, tree: newTree.sha, parents: [headSha] }),
  });
  if (!newCommitRes.ok) throw new Error(`Cannot create commit: ${newCommitRes.status}`);
  const newCommit = (await newCommitRes.json()) as { sha: string };

  // 5) Move the branch.
  const patchRes = await gh(ctx, `/repos/${GH_REPO}/git/refs/heads/${encodeURIComponent(BRAIN_BRANCH)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (!patchRes.ok) throw new Error(`Cannot update ref: ${patchRes.status}`);

  return newCommit.sha;
}
