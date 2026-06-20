/**
 * useChat — owns the conversation state and drives the streaming turn lifecycle,
 * translating SSE events into message text, reasoning, agent trace, and metrics.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState } from "react";
import type { ChatImage, ChatTurnRequest, TraceEvent, TurnMetrics } from "@second-brain/shared";
import { streamChat } from "../api.js";
import type { ChatMessage, ProviderConfig } from "../types.js";

let idCounter = 0;
const nextId = (): string => `m${Date.now()}_${idCounter++}`;

/** Build the wire request from the UI provider config. */
function buildRequest(message: string, cfg: ProviderConfig, images?: ChatImage[]): ChatTurnRequest {
  const imagePart = images && images.length > 0 ? { images } : {};
  if (cfg.provider === "lmstudio") {
    return {
      message,
      provider: "lmstudio",
      lmStudio: {
        baseUrl: cfg.lmStudioUrl,
        model: cfg.lmStudioModel,
        ...(cfg.lmStudioKey ? { key: cfg.lmStudioKey } : {}),
      },
      ...imagePart,
    };
  }
  return { message, provider: "copilot", model: cfg.copilotModel, ...imagePart };
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [metrics, setMetrics] = useState<TurnMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string, cfg: ProviderConfig, images?: ChatImage[]) => {
    if ((!text.trim() && !(images && images.length > 0)) || streaming) return;
    setError(null);
    setTrace([]);
    setMetrics(null);

    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
    const assistantId = nextId();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    setStreaming(true);

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      for await (const ev of streamChat(buildRequest(text, cfg, images), ac.signal)) {
        switch (ev.type) {
          case "text":
            patchAssistant((m) => ({ ...m, content: m.content + ev.text }));
            break;
          case "reasoning":
            patchAssistant((m) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text }));
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
    }
  }, [streaming]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, send, stop, streaming, trace, metrics, error, setError };
}
