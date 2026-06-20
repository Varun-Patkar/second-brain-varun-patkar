/**
 * ToolCallCard — an expandable inline card for a single tool invocation, shown
 * within the assistant message (like Copilot's tool calls). Collapsed it shows the
 * tool name + status; expanded it reveals the input arguments and the output
 * (result summary on success, or the error message on failure).
 *
 * @packageDocumentation
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Wrench, Check, X, Loader2 } from "lucide-react";
import type { ToolCall } from "@second-brain/shared";

export function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);

  const statusIcon =
    call.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-glow-400" />
    ) : call.status === "ok" ? (
      <Check className="h-3.5 w-3.5 text-emerald-400" />
    ) : (
      <X className="h-3.5 w-3.5 text-rose-400" />
    );

  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-white/[0.03]"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition ${open ? "rotate-90" : ""}`} />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="font-mono font-medium text-slate-200">{call.name}</span>
        <span className="ml-auto flex items-center gap-1 text-slate-500">
          {statusIcon}
          {call.status === "running" ? "running" : call.status === "ok" ? "done" : "error"}
        </span>
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-2 border-t border-white/5 px-2.5 py-2"
        >
          <Block label="Input" value={call.input} />
          {call.output !== undefined && (
            <Block label={call.status === "error" ? "Error" : "Output"} value={call.output} danger={call.status === "error"} />
          )}
        </motion.div>
      )}
    </div>
  );
}

/** A labeled, scrollable code block for a tool's input/output value. */
function Block({ label, value, danger }: { label: string; value: unknown; danger?: boolean }) {
  const text = typeof value === "string" ? value : safeStringify(value);
  return (
    <div>
      <div className="mb-1 text-[0.65rem] uppercase tracking-wide text-slate-500">{label}</div>
      <pre
        className={`max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[0.7rem] scroll-thin ${
          danger ? "text-rose-300" : "text-slate-400"
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
