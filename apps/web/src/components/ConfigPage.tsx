/**
 * ConfigPage — a full-page hub for the brain's configuration, reachable at the
 * `#config` route (like the brain viewer and tasks page). Stacks three sections:
 * MCP servers, Skills, and Secrets.
 *
 * MCP servers + skills are edited here and persisted together as a single commit
 * via the footer "Save changes" button (the same path the agent's `write_config`
 * tool uses). Secrets manage themselves per-action (write-only). The page can be
 * rendered read-only for anonymous visitors: editing is disabled and secrets are
 * hidden entirely.
 *
 * @packageDocumentation
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Brain, Loader2, Save } from "lucide-react";
import type { BrainSkill, McpServerConfig } from "@second-brain/shared";
import { getConfig, getSecretNames, putSecret, saveConfig } from "../api.js";
import { SecretsSection } from "./SecretsSection.js";
import { McpSection } from "./config/McpSection.js";
import { SkillsSection } from "./config/SkillsSection.js";

type SaveState = "idle" | "saving" | "saved" | "error";

export function ConfigPage({
  onBack,
  readOnly = false,
  onDeclareViaAgent,
}: {
  onBack: () => void;
  /** When true, all editing is disabled and secrets are hidden (anon visitors). */
  readOnly?: boolean;
  /** Seed a fresh chat with a prompt asking the agent to add an MCP server/skill. */
  onDeclareViaAgent?: (prompt: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [skills, setSkills] = useState<BrainSkill[]>([]);
  const [originalSkillNames, setOriginalSkillNames] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Secret names are owned here so the MCP header picker and the secrets section
  // share one source of truth. Only fetched for the signed-in owner.
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(!readOnly);

  const reloadSecrets = useCallback((): void => {
    if (readOnly) return;
    setSecretsLoading(true);
    getSecretNames()
      .then(setSecretNames)
      .catch(() => setSecretNames([]))
      .finally(() => setSecretsLoading(false));
  }, [readOnly]);

  // Persist a new secret (used by the MCP header picker + JSON import), then refresh.
  const onCreateSecret = useCallback(async (name: string, value: string): Promise<void> => {
    await putSecret(name, value);
    setSecretNames((prev) => (prev.includes(name) ? prev : [...prev, name].sort((a, b) => a.localeCompare(b))));
  }, []);

  // Load the current MCP servers + skills (and secrets, when owner) on mount.
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
    reloadSecrets();
  }, [reloadSecrets]);

  const onSave = async (): Promise<void> => {
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
            <div className="text-sm font-semibold text-gradient">
              {readOnly ? "Brain config" : "Manage config"}
            </div>
            <div className="text-[0.7rem] text-slate-500">
              MCP servers · skills{readOnly ? "" : " · secrets"}
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

      {/* Body: three stacked sections. */}
      <section className="glass min-h-0 flex-1 overflow-auto scroll-thin rounded-2xl p-4">
        <div className="mx-auto max-w-3xl space-y-8">
          {loading ? (
            <div className="grid place-items-center py-10 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <McpSection
                servers={servers}
                readOnly={readOnly}
                secretNames={secretNames}
                onChange={setServers}
                onCreateSecret={onCreateSecret}
                onDeclareViaAgent={onDeclareViaAgent ?? (() => {})}
              />
              <SkillsSection
                skills={skills}
                readOnly={readOnly}
                onChange={setSkills}
                onDeclareViaAgent={onDeclareViaAgent ?? (() => {})}
              />
            </>
          )}

          {/* Secrets (self-managed; independent of the MCP/skills load). */}
          <div className="border-t border-white/5 pt-6">
            <SecretsSection
              names={secretNames}
              loading={secretsLoading}
              readOnly={readOnly}
              onReload={reloadSecrets}
            />
          </div>
        </div>
      </section>

      {/* Footer — saves MCP servers + skills as one commit (owner only). */}
      {!readOnly && (
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
            onClick={() => void onSave()}
            disabled={loading || save === "saving"}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400 px-4 py-2 text-sm font-medium text-white shadow-lg transition disabled:opacity-50"
          >
            {save === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}
