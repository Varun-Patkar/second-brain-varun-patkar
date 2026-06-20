/**
 * Tool factory for the brain agent. The agent gets exactly three tools — search,
 * read, write — keeping the reasoning loop simple and the subrequest count low.
 *
 * @packageDocumentation
 */

import type { TurnContext } from "../runtime/context.js";
import { createGraphSearchTool } from "./graphSearch.js";
import { createReadMarkdownTool } from "./readMarkdown.js";
import { createWriteBrainTool } from "./writeBrain.js";
import { createWriteConfigTool } from "./writeConfig.js";
import { createTrashNoteTool } from "./trashNote.js";

/** Build the brain agent's tool set bound to the current turn context. */
export function createBrainTools(ctx: TurnContext) {
  return [
    createGraphSearchTool(ctx),
    createReadMarkdownTool(ctx),
    createWriteBrainTool(ctx),
    createTrashNoteTool(ctx),
    createWriteConfigTool(ctx),
  ];
}
