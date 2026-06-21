/**
 * ConfigPage — a full-page hub for the brain's configuration, reachable at the
 * `#config` route (like the brain viewer and tasks page). Replaces the cramped
 * modal with three stacked sections: MCP servers, Skills, and Secrets.
 *
 * MCP servers + skills are edited here and persisted together as a single commit
 * via the footer "Save changes" button (the same path the agent's `write_config`
 * tool uses). Secrets manage themselves per-action (write-only; see SecretsSection).
 *
 * @packageDocumentation
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Brain, Plus, Trash2, Loader2, Server, BookOpen, Save } from "lucide-react";
import type { BrainSkill, McpServerConfig } from "@second-brain/shared";
import { getConfig, saveConfig } from "../api.js";
import { SecretsSection } from "./SecretsSection.js";

type SaveState = "idle" | "saving" | "saved" | "error";

export function ConfigPage({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [skills, setSkills] = useState<BrainSkill[]>([]);
  const [originalSkillNames, setOriginalSkillNames] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Load the current MCP servers + skills on mount.
  useEffect(() => {
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
  }, []);

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
    <div className="mx-auto flex h-full w-[90vw] flex-col gap-3 p-3 md:p-4">
      {/* Header */}
      <header className="glass flex items-center justify-between rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gradient">Manage config</div>
            <div className="text-[0.7rem] text-slate-500">MCP servers · skills · secrets</div>
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

      {/* Body: three stacked sections. */}
      <section className="glass min-h-0 flex-1 overflow-auto scroll-thin rounded-2xl p-4">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* MCP servers + skills (loaded together). */}
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
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={s.id}
                          onChange={(e) => patchServer(i, { id: e.target.value })}
                          placeholder="id (e.g. docs)"
                          className="input w-full sm:w-32 sm:flex-none"
                        />
                        <div className="flex w-full items-center gap-2 sm:flex-1">
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
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={s.name}
                          onChange={(e) => patchSkill(i, { name: e.target.value })}
                          placeholder="name"
                          className="input w-full sm:w-40 sm:flex-none"
                        />
                        <div className="flex w-full items-center gap-2 sm:flex-1">
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
                    onClick={() => setSkills((p) => [...p, { name: "", description: "", content: "" }])}
                  />
                </div>
              </section>
            </>
          )}

          {/* Secrets (self-managed; independent of the MCP/skills load). */}
          <div className="border-t border-white/5 pt-6">
            <SecretsSection />
          </div>
        </div>
      </section>

      {/* Footer — saves MCP servers + skills as one commit. */}
      <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="min-w-0 text-xs">
          {error && <span className="text-amber-400">{error}</span>}
          {save === "saved" && !error && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-emerald-400">
              Saved.
            </motion.span>
          )}
          {!error && save !== "saved" && (
            <span className="text-slate-500">MCP servers + skills save together; secrets save instantly.</span>
          )}
        </div>
        <button
          onClick={onSave}
          disabled={loading || save === "saving"}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400 px-4 py-2 text-sm font-medium text-white shadow-lg transition disabled:opacity-50"
        >
          {save === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </div>
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
