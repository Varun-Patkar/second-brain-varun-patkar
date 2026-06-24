/**
 * SkillsSection — the skills block of the config page. Skills can be authored in
 * the visual editor, uploaded as standard `skills/<name>.md` files (a template is
 * downloadable), previewed as rendered markdown, or delegated to the agent via a
 * prefilled chat prompt. Secrets may be referenced in skill content as
 * `{{secret:NAME}}`.
 *
 * @packageDocumentation
 */

import { useRef, useState } from "react";
import { BookOpen, Plus, Trash2, Eye, Upload, Download, Sparkles, KeyRound } from "lucide-react";
import type { BrainSkill } from "@second-brain/shared";
import { SkillPreview } from "./SkillPreview.js";
import { downloadTextFile, parseSkillFile, SKILL_TEMPLATE } from "./skillFile.js";

/** Prompt seeded into a fresh chat when the user asks the agent to add a skill. */
const AGENT_PROMPT =
  "Add a new skill to my brain config. Here's what I want (fill in the details): " +
  "the skill is called ___, it should be used WHEN ___, and it should teach you to ___. " +
  "If the skill needs a secret value, reference it as {{secret:NAME}} rather than writing it out.";

export function SkillsSection({
  skills,
  readOnly,
  onChange,
  onDeclareViaAgent,
}: {
  skills: BrainSkill[];
  readOnly?: boolean;
  onChange: (skills: BrainSkill[]) => void;
  onDeclareViaAgent: (prompt: string) => void;
}) {
  const [preview, setPreview] = useState<BrainSkill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patchSkill = (i: number, patch: Partial<BrainSkill>): void =>
    onChange(skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeSkill = (i: number): void => onChange(skills.filter((_, idx) => idx !== i));
  const addSkill = (): void => onChange([...skills, { name: "", description: "", content: "" }]);

  /** Import one or more uploaded `.md` skill files into the editor. */
  const onUpload = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const imported: BrainSkill[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text();
      const fallback = file.name.replace(/\.md$/i, "");
      imported.push(parseSkillFile(text, fallback));
    }
    onChange([...skills, ...imported]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
        <BookOpen className="h-4 w-4" />
        Skills
      </div>

      <p className="mb-2 flex items-start gap-1.5 text-[0.7rem] text-slate-500">
        <KeyRound className="mt-0.5 h-3 w-3 shrink-0 text-aqua-400" />
        <span>
          Tip: reference a stored secret in skill content as{" "}
          <code className="rounded bg-black/40 px-1 text-aqua-400">{"{{secret:NAME}}"}</code> — it is resolved
          server-side and never shown to the model in plaintext.
        </span>
      </p>

      <div className="space-y-2">
        {skills.map((s, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={s.name}
                onChange={(e) => patchSkill(i, { name: e.target.value })}
                placeholder="name"
                className="input w-full sm:w-40 sm:flex-none"
                disabled={readOnly}
              />
              <div className="flex w-full items-center gap-2 sm:flex-1">
                <input
                  value={s.description}
                  onChange={(e) => patchSkill(i, { description: e.target.value })}
                  placeholder="when to use this skill"
                  className="input flex-1"
                  disabled={readOnly}
                />
                <button
                  onClick={() => setPreview(s)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                  title="Preview"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  onClick={() => downloadTextFile(`${s.name || "skill"}.md`, [`---`, `name: ${s.name}`, `description: ${s.description}`, `---`, ``, s.content].join("\n"))}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                  title="Download this skill"
                >
                  <Download className="h-4 w-4" />
                </button>
                {!readOnly && (
                  <button
                    onClick={() => removeSkill(i)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={s.content}
              onChange={(e) => patchSkill(i, { content: e.target.value })}
              placeholder="Full skill content (markdown)…"
              rows={3}
              className="input resize-y font-mono text-xs"
              disabled={readOnly}
            />
          </div>
        ))}
        {skills.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
            No skills configured.
          </p>
        )}

        {!readOnly && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              multiple
              className="hidden"
              onChange={(e) => void onUpload(e.target.files)}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                onClick={addSkill}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
              >
                <Plus className="h-4 w-4" />
                Add skill
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
              >
                <Upload className="h-4 w-4" />
                Upload skill file
              </button>
              <button
                onClick={() => downloadTextFile("skill-template.md", SKILL_TEMPLATE)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
              >
                <Download className="h-4 w-4" />
                Download template
              </button>
              <button
                onClick={() => onDeclareViaAgent(AGENT_PROMPT)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-glow-500/30 px-3 py-2 text-sm text-glow-300 transition hover:border-glow-500/50 hover:text-glow-200"
              >
                <Sparkles className="h-4 w-4" />
                Declare via agent
              </button>
            </div>
          </>
        )}
      </div>

      {preview && <SkillPreview skill={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
