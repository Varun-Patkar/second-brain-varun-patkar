/**
 * TasksPage — a dedicated, LLM-free checklist over the brain's `type=task` nodes,
 * rendered as a top-to-bottom date timeline:
 *
 * - "Upcoming" (top) lists OPEN tasks whose `startDate` is in the future, grouped
 *   by start day, furthest day first so the nearest sits just above Today.
 * - "Today" lists every OPEN task that has started: tasks with no dates, tasks
 *   inside their `start…end` window, indefinite tasks (a `startDate` but no
 *   `endDate`, which keep showing daily until done), and overdue tasks (an
 *   `endDate` in the past) — each carrying a small Due/Overdue/Ongoing chip.
 * - "Earlier" (bottom) lists DONE tasks grouped by their COMPLETION day.
 *
 * Toggling a checkbox calls the worker status endpoint, which updates BOTH the
 * markdown frontmatter (`status` + `completedAt`) and the D1 `archived`/`completed_at`
 * columns as one unit. A completed task is archived, so it disappears from normal
 * LLM retrieval — but it still shows here (under "Earlier") until reopened.
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
  CalendarPlus,
  History,
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

/** Local YYYY-MM-DD for the current day. */
function todayKey(): string {
  return dateKey(new Date().toISOString());
}

/**
 * A human-friendly label for a YYYY-MM-DD day key: "Today", "Tomorrow",
 * "Yesterday", or e.g. "Jun 27, 2026". Accepts a plain day key (start/end dates)
 * — parsed in local time so the label matches the user's wall clock.
 */
function friendlyDay(key: string): string {
  if (key === todayKey()) return "Today";
  if (key === dateKey(new Date(Date.now() + 86_400_000).toISOString())) return "Tomorrow";
  if (key === dateKey(new Date(Date.now() - 86_400_000).toISOString())) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(dt.getTime())) return key;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** True when a task's start day has arrived (or it has no start day). */
function hasStarted(t: TaskItem): boolean {
  return !t.startDate || t.startDate <= todayKey();
}

/** Day used to file a DONE task under "Earlier": its completion day (fallback: created). */
function completionKey(t: TaskItem): string {
  return dateKey(t.completedAt ?? t.createdAt);
}

/** A small status chip shown on a task row. */
type TaskTag = { label: string; variant: "amber" | "rose" | "slate" | "glow" };

/** Tailwind classes per chip variant. */
const TAG_CLASSES: Record<TaskTag["variant"], string> = {
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  slate: "border-white/10 bg-white/5 text-slate-400",
  glow: "border-glow-500/30 bg-glow-500/10 text-glow-300",
};

/** Chip for an OPEN task shown in Today: overdue → due → ongoing → (none). */
function todayTag(t: TaskItem): TaskTag | undefined {
  if (t.endDate && t.endDate < todayKey()) return { label: `Overdue ${friendlyDay(t.endDate)}`, variant: "rose" };
  if (t.endDate) return { label: `Due ${friendlyDay(t.endDate)}`, variant: "amber" };
  if (t.startDate) return { label: "Ongoing", variant: "glow" };
  return undefined;
}

/** Chip for an upcoming task: its due day, or "Ongoing" when indefinite. */
function futureTag(t: TaskItem): TaskTag | undefined {
  if (t.endDate) return { label: `Due ${friendlyDay(t.endDate)}`, variant: "amber" };
  return { label: "Ongoing", variant: "slate" };
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

  // Upcoming: open, future-dated tasks grouped by start day (furthest day first,
  // so the nearest upcoming day sits directly above "Today").
  const futureGroups = useMemo(() => {
    const tk = todayKey();
    const future = tasks.filter((t) => !t.done && t.startDate && t.startDate > tk);
    const byKey = new Map<string, { label: string; sortKey: string; items: TaskItem[] }>();
    for (const t of future) {
      const key = t.startDate!;
      const group = byKey.get(key) ?? { label: friendlyDay(key), sortKey: key, items: [] };
      group.items.push(t);
      byKey.set(key, group);
    }
    return [...byKey.values()].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [tasks]);

  // Today: every open task that has started (windowed, indefinite, overdue, or
  // undated). Overdue first, then due-dated, then ongoing/undated.
  const todayTasks = useMemo(() => {
    const open = tasks.filter((t) => !t.done && hasStarted(t));
    const rank = (t: TaskItem): number => {
      if (t.endDate && t.endDate < todayKey()) return 0; // overdue
      if (t.endDate) return 1; // has a due date
      return 2; // ongoing / undated
    };
    return [...open].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return b.createdAt.localeCompare(a.createdAt); // newest first within a bucket
    });
  }, [tasks]);

  // Earlier: done tasks grouped by their completion day, newest day first.
  const pastGroups = useMemo(() => {
    const done = tasks.filter((t) => t.done);
    const byKey = new Map<string, { label: string; sortKey: string; items: TaskItem[] }>();
    for (const t of done) {
      const key = completionKey(t);
      const group = byKey.get(key) ?? { label: friendlyDay(key), sortKey: key, items: [] };
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

            {/* Upcoming — future-dated open tasks grouped by start day. */}
            {futureGroups.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <CalendarPlus className="h-3.5 w-3.5 text-aqua-400" />
                  Upcoming
                </h3>
                {futureGroups.map((g) => (
                  <DateGroup
                    key={g.sortKey}
                    label={g.label}
                    items={g.items}
                    pending={pending}
                    readOnly={readOnly}
                    onToggle={toggle}
                    defaultOpen
                    tagFor={futureTag}
                  />
                ))}
              </div>
            )}

            {/* Today — always shown, even when empty. */}
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <CalendarClock className="h-3.5 w-3.5 text-glow-400" />
                Today
              </h3>
              {todayTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 bg-black/10 px-3 py-8 text-center text-sm text-slate-500">
                  <ListTodo className="h-8 w-8 text-slate-600" />
                  No tasks today.
                </div>
              ) : (
                todayTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    pending={pending.has(t.id)}
                    readOnly={readOnly}
                    onToggle={() => toggle(t)}
                    tag={todayTag(t)}
                  />
                ))
              )}
            </div>

            {/* Earlier — done tasks grouped by completion day, collapsed + expandable. */}
            {pastGroups.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <History className="h-3.5 w-3.5 text-slate-500" />
                  Earlier
                </h3>
                {pastGroups.map((g) => (
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

/** A collapsible, date-labelled group of tasks. Collapsed by default. */
function DateGroup({
  label,
  items,
  pending,
  onToggle,
  readOnly = false,
  defaultOpen = false,
  tagFor,
}: {
  label: string;
  items: TaskItem[];
  pending: Set<string>;
  onToggle: (t: TaskItem) => void;
  readOnly?: boolean;
  /** Whether the group starts expanded (used for upcoming days). */
  defaultOpen?: boolean;
  /** Optional per-item chip (e.g. due date) shown on each row. */
  tagFor?: (t: TaskItem) => TaskTag | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
            <TaskRow
              key={t.id}
              task={t}
              pending={pending.has(t.id)}
              readOnly={readOnly}
              onToggle={() => onToggle(t)}
              tag={tagFor?.(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single task row: a toggle checkbox plus the title + summary (and an optional status chip). */
function TaskRow({
  task,
  pending,
  onToggle,
  tag,
  readOnly = false,
}: {
  task: TaskItem;
  pending: boolean;
  onToggle: () => void;
  /** When set, renders a small status chip (due / overdue / ongoing / start day). */
  tag?: TaskTag | undefined;
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
          {tag && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[0.6rem] font-medium ${TAG_CLASSES[tag.variant]}`}
            >
              {tag.label}
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
