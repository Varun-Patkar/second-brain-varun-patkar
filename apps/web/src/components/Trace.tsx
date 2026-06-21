/** Live agent trace + per-turn metrics panel. */

import { AnimatePresence, motion } from "framer-motion";
import { Activity, GitCommit, Database, Cpu, Wrench, BookOpen } from "lucide-react";
import type { TraceEvent, TurnMetrics } from "@second-brain/shared";

/** Compaction kicks in at this fraction of the context window (framework default). */
const COMPACTION_THRESHOLD = 0.9;

/** Format a token count compactly (e.g. 12345 → "12.3k"). */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return `${n}`;
}

export function Trace({ trace, metrics }: { trace: TraceEvent[]; metrics: TurnMetrics | null }) {
  const showTokens = metrics?.tokensUsed != null && metrics.tokenLimit != null && metrics.tokenLimit > 0;
  return (
    <div className="glass flex h-full flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Activity className="h-4 w-4 text-aqua-400" />
          Agent activity
        </div>
        {showTokens && <TokenMeter used={metrics!.tokensUsed!} limit={metrics!.tokenLimit!} />}
      </div>

      <div className="flex-1 space-y-1.5 overflow-auto scroll-thin pr-1">
        <AnimatePresence initial={false}>
          {trace.length === 0 && (
            <p className="text-xs text-slate-600">Run a turn to see what the agents do.</p>
          )}
          {trace.map((e, i) => (
            <motion.div
              key={`${e.at}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs"
            >
              <span
                className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  e.agent === "brain" ? "bg-glow-400" : "bg-aqua-400"
                }`}
              />
              <div className="min-w-0">
                <span className="font-medium text-slate-300">{e.tool ?? e.agent}</span>
                <span className="ml-1 break-words text-slate-500">{e.detail}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {metrics && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-white/5 pt-2 text-[0.7rem]">
          <Metric icon={<Activity className="h-3 w-3" />} label="subreq" value={metrics.subrequestsUsed} max={50} />
          <Metric icon={<Cpu className="h-3 w-3" />} label="llm" value={metrics.llmCalls} />
          <Metric icon={<GitCommit className="h-3 w-3" />} label="git" value={metrics.gitCalls} />
          <Metric icon={<Database className="h-3 w-3" />} label="d1" value={metrics.d1Calls} />
          {metrics.toolsEnabled != null && (
            <Metric icon={<Wrench className="h-3 w-3" />} label="tools" value={metrics.toolsEnabled} />
          )}
          {metrics.skillsEnabled != null && (
            <Metric icon={<BookOpen className="h-3 w-3" />} label="skills" value={metrics.skillsEnabled} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A compact context-window meter: shows `used / limit` tokens with a colour-coded
 * bar (emerald < 50%, amber 50–80%, rose > 80%) and how far the conversation is
 * from the ~90% compaction threshold. Token usage is reported by the framework.
 */
function TokenMeter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(1, used / limit);
  const colour = pct < 0.5 ? "bg-emerald-400" : pct < 0.8 ? "bg-amber-400" : "bg-rose-400";
  const text = pct < 0.5 ? "text-emerald-300" : pct < 0.8 ? "text-amber-300" : "text-rose-300";
  const away = Math.max(0, Math.round(COMPACTION_THRESHOLD * limit - used));
  const caption =
    away > 0
      ? `Compacts at ~${Math.round(COMPACTION_THRESHOLD * 100)}% (${formatTokens(away)} away)`
      : "At the compaction threshold";
  return (
    <div
      className="flex min-w-0 flex-col items-end gap-0.5"
      title={`${used.toLocaleString()} / ${limit.toLocaleString()} context tokens`}
    >
      <div className={`flex items-center gap-1.5 font-mono text-[0.7rem] ${text}`}>
        <span>
          {formatTokens(used)} / {formatTokens(limit)}
        </span>
      </div>
      <div className="h-1 w-20 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-[0.6rem] text-slate-500">{caption}</span>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  max,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max?: number;
}) {
  const danger = max != null && value >= max * 0.8;
  return (
    <div
      className={`flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1 ${
        danger ? "text-amber-400" : "text-slate-400"
      }`}
    >
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="font-mono">
        {value}
        {max ? `/${max}` : ""}
      </span>
    </div>
  );
}
