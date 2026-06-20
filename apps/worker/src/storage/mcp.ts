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
      const conn = await connectMCP({ id: s.id, transport: { kind: "remote", url: s.url } });
      await conn.connect();
      const serverTools = await conn.listTools();
      tools.push(...serverTools);
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
