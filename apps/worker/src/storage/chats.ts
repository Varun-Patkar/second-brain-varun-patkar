/**
 * Chat history storage on the `brain` branch. Each conversation is a JSON file
 * under `chats/<id>.json`, with a lightweight `chats/index.json` listing for the
 * history sidebar. Chats are intentionally **not** indexed in D1/FTS — they are
 * kept for the owner to revisit or continue, not for retrieval grounding.
 *
 * @packageDocumentation
 */

import type { ChatRecord, ChatSummary, StoredChatMessage } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { nowIso } from "../util/ids.js";
import { commitBatch, readFile } from "./github.js";

const CHATS_DIR = "chats";
const INDEX_PATH = "chats/index.json";

const chatPath = (id: string): string => `${CHATS_DIR}/${id.replace(/[^a-z0-9._-]/gi, "-")}.json`;

/** Load a stored chat, or null if it does not exist yet. */
export async function loadChat(ctx: TurnContext, id: string): Promise<ChatRecord | null> {
  const file = await readFile(ctx, chatPath(id));
  if (!file) return null;
  try {
    return JSON.parse(file.text) as ChatRecord;
  } catch {
    return null;
  }
}

/** List chat summaries (most-recently-updated first). */
export async function listChats(ctx: TurnContext): Promise<ChatSummary[]> {
  const file = await readFile(ctx, INDEX_PATH);
  if (!file) return [];
  try {
    const list = JSON.parse(file.text) as ChatSummary[];
    return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** Derive a short chat title from the first user message. */
function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New chat";
}

/**
 * Append a completed turn (user message + assistant reply) to a chat and persist
 * it — the chat file and the index are written in a single commit. `existing` is
 * the record loaded at the start of the turn (or null for a new chat), so this
 * does not re-read the chat file.
 */
export async function saveTurn(
  ctx: TurnContext,
  id: string,
  existing: ChatRecord | null,
  userMessage: StoredChatMessage,
  assistantMessage: StoredChatMessage,
): Promise<void> {
  const ts = nowIso();
  const record: ChatRecord = existing ?? {
    id,
    title: deriveTitle(userMessage.content),
    createdAt: ts,
    updatedAt: ts,
    messages: [],
  };
  record.messages.push(userMessage, assistantMessage);
  record.updatedAt = ts;
  if (!record.title || record.title === "New chat") record.title = deriveTitle(userMessage.content);

  // Update the index (upsert this chat's summary).
  const index = await listChats(ctx);
  const summary: ChatSummary = {
    id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  const nextIndex = [summary, ...index.filter((c) => c.id !== id)];

  await commitBatch(ctx, {
    message: `chats: update ${id}`,
    writes: [
      { path: chatPath(id), content: `${JSON.stringify(record, null, 2)}\n` },
      { path: INDEX_PATH, content: `${JSON.stringify(nextIndex, null, 2)}\n` },
    ],
  });
}

/**
 * Delete a chat: remove its file and drop it from the index in one commit. The
 * file remains recoverable from git history (no separate trash copy is kept).
 */
export async function deleteChat(ctx: TurnContext, id: string): Promise<void> {
  const index = await listChats(ctx);
  const nextIndex = index.filter((c) => c.id !== id);
  await commitBatch(ctx, {
    message: `chats: delete ${id}`,
    writes: [{ path: INDEX_PATH, content: `${JSON.stringify(nextIndex, null, 2)}\n` }],
    deletes: [chatPath(id)],
  });
}
