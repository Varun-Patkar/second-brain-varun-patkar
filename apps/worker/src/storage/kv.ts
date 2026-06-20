/**
 * KV adapter: hot cache for node documents to cut GitHub read subrequests.
 *
 * KV operations are not counted against the per-turn subrequest budget (they are
 * far cheaper than GitHub API calls). Entries are invalidated on write.
 *
 * @packageDocumentation
 */

import type { NodeDocument } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";

const DOC_PREFIX = "doc:";

/** Read a cached node document, or null on miss. */
export async function getCachedDoc(ctx: TurnContext, id: string): Promise<NodeDocument | null> {
  const raw = await ctx.env.CACHE.get(`${DOC_PREFIX}${id}`);
  return raw ? (JSON.parse(raw) as NodeDocument) : null;
}

/** Cache a node document. */
export async function putCachedDoc(ctx: TurnContext, doc: NodeDocument): Promise<void> {
  await ctx.env.CACHE.put(`${DOC_PREFIX}${doc.id}`, JSON.stringify(doc));
}

/** Invalidate a cached node document. */
export async function invalidateDoc(ctx: TurnContext, id: string): Promise<void> {
  await ctx.env.CACHE.delete(`${DOC_PREFIX}${id}`);
}

const TURN_PREFIX = "turn:";

/**
 * Mark whether a turn is currently running for a chat, so a client that refreshes
 * mid-turn can tell (on reconnect) to wait for completion vs. load from history.
 * Entries auto-expire so a crashed turn never sticks as "running" forever.
 */
export async function setTurnRunning(ctx: TurnContext, chatId: string, running: boolean): Promise<void> {
  const key = `${TURN_PREFIX}${chatId}`;
  if (running) {
    await ctx.env.CACHE.put(key, "1", { expirationTtl: 300 });
  } else {
    await ctx.env.CACHE.delete(key);
  }
}

/** True if a turn is currently running for the given chat. */
export async function isTurnRunning(ctx: TurnContext, chatId: string): Promise<boolean> {
  return (await ctx.env.CACHE.get(`${TURN_PREFIX}${chatId}`)) != null;
}
