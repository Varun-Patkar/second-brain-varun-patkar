/**
 * TasksPage — a dedicated, LLM-free checklist over the brain's `type=task` nodes,
 * organised as a date-wise view.
 *
 * Layout:
 * - "Today" is always shown at the top. It lists every OPEN task. Tasks created
 *   today appear untagged; older still-open ("leftover") tasks bubble up here too
 *   but carry a small "created <date>" tag. When there are no open tasks at all it
 *   shows a friendly "No tasks today" placeholder.
 * - "Earlier" lists DONE tasks grouped by their creation date. Each date group is
 *   collapsed by default and expandable. Empty date groups are never rendered.
 *
 * Toggling a checkbox calls the worker status endpoint, which updates BOTH the
 * markdown frontmatter (`status`) and the D1 `archived` flag as one unit. A
 * completed task is archived, so it disappears from normal LLM retrieval — but it
 * still shows here (under "Earlier") until reopened.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Brain,
  CheckSquare,
  Square,
  Loader2,
  ListTodo,
  ChevronRight,
  CalendarClock,
} from "lucide-react";
import type { TaskItem } from "@second-brain/shared";
import { getTasks, setTaskStatus } from "../api.js";

/** Local YYYY-MM-DD key for a date (used to group tasks by calendar day). */
function dateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  // Use local time so "today" matches the user's wall clock, not UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A human-friendly label for a date: "Today", "Yesterday", or e.g. "Jun 18, 2026". */
function friendlyDate(iso: string): string {
  const key = dateKey(iso);
  const today = dateKey(new Date().toISOString());
  const yesterday = dateKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** True when an ISO timestamp falls on the current local calendar day. */
function isToday(iso: string): boolean {
  return dateKey(iso) === dateKey(new Date().toISOString());
}

export function TasksPage({ onBack, readOnly = false }: { onBack: () => void; readOnly?: boolean }) {
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
    // Anonymous visitors can view tasks but never change them.
    if (readOnly || pending.has(task.id)) return;
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

  // Open tasks (any date) live in "Today"; today's-created first, then older.
  const openTasks = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    return [...open].sort((a, b) => {
      const at = isToday(a.createdAt) ? 0 : 1;
      const bt = isToday(b.createdAt) ? 0 : 1;
      if (at !== bt) return at - bt;
      return b.createdAt.localeCompare(a.createdAt); // newest first within a bucket
    });
  }, [tasks]);

  // Done tasks grouped by their creation date, newest date first.
  const doneGroups = useMemo(() => {
    const done = tasks.filter((t) => t.done);
    const byKey = new Map<string, { label: string; sortKey: string; items: TaskItem[] }>();
    for (const t of done) {
      const key = dateKey(t.createdAt);
      const group = byKey.get(key) ?? { label: friendlyDate(t.createdAt), sortKey: key, items: [] };
      group.items.push(t);
      byKey.set(key, group);
    }
    return [...byKey.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [tasks]);

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
          {readOnly ? "Sign in" : "Back to chat"}
        </button>
      </header>

      {/* Body */}
      <section className="glass min-h-0 flex-1 overflow-auto scroll-thin rounded-2xl p-4">
        {loading ? (
          <div className="grid h-full place-items-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-6">
            {error && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                {error}
              </div>
            )}

            {/* Today — always shown, even when empty. */}
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <CalendarClock className="h-3.5 w-3.5 text-glow-400" />
                Today
              </h3>
              {openTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 bg-black/10 px-3 py-8 text-center text-sm text-slate-500">
                  <ListTodo className="h-8 w-8 text-slate-600" />
                  No tasks today.
                </div>
              ) : (
                openTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    pending={pending.has(t.id)}
                    readOnly={readOnly}
                    onToggle={() => toggle(t)}
                    {...(isToday(t.createdAt) ? {} : { dateTag: friendlyDate(t.createdAt) })}
                  />
                ))
              )}
            </div>

            {/* Earlier — done tasks grouped by creation date, collapsed + expandable. */}
            {doneGroups.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Earlier</h3>
                {doneGroups.map((g) => (
                  <DateGroup
                    key={g.sortKey}
                    label={g.label}
                    items={g.items}
                    pending={pending}
                    readOnly={readOnly}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )}

            {tasks.length === 0 && !error && (
              <p className="text-center text-xs text-slate-600">
                Ask the chat to create some (try the “Tasks for today” quick prompt).
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** A collapsible, date-labelled group of done tasks. Collapsed by default. */
function DateGroup({
  label,
  items,
  pending,
  onToggle,
  readOnly = false,
}: {
  label: string;
  items: TaskItem[];
  pending: Set<string>;
  onToggle: (t: TaskItem) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-90" : ""}`} />
        <span className="font-medium">{label}</span>
        <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[0.65rem] text-slate-500">
          {items.length}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/[0.06] p-2">
          {items.map((t) => (
            <TaskRow key={t.id} task={t} pending={pending.has(t.id)} readOnly={readOnly} onToggle={() => onToggle(t)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single task row: a toggle checkbox plus the title + summary (and an optional date tag). */
function TaskRow({
  task,
  pending,
  onToggle,
  dateTag,
  readOnly = false,
}: {
  task: TaskItem;
  pending: boolean;
  onToggle: () => void;
  /** When set, renders a small date chip (used for leftover open tasks). */
  dateTag?: string;
  /** Read-only (anonymous) mode: the checkbox is shown but not interactive. */
  readOnly?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
    >
      <button
        onClick={onToggle}
        disabled={pending || readOnly}
        className="mt-0.5 shrink-0 text-slate-400 transition hover:text-glow-300 disabled:opacity-50 disabled:hover:text-slate-400"
        title={readOnly ? (task.done ? "Done" : "Open") : task.done ? "Mark as not done" : "Mark as done"}
      >
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : task.done ? (
          <CheckSquare className="h-5 w-5 text-emerald-400" />
        ) : (
          <Square className="h-5 w-5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div
            className={`text-sm font-medium ${task.done ? "text-slate-500 line-through" : "text-slate-200"}`}
          >
            {task.title}
          </div>
          {dateTag && (
            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-300">
              {dateTag}
            </span>
          )}
        </div>
        {task.summary && (
          <div className={`text-xs ${task.done ? "text-slate-600" : "text-slate-500"}`}>{task.summary}</div>
        )}
      </div>
    </motion.div>
  );
}
