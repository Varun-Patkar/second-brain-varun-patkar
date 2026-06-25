/**
 * useChat — owns the conversation state and drives the streaming turn lifecycle,
 * translating SSE events into message text, reasoning, agent trace, and metrics.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState } from "react";
import type {
  ChatImage,
  ChatTurnRequest,
  MessageSegment,
  ToolCall,
  TraceEvent,
  TurnMetrics,
} from "@second-brain/shared";
import { getChat, getChatAsset, getTurnStatus, streamChat } from "../api.js";
import type { ChatMessage, ProviderConfig } from "../types.js";

let idCounter = 0;
const nextId = (): string => `m${Date.now()}_${idCounter++}`;

/** localStorage key holding the in-flight turn (chat id + the user's message) so a
 * page refresh can re-attach to a turn that is still running server-side. */
const ACTIVE_KEY = "sb.activeTurn";

/** The minimal record of an in-flight turn, persisted for refresh-resume. */
interface PendingTurn {
  id: string;
  /** The user's message text, replayed into the UI while the turn finishes. */
  text: string;
}

/** Read the persisted in-flight turn, tolerating the legacy id-only format. */
function readPending(): PendingTurn | null {
  const raw = localStorage.getItem(ACTIVE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingTurn>;
    if (v && typeof v.id === "string") return { id: v.id, text: typeof v.text === "string" ? v.text : "" };
  } catch {
    // Legacy format stored just the chat id as a bare string.
    return { id: raw, text: "" };
  }
  return null;
}

/** Append a run of text to a message's ordered segments (merging adjacent text). */
function appendTextSegment(segments: MessageSegment[] | undefined, text: string): MessageSegment[] {
  const next = segments ? [...segments] : [];
  const last = next[next.length - 1];
  if (last && last.type === "text") next[next.length - 1] = { type: "text", text: last.text + text };
  else next.push({ type: "text", text });
  return next;
}

/** Insert or update a tool-call segment by its id (status updates in place). */
function upsertToolSegment(segments: MessageSegment[] | undefined, call: ToolCall): MessageSegment[] {
  const next = segments ? [...segments] : [];
  const idx = next.findIndex((s) => s.type === "tool" && s.call.id === call.id);
  if (idx >= 0) next[idx] = { type: "tool", call };
  else next.push({ type: "tool", call });
  return next;
}

/** Build the wire request from the UI provider config. */
function buildRequest(
  message: string,
  cfg: ProviderConfig,
  chatId: string,
  images?: ChatImage[],
): ChatTurnRequest {
  const imagePart = images && images.length > 0 ? { images } : {};
  if (cfg.provider === "lmstudio") {
    return {
      message,
      provider: "lmstudio",
      chatId,
      lmStudio: {
        baseUrl: cfg.lmStudioUrl,
        model: cfg.lmStudioModel,
        ...(cfg.lmStudioKey ? { key: cfg.lmStudioKey } : {}),
      },
      ...imagePart,
    };
  }
  return { message, provider: "copilot", model: cfg.copilotModel, chatId, ...imagePart };
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [metrics, setMetrics] = useState<TurnMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  // Bumped whenever a turn is persisted to chat history, so the history sidebar
  // can re-sync the chat list from the brain branch (it appears once saved).
  const [chatsVersion, setChatsVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, cfg: ProviderConfig, images?: ChatImage[]) => {
      if ((!text.trim() && !(images && images.length > 0)) || streaming) return;
      const id = chatId ?? crypto.randomUUID();
      if (!chatId) setChatId(id);
      setError(null);
      setTrace([]);
      setMetrics(null);

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content: text,
        ...(images && images.length > 0
          ? { images: images.map((im) => `data:${im.mimeType};base64,${im.data}`) }
          : {}),
      };
      const assistantId = nextId();
      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
      setStreaming(true);
      // Persist this in-flight turn (id + message) so a refresh can re-attach to it.
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id, text } satisfies PendingTurn));

      const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        for await (const ev of streamChat(buildRequest(text, cfg, id, images), ac.signal)) {
          switch (ev.type) {
            case "text":
              patchAssistant((m) => ({
                ...m,
                content: m.content + ev.text,
                segments: appendTextSegment(m.segments, ev.text),
              }));
              break;
            case "reasoning":
              patchAssistant((m) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text }));
              break;
            case "tool":
              patchAssistant((m) => ({ ...m, segments: upsertToolSegment(m.segments, ev.call) }));
              break;
            case "trace":
              setTrace((prev) => [...prev, ev.event]);
              break;
            case "metrics":
            case "done":
              setMetrics(ev.metrics);
              break;
            case "partial":
              setMetrics(ev.metrics);
              setError("Turn paused at the subrequest budget — ask me to continue.");
              break;
            case "error":
              setError(ev.message);
              break;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setStreaming(false);
        abortRef.current = null;
        localStorage.removeItem(ACTIVE_KEY);
        // The worker has persisted this turn to chat history; let the sidebar re-sync.
        setChatsVersion((v) => v + 1);
      }
    },
    [streaming, chatId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Start a fresh, empty conversation. */
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setTrace([]);
    setMetrics(null);
    setError(null);
    setResuming(false);
    setChatId(null);
    localStorage.removeItem(ACTIVE_KEY);
  }, []);

  /** Load a stored conversation by id (for viewing / continuing). Returns false
   * when the conversation no longer exists (e.g. it was deleted). */
  const openChat = useCallback(async (id: string): Promise<boolean> => {
    abortRef.current?.abort();
    setStreaming(false);
    setError(null);
    const rec = await getChat(id);
    if (!rec) return false;
    setChatId(rec.id);
    setMessages(
      rec.messages.map((m) => ({
        id: nextId(),
        role: m.role,
        content: m.content,
        ...(m.reasoning ? { reasoning: m.reasoning } : {}),
        ...(m.segments ? { segments: m.segments } : {}),
      })),
    );
    // Resolve stored image refs to data URLs in the background (history rendering).
    rec.messages.forEach((m, i) => {
      if (!m.images || m.images.length === 0) return;
      void Promise.all(m.images.map((ref) => getChatAsset(ref.path))).then((urls) => {
        const dataUrls = urls.filter((u): u is string => Boolean(u));
        if (dataUrls.length === 0) return;
        setMessages((prev) => {
          const next = [...prev];
          if (next[i]) next[i] = { ...next[i], images: dataUrls };
          return next;
        });
      });
    });
    const lastAssistant = [...rec.messages].reverse().find((m) => m.role === "assistant");
    setTrace(lastAssistant?.trace ?? []);
    setMetrics(lastAssistant?.metrics ?? null);
    return true;
  }, []);

  /**
   * On page load, re-attach to an in-flight turn if one was running for the active
   * chat. The turn keeps running server-side (the worker uses `waitUntil`), but it
   * is only saved to chat history when it finishes. So:
   *  - if the chat is already saved, load it;
   *  - if it is still running but not yet saved, replay the user's message + an
   *    assistant placeholder so the running turn is visible (not a blank screen);
   *  - poll until the turn finishes, then load the completed conversation and
   *    re-sync the history list (the chat now exists on the brain branch).
   */
  const resumeActive = useCallback(async () => {
    const pending = readPending();
    if (!pending) return;
    const { id, text } = pending;
    const running = await getTurnStatus(id);
    const loaded = await openChat(id); // loads the saved record if it already exists

    if (!running) {
      // The turn already finished (and, if it saved, was loaded above). Clear the
      // marker and re-sync the sidebar so the chat shows up.
      localStorage.removeItem(ACTIVE_KEY);
      setChatsVersion((v) => v + 1);
      return;
    }

    // Still running. If nothing was loaded (the chat isn't persisted yet), seed the
    // in-flight turn so the user sees their message + a working assistant bubble.
    if (!loaded) {
      setChatId(id);
      setMessages([
        { id: nextId(), role: "user", content: text },
        { id: nextId(), role: "assistant", content: "" },
      ]);
    }
    setResuming(true);

    const poll = async () => {
      if (!(await getTurnStatus(id))) {
        await openChat(id);
        setResuming(false);
        localStorage.removeItem(ACTIVE_KEY);
        // The turn just persisted to the brain branch — re-sync the chat list.
        setChatsVersion((v) => v + 1);
        return;
      }
      setTimeout(() => void poll(), 2500);
    };
    setTimeout(() => void poll(), 2500);
  }, [openChat]);

  return {
    messages,
    send,
    stop,
    streaming,
    resuming,
    trace,
    metrics,
    error,
    setError,
    chatId,
    chatsVersion,
    newChat,
    openChat,
    resumeActive,
  };
}
