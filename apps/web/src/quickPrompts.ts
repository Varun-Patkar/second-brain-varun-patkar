/**
 * Static, code-defined quick-prompt templates.
 *
 * These are NOT user-editable and NOT persisted anywhere — they exist purely to
 * save typing (especially on a phone). Selecting one INSERTS its `text` into the
 * composer (it does not auto-send); the user finishes the thought and sends it
 * manually. A template may end mid-sentence or contain `[fill in]` markers the
 * user completes; there is no auto-substitution.
 *
 * @packageDocumentation
 */

/** A single quick-prompt template. */
export interface QuickPrompt {
  /** Stable id (used as the React key). */
  id: string;
  /** Short label shown in the popover and filtered against the user's typing. */
  label: string;
  /** The text inserted into the composer when the prompt is chosen. */
  text: string;
}

/**
 * The fixed catalogue of quick prompts. Keep these short and open-ended so the
 * user supplies the specifics. Order here is the order shown in the popover.
 */
export const QUICK_PROMPTS: QuickPrompt[] = [
  {
    id: "tasks-today",
    label: "Tasks for today",
    text: "Create tasks (type: task) for today: ",
  },
  {
    id: "remember",
    label: "Remember this",
    text: "Remember this for later: ",
  },
  {
    id: "journal",
    label: "Journal entry",
    text: "Add a journal entry for today: ",
  },
  {
    id: "person",
    label: "Note about a person",
    text: "Remember this about [person]: ",
  },
  {
    id: "project-update",
    label: "Project update",
    text: "Update on the [project] project: ",
  },
  {
    id: "decision",
    label: "Record a decision",
    text: "Record this decision and the reasoning behind it: ",
  },
  {
    id: "summarize",
    label: "Summarize what I know",
    text: "Summarize everything in my brain about ",
  },
  {
    id: "whats-related",
    label: "What's related to…",
    text: "What do I have related to ",
  },
];

/**
 * Filter the catalogue by a query (matches the label, case-insensitive). An empty
 * or whitespace-only query returns the full list.
 */
export function filterQuickPrompts(query: string): QuickPrompt[] {
  const q = query.trim().toLowerCase();
  if (!q) return QUICK_PROMPTS;
  return QUICK_PROMPTS.filter((p) => p.label.toLowerCase().includes(q));
}
