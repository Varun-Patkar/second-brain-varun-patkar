/** Live agent trace + per-turn metrics panel. */

import { AnimatePresence, motion } from "framer-motion";
import { Activity, GitCommit, Database, Cpu, Wrench, BookOpen } from "lucide-react";
import type { TraceEvent, TurnMetrics } from "@second-brain/shared";

export function Trace({ trace, metrics }: { trace: TraceEvent[]; metrics: TurnMetrics | null }) {
  return (
    <div className="glass flex h-full flex-col rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
        <Activity className="h-4 w-4 text-aqua-400" />
        Agent activity
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
