/**
 * TasksPage — a dedicated, LLM-free checklist over the brain's `type=task` nodes.
 *
 * It is URL-bound (`#tasks`) and interactive: toggling a checkbox calls the worker
 * status endpoint, which updates BOTH the markdown frontmatter (`status`) and the
 * D1 `archived` flag as one unit. A completed task is archived, so it disappears
 * from normal LLM retrieval (graph_search/context) — but it still shows here,
 * checked, until reopened.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Brain, CheckSquare, Square, Loader2, ListTodo } from "lucide-react";
import type { TaskItem } from "@second-brain/shared";
import { getTasks, setTaskStatus } from "../api.js";

export function TasksPage({ onBack }: { onBack: () => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ids currently being toggled (to disable the row + show a spinner).
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    getTasks()
      .then(setTasks)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tasks"))
      .finally(() => setLoading(false));
  }, []);

  /** Toggle a task's done state with an optimistic update + rollback on error. */
  const toggle = async (task: TaskItem) => {
    if (pending.has(task.id)) return;
    const next = !task.done;
    setPending((p) => new Set(p).add(task.id));
    setError(null);
    // Optimistic update.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)));
    try {
      await setTaskStatus(task.id, next);
    } catch (e) {
      // Roll back on failure.
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)));
      setError(e instanceof Error ? e.message : "Failed to update task");
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(task.id);
        return n;
      });
    }
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div className="mx-auto flex h-full w-[90vw] flex-col gap-3 p-3 md:p-4">
      {/* Header */}
      <header className="glass flex items-center justify-between rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gradient">Tasks</div>
            <div className="text-[0.7rem] text-slate-500">
              {open.length} open · {done.length} done
            </div>
          </div>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chat
        </button>
      </header>

      {/* Body */}
      <section className="glass min-h-0 flex-1 overflow-auto scroll-thin rounded-2xl p-4">
        {loading ? (
          <div className="grid h-full place-items-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-slate-500">
            <div>
              <ListTodo className="mx-auto mb-3 h-10 w-10 text-slate-600" />
              No tasks yet. Ask the chat to create some (try the “Tasks for today” quick prompt).
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {error && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                {error}
              </div>
            )}

            {open.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">To do</h3>
                {open.map((t) => (
                  <TaskRow key={t.id} task={t} pending={pending.has(t.id)} onToggle={() => toggle(t)} />
                ))}
              </div>
            )}

            {done.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Done</h3>
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} pending={pending.has(t.id)} onToggle={() => toggle(t)} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** A single task row: a toggle checkbox plus the title + summary. */
function TaskRow({
  task,
  pending,
  onToggle,
}: {
  task: TaskItem;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
    >
      <button
        onClick={onToggle}
        disabled={pending}
        className="mt-0.5 shrink-0 text-slate-400 transition hover:text-glow-300 disabled:opacity-50"
        title={task.done ? "Mark as not done" : "Mark as done"}
      >
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : task.done ? (
          <CheckSquare className="h-5 w-5 text-emerald-400" />
        ) : (
          <Square className="h-5 w-5" />
        )}
      </button>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${task.done ? "text-slate-500 line-through" : "text-slate-200"}`}>
          {task.title}
        </div>
        {task.summary && (
          <div className={`text-xs ${task.done ? "text-slate-600" : "text-slate-500"}`}>{task.summary}</div>
        )}
      </div>
    </motion.div>
  );
}
