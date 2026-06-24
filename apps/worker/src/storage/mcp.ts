/**
 * MCP integration for the brain: connect to the remote MCP servers configured in
 * the brain's `mcp.json` and expose their tools to the agent.
 *
 * Only **remote** (HTTP/SSE) transports are used — the Cloudflare Worker runtime
 * cannot spawn stdio server processes. Each connection + tool-list counts against
 * the per-turn subrequest budget, and any failure degrades gracefully (the turn
 * proceeds with the brain's own tools) rather than aborting.
 *
 * @packageDocumentation
 */

import { connectMCP, type MCPConnection } from "agent-framework-js/mcp";
import type { Tool } from "agent-framework-js/tools";
import type { TurnContext } from "../runtime/context.js";
import type { McpServerConfig } from "./config.js";
import { resolveSecrets } from "./secrets.js";
import { tracedTool } from "../runtime/toolTrace.js";

/**
 * Reduce an MCP tool result to a concise, human-readable value for the tool-call
 * card + trace. MCP results usually look like `{ content: [{ type: "text", text }] }`;
 * surface that text when present, else the raw result, capped so a large payload
 * never bloats the persisted chat record.
 */
function summarizeMcpResult(result: unknown): unknown {
  const cap = (s: string): string => (s.length > 6000 ? `${s.slice(0, 6000)}… (truncated)` : s);
  try {
    const r = result as { content?: Array<{ type?: string; text?: string }> };
    if (r && Array.isArray(r.content)) {
      const text = r.content
        .map((p) => (typeof p?.text === "string" ? p.text : JSON.stringify(p)))
        .join("\n");
      return cap(text);
    }
    return cap(typeof result === "string" ? result : JSON.stringify(result));
  } catch {
    return "done";
  }
}

/**
 * Wrap an MCP tool so each invocation flows through {@link tracedTool}: it charges
 * the per-turn budget (every MCP call is a subrequest) and emits the structured
 * tool-call lifecycle (input → output) that renders as an expandable card, shows
 * in agent activity, and is persisted to the chat history — exactly like the
 * brain's own tools.
 */
function traceMcpTool(ctx: TurnContext, tool: Tool): Tool {
  return {
    ...tool,
    run: (args: unknown) =>
      tracedTool(
        ctx,
        tool.name,
        args,
        () => {
          // Each MCP tool call hits the network → charge the subrequest budget.
          ctx.budget.git();
          return tool.run(args);
        },
        summarizeMcpResult,
      ),
  };
}

/**
 * Resolve `{{secret:NAME}}` references inside every header value, dropping any
 * that resolve to empty so a blank auth header is never sent. Returned as a
 * plain record the framework's header callback can hand to the transport.
 */
async function resolveHeaderSecrets(
  ctx: TurnContext,
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    const value = await resolveSecrets(ctx, raw);
    if (value) out[name] = value;
  }
  return out;
}

/** A live MCP connection plus the tools it contributed (for later cleanup). */
export interface McpAttachment {
  tools: Tool[];
  connections: MCPConnection[];
}

/**
 * Connect to all enabled remote MCP servers and gather their tools.
 *
 * @param ctx - Turn context (for budget accounting + tracing).
 * @param servers - Server configs from the brain's `mcp.json`.
 * @returns the combined tool list and open connections (close them after the turn).
 */
export async function attachMcpTools(
  ctx: TurnContext,
  servers: McpServerConfig[],
): Promise<McpAttachment> {
  const enabled = servers.filter((s) => s.enabled !== false);
  const tools: Tool[] = [];
  const connections: MCPConnection[] = [];

  for (const s of enabled) {
    // Connecting + listing tools each touch the network → charge the budget.
    ctx.budget.git();
    try {
      // Inject any `{{secret:NAME}}` references in the URL server-side (e.g. an
      // auth token in a query param). Secrets never appear in traces/markdown.
      const url = await resolveSecrets(ctx, s.url);
      const headers = s.headers && Object.keys(s.headers).length > 0 ? s.headers : undefined;
      const conn = await connectMCP({
        id: s.id,
        transport: {
          kind: "remote",
          url,
          ...(s.type ? { type: s.type } : {}),
          // Headers are resolved lazily via the framework's async callback so the
          // decrypted secret values are only materialized at connect time and
          // never persisted on the config object.
          ...(headers ? { headers: () => resolveHeaderSecrets(ctx, headers) } : {}),
        },
      });
      await conn.connect();
      const serverTools = await conn.listTools();
      // Wrap each MCP tool so its calls show as expandable cards + agent activity
      // and are persisted to chat history, like the brain's own tools.
      tools.push(...serverTools.map((t) => traceMcpTool(ctx, t)));
      connections.push(conn);
      ctx.emitTrace({ agent: "brain", tool: "mcp", detail: `${s.id}: ${serverTools.length} tool(s)` });
    } catch (err) {
      ctx.emitTrace({ agent: "brain", tool: "mcp", detail: `${s.id} unavailable: ${(err as Error).message}` });
    }
  }

  return { tools, connections };
}

/** Close MCP connections opened for a turn (best-effort, never throws). */
export async function closeMcp(attachment: McpAttachment): Promise<void> {
  await Promise.allSettled(attachment.connections.map((c) => c.close()));
}
