/**
 * Turn orchestration: run the brain agent (streamed), then conditionally run the
 * consolidator over the touched subgraph, emitting SSE events throughout. Budget
 * soft-caps surface as a graceful partial; auth failures surface loudly.
 *
 * @packageDocumentation
 */

import type {
  ChatRecord,
  ChatTurnRequest,
  MessageSegment,
  StoredChatMessage,
  TraceEvent,
  TurnMetrics,
  TurnStreamEvent,
} from "@second-brain/shared";
import type { AgentInput, ContentPart, Message } from "agent-framework-js";
import type { Env } from "./env.js";
import { createTurnContext, type TurnContext } from "./runtime/context.js";
import { BudgetExceededError, BudgetSoftCapError } from "./runtime/budget.js";
import { buildProvider } from "./providers/index.js";
import { createBrainAgent } from "./agents/brain.js";
import { runConsolidation } from "./agents/consolidator.js";
import { loadBrainConfig } from "./storage/config.js";
import { attachMcpTools, closeMcp } from "./storage/mcp.js";
import { loadChat, saveTurn } from "./storage/chats.js";
import { setTurnRunning } from "./storage/kv.js";
import { nowIso } from "./util/ids.js";
import { redact } from "./middleware/redaction.js";

type Emit = (event: TurnStreamEvent) => void;

/** How many recent prior messages to feed back as conversation context. */
const HISTORY_WINDOW = 10;

/**
 * Build the agent input for a turn: recent prior messages (for conversational
 * continuity when continuing a stored chat) plus the new user message, which may
 * carry images for vision-capable models. Falls back to a plain string for the
 * cheap, common case (no history, no images).
 */
function buildAgentInput(
  req: ChatTurnRequest,
  supportsVision: boolean,
  prior: StoredChatMessage[],
): AgentInput {
  const hasImages = supportsVision && (req.images?.length ?? 0) > 0;
  if (prior.length === 0 && !hasImages) return req.message;

  const priorMsgs: Message[] = prior
    .slice(-HISTORY_WINDOW)
    .map((m) => ({ role: m.role, parts: [{ type: "text", text: m.content } as ContentPart] }));

  const parts: ContentPart[] = [
    ...(req.message ? [{ type: "text", text: req.message } as ContentPart] : []),
    ...(hasImages
      ? req.images!.map((img): ContentPart => ({
          type: "image",
          // The provider uses `data` verbatim as the image_url; it must be a full
          // data URL (or http URL), not bare base64, or the vision call stalls.
          data: img.data.startsWith("data:") ? img.data : `data:${img.mimeType};base64,${img.data}`,
          mimeType: img.mimeType,
        }))
      : []),
  ];
  return [...priorMsgs, { role: "user", parts }];
}

function metricsOf(ctx: TurnContext): TurnMetrics {
  return {
    subrequestsUsed: ctx.budget.used,
    llmCalls: ctx.budget.llmCalls,
    gitCalls: ctx.budget.gitCalls,
    d1Calls: ctx.budget.d1Calls,
    dirtySetSize: ctx.dirty.nodes.size,
    toolsEnabled: ctx.counts.tools,
    skillsEnabled: ctx.counts.skills,
    ...(ctx.tokens.input > 0 ? { tokensUsed: ctx.tokens.input } : {}),
    ...(ctx.tokenLimit ? { tokenLimit: ctx.tokenLimit } : {}),
  };
}

/** Heuristic: does this error look like an expired/invalid Copilot token? */
function isAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("401") || m.includes("unauthor") || m.includes("invalid token") || m.includes("expired");
}

/** Run one chat turn, emitting SSE events via `emit`. */
export async function runTurn(env: Env, req: ChatTurnRequest, emit: Emit): Promise<void> {
  // Capture trace events both for the live stream and for chat-history persistence.
  const traceLog: TraceEvent[] = [];
  const ctx = createTurnContext(env, (e) => {
    const event: TraceEvent = { ...e, at: nowIso() };
    traceLog.push(event);
    emit({ type: "trace", event });
  });

  const chatId = req.chatId;
  let answer = "";
  let reasoning = "";
  // Ordered text + tool-call segments, for inline rendering and persistence.
  const segments: MessageSegment[] = [];
  const pushText = (t: string): void => {
    const last = segments[segments.length - 1];
    if (last && last.type === "text") last.text += t;
    else segments.push({ type: "text", text: t });
  };
  ctx.emitTool = (call) => {
    const idx = segments.findIndex((s) => s.type === "tool" && s.call.id === call.id);
    if (idx >= 0) segments[idx] = { type: "tool", call };
    else segments.push({ type: "tool", call });
    emit({ type: "tool", call });
  };

  // Mark the turn running so a client that refreshes can detect it on reconnect.
  if (chatId) await setTurnRunning(ctx, chatId, true).catch(() => {});

  // Load prior conversation (for continuity + to append this turn to it).
  let record: ChatRecord | null = null;
  if (chatId) {
    try {
      record = await loadChat(ctx, chatId);
    } catch {
      /* a missing/corrupt chat just starts fresh */
    }
  }

  try {
    const { provider, model, supportsVision, tokenLimit } = buildProvider(env, req);
    // Expose the context window + a live-metrics hook so the UI token meter updates
    // as each model call reports its usage (see the budget middleware).
    ctx.tokenLimit = tokenLimit;
    ctx.emitMetrics = () => emit({ type: "metrics", metrics: metricsOf(ctx) });

    // Load the brain's own config (MCP servers + skills), then attach MCP tools.
    const config = await loadBrainConfig(ctx);
    const mcp = await attachMcpTools(ctx, config.mcpServers);
    const brain = createBrainAgent(ctx, provider, model, {
      extraTools: mcp.tools,
      skills: config.skills,
    });

    try {
      for await (const chunk of brain.runStream(buildAgentInput(req, supportsVision, record?.messages ?? []))) {
        if (chunk.type === "text") {
          answer += chunk.text;
          pushText(chunk.text);
          emit({ type: "text", text: chunk.text });
        } else if (chunk.type === "reasoning") {
          reasoning += chunk.text;
          emit({ type: "reasoning", text: chunk.text });
        }
        // 'done' carries the final RunResult; metrics are emitted below.
      }
    } finally {
      await closeMcp(mcp);
    }

    // Mandatory-but-conditional consolidation: only when the turn changed something.
    if (ctx.dirty.value) {
      try {
        await runConsolidation(ctx, provider, model);
      } catch (consErr) {
        // The user's write already committed (outbox); a stale index is healed by
        // the monthly reconcile. Never fail the turn on consolidation error.
        emit({
          type: "trace",
          event: {
            agent: "consolidator",
            detail: `skipped: ${redact(env, consErr instanceof Error ? consErr.message : String(consErr))}`,
            at: nowIso(),
          },
        });
      }
    }

    emit({ type: "metrics", metrics: metricsOf(ctx) });

    // Persist this turn to the chat history (best-effort; never fails the turn).
    if (chatId) {
      try {
        await saveTurn(
          ctx,
          chatId,
          record,
          { role: "user", content: req.message },
          {
            role: "assistant",
            content: answer,
            ...(reasoning ? { reasoning } : {}),
            ...(segments.length > 0 ? { segments } : {}),
            trace: traceLog,
            metrics: metricsOf(ctx),
          },
          req.images,
        );
      } catch (saveErr) {
        emit({
          type: "trace",
          event: {
            agent: "brain",
            detail: `chat history not saved: ${redact(env, saveErr instanceof Error ? saveErr.message : String(saveErr))}`,
            at: nowIso(),
          },
        });
      }
    }

    emit({ type: "done", metrics: metricsOf(ctx) });
  } catch (err) {
    if (err instanceof BudgetSoftCapError || err instanceof BudgetExceededError) {
      // Graceful partial — a full resume protocol is a follow-up (see ARCHITECTURE §9).
      emit({ type: "partial", resumeToken: "", metrics: metricsOf(ctx) });
      emit({ type: "done", metrics: metricsOf(ctx) });
      return;
    }
    const message =
      req.provider === "copilot" && isAuthError(err)
        ? "Copilot token expired or invalid — refresh COPILOT_TOKEN on the worker."
        : redact(env, err instanceof Error ? err.message : String(err));
    emit({ type: "error", code: isAuthError(err) ? "auth" : "turn_failed", message });
  } finally {
    if (chatId) await setTurnRunning(ctx, chatId, false).catch(() => {});
  }
}
