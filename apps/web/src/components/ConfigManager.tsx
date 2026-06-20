/**
 * ConfigManager — a modal for manually viewing and editing the brain's MCP
 * servers and skills (the same config the agent can edit via `write_config`).
 * Loads the current config from the worker on open, lets the owner add/edit/remove
 * entries, and saves them back as a single commit.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, Trash2, Loader2, Server, BookOpen, Save } from "lucide-react";
import type { BrainSkill, McpServerConfig } from "@second-brain/shared";
import { getConfig, saveConfig } from "../api.js";

type SaveState = "idle" | "saving" | "saved" | "error";

export function ConfigManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [skills, setSkills] = useState<BrainSkill[]>([]);
  const [originalSkillNames, setOriginalSkillNames] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Load the current config each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSave("idle");
    getConfig()
      .then((cfg) => {
        setServers(cfg.mcpServers);
        setSkills(cfg.skills);
        setOriginalSkillNames(cfg.skills.map((s) => s.name));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load config"))
      .finally(() => setLoading(false));
  }, [open]);

  const patchServer = (i: number, patch: Partial<McpServerConfig>) =>
    setServers((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const patchSkill = (i: number, patch: Partial<BrainSkill>) =>
    setSkills((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const onSave = async () => {
    setSave("saving");
    setError(null);
    // Skills removed from the list (by name) are deleted on the branch.
    const currentNames = new Set(skills.map((s) => s.name));
    const deleteSkills = originalSkillNames.filter((n) => !currentNames.has(n));
    try {
      await saveConfig({
        mcpServers: servers.filter((s) => s.id && s.url),
        upsertSkills: skills.filter((s) => s.name && s.content),
        deleteSkills,
      });
      setOriginalSkillNames(skills.map((s) => s.name));
      setSave("saved");
    } catch (e) {
      setSave("error");
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-3" initial={false}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="glass relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="text-sm font-semibold text-slate-200">MCP servers &amp; skills</span>
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-auto scroll-thin p-4">
              {loading ? (
                <div className="grid place-items-center py-10 text-slate-500">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <>
                  {/* MCP servers */}
                  <section>
                    <SectionHeader icon={<Server className="h-4 w-4" />} title="MCP servers (remote HTTPS only)" />
                    <div className="space-y-2">
                      {servers.map((s, i) => (
                        <div key={i} className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                          <div className="flex items-center gap-2">
                            <input
                              value={s.id}
                              onChange={(e) => patchServer(i, { id: e.target.value })}
                              placeholder="id (e.g. docs)"
                              className="input flex-[0_0_8rem]"
                            />
                            <input
                              value={s.url}
                              onChange={(e) => patchServer(i, { url: e.target.value })}
                              placeholder="https://mcp.example.com"
                              className="input flex-1"
                            />
                            <button
                              onClick={() => setServers((p) => p.filter((_, idx) => idx !== i))}
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                            <input
                              type="checkbox"
                              checked={s.enabled !== false}
                              onChange={(e) => patchServer(i, { enabled: e.target.checked })}
                              className="accent-glow-500"
                            />
                            Enabled
                            {s.url && !/^https:\/\//i.test(s.url) && (
                              <span className="text-amber-400">— must be an https URL</span>
                            )}
                          </label>
                        </div>
                      ))}
                      <AddButton
                        label="Add MCP server"
                        onClick={() => setServers((p) => [...p, { id: "", url: "", enabled: true }])}
                      />
                    </div>
                  </section>

                  {/* Skills */}
                  <section>
                    <SectionHeader icon={<BookOpen className="h-4 w-4" />} title="Skills" />
                    <div className="space-y-2">
                      {skills.map((s, i) => (
                        <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-2.5">
                          <div className="flex items-center gap-2">
                            <input
                              value={s.name}
                              onChange={(e) => patchSkill(i, { name: e.target.value })}
                              placeholder="name"
                              className="input flex-[0_0_10rem]"
                            />
                            <input
                              value={s.description}
                              onChange={(e) => patchSkill(i, { description: e.target.value })}
                              placeholder="when to use this skill"
                              className="input flex-1"
                            />
                            <button
                              onClick={() => setSkills((p) => p.filter((_, idx) => idx !== i))}
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <textarea
                            value={s.content}
                            onChange={(e) => patchSkill(i, { content: e.target.value })}
                            placeholder="Full skill content (markdown)…"
                            rows={3}
                            className="input resize-y font-mono text-xs"
                          />
                        </div>
                      ))}
                      <AddButton
                        label="Add skill"
                        onClick={() =>
                          setSkills((p) => [...p, { name: "", description: "", content: "" }])
                        }
                      />
                    </div>
                  </section>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-3">
              <div className="min-w-0 text-xs">
                {error && <span className="text-amber-400">{error}</span>}
                {save === "saved" && !error && <span className="text-emerald-400">Saved.</span>}
              </div>
              <button
                onClick={onSave}
                disabled={loading || save === "saving"}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400 px-4 py-2 text-sm font-medium text-white shadow-lg transition disabled:opacity-50"
              >
                {save === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
      {icon}
      {title}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}
