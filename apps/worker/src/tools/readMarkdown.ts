/**
 * `read_markdown` tool — load full node documents by id (KV-cached, GitHub on
 * miss). Bumps access counters for the nodes actually read.
 *
 * @packageDocumentation
 */

import { defineTool } from "agent-framework-js/tools";
import type { NodeDocument } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { getNodes, bumpAccess } from "../storage/d1.js";
import { getCachedDoc, putCachedDoc } from "../storage/kv.js";
import { readFile } from "../storage/github.js";
import { parseDocument } from "../util/markdown.js";

interface ReadArgs {
  ids: string[];
}

export function createReadMarkdownTool(ctx: TurnContext) {
  return defineTool<ReadArgs, { documents: NodeDocument[] }>({
    name: "read_markdown",
    description: "Load the full markdown content of specific nodes by their ids (obtained from graph_search).",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Node ids to load." },
      },
      required: ["ids"],
    },
    run: async ({ ids }) => {
      try {
        const documents: NodeDocument[] = [];
        const misses: string[] = [];

        for (const id of ids) {
          const cached = await getCachedDoc(ctx, id);
          if (cached) documents.push(cached);
          else misses.push(id);
        }

        if (misses.length > 0) {
          const nodes = await getNodes(ctx, misses);
          for (const node of nodes) {
            const file = await readFile(ctx, node.mdPath);
            if (!file) continue;
            const { frontmatter, body } = parseDocument(file.text);
            const doc: NodeDocument = { id: node.id, mdPath: node.mdPath, body, frontmatter };
            await putCachedDoc(ctx, doc);
            documents.push(doc);
          }
        }

        if (documents.length > 0) await bumpAccess(ctx, documents.map((d) => d.id), "read");
        ctx.emitTrace({
          agent: "brain",
          tool: "read_markdown",
          detail: `${ids.length} id(s) → ${documents.length} doc(s)`,
        });
        return { documents };
      } catch (err) {
        ctx.emitTrace({
          agent: "brain",
          tool: "read_markdown",
          detail: `${ids.length} id(s) → error: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw err;
      }
    },
  });
}
