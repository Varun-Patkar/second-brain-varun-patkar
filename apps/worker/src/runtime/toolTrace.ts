/**
 * tracedTool — wraps a tool's work so the UI receives a structured tool-call
 * lifecycle: a "running" event with the input, then an "ok"/"error" update with
 * a concise output (or the error message). Also mirrors a one-line summary into
 * the agent-activity trace. Errors are re-thrown so the framework can feed them
 * back to the model for self-correction.
 *
 * @packageDocumentation
 */

import type { TurnContext } from "./context.js";
import { genId } from "../util/ids.js";

/**
 * Run `fn` as a traced tool call.
 *
 * @param ctx - Turn context (carries the emitters).
 * @param name - Tool name shown in the UI.
 * @param input - Arguments the model supplied (rendered in the expandable card).
 * @param fn - The actual tool work.
 * @param summarize - Optional concise output for the card/trace (avoid huge blobs).
 */
export async function tracedTool<T>(
  ctx: TurnContext,
  name: string,
  input: unknown,
  fn: () => Promise<T>,
  summarize?: (result: T) => unknown,
): Promise<T> {
  const id = genId("call");
  ctx.emitTool?.({ id, name, input, status: "running" });
  try {
    const value = await fn();
    const output = summarize ? summarize(value) : undefined;
    ctx.emitTool?.({ id, name, input, status: "ok", ...(output !== undefined ? { output } : {}) });
    ctx.emitTrace({ agent: "brain", tool: name, detail: summaryText(output) });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.emitTool?.({ id, name, input, status: "error", output: message });
    ctx.emitTrace({ agent: "brain", tool: name, detail: `error: ${message}` });
    throw err;
  }
}

/** A compact one-line string of a tool's output for the trace panel. */
function summaryText(output: unknown): string {
  if (output == null) return "done";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return "done";
  }
}
