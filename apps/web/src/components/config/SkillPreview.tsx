/**
 * SkillPreview — a modal that renders a skill's markdown body (with its name and
 * description header) so the user can read a skill the way the agent would, from
 * within the config page.
 *
 * @packageDocumentation
 */

import { motion } from "framer-motion";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { BrainSkill } from "@second-brain/shared";

export function SkillPreview({ skill, onClose }: { skill: BrainSkill; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gradient">{skill.name || "Untitled skill"}</div>
            {skill.description && <div className="mt-0.5 text-xs text-slate-500">{skill.description}</div>}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto scroll-thin p-4">
          <div className="prose-brain">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {skill.content || "_This skill has no content yet._"}
            </ReactMarkdown>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
