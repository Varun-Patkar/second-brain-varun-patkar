/**
 * `graph_search` tool — FTS5 keyword search + 1-hop graph expansion.
 * Returns summaries only (no markdown bodies) to force a deliberate second read.
 *
 * @packageDocumentation
 */

import { defineTool } from "agent-framework-js/tools";
import type { NodeType, SearchResult } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { search } from "../storage/d1.js";

interface SearchArgs {
  query: string;
  k?: number;
  types?: string[];
}

export function createGraphSearchTool(ctx: TurnContext) {
  return defineTool<SearchArgs, { results: SearchResult[] }>({
    name: "graph_search",
    description:
      "Search the brain for relevant nodes by keywords. Returns summaries and 1-hop neighbors only (no bodies). Call read_markdown to get full content for the few nodes you actually need.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to search for." },
        k: { type: "number", description: "Max results (default 5).", default: 5 },
        types: {
          type: "array",
          items: { type: "string" },
          description: "Optional node-type filter, e.g. ['person','project'].",
        },
      },
      required: ["query"],
    },
    run: async ({ query, k, types }) => {
      const results = await search(ctx, query, k ?? 5, types as NodeType[] | undefined);
      ctx.emitTrace({ agent: "brain", tool: "graph_search", detail: `“${query}” → ${results.length} result(s)` });
      return { results };
    },
  });
}
