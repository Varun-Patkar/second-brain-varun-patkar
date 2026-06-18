/** Provider + model picker (GitHub Copilot / LM Studio). */

import { AnimatePresence, motion } from "framer-motion";
import { Cpu, Server } from "lucide-react";
import type { ProviderConfig } from "../types.js";

/** Static fallback list, used only if the dynamic /models fetch returns nothing. */
const FALLBACK_COPILOT_MODELS = [
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  "claude-opus-4.8",
  "claude-opus-4.7",
  "claude-opus-4.6",
  "claude-opus-4.5",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.4-mini",
  "gpt-5-mini",
  "gemini-3.1-pro-preview",
  "gemini-3.5-flash",
  "mai-code-1-flash-internal",
];

export function ProviderPicker({
  cfg,
  onChange,
  models,
}: {
  cfg: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
  models?: string[];
}) {
  const set = (patch: Partial<ProviderConfig>) => onChange({ ...cfg, ...patch });
  const modelOptions = models && models.length > 0 ? models : FALLBACK_COPILOT_MODELS;

  return (
    <div className="glass rounded-2xl p-3">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <TabButton
          active={cfg.provider === "copilot"}
          onClick={() => set({ provider: "copilot" })}
          icon={<Cpu className="h-4 w-4" />}
          label="GitHub Copilot"
        />
        <TabButton
          active={cfg.provider === "lmstudio"}
          onClick={() => set({ provider: "lmstudio" })}
          icon={<Server className="h-4 w-4" />}
          label="LM Studio"
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {cfg.provider === "copilot" ? (
          <motion.div
            key="copilot"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.2 }}
          >
            <Field label="Model">
              <select
                value={cfg.copilotModel}
                onChange={(e) => set({ copilotModel: e.target.value })}
                className="input"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </motion.div>
        ) : (
          <motion.div
            key="lmstudio"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            <Field label="Devtunnel URL">
              <input
                value={cfg.lmStudioUrl}
                onChange={(e) => set({ lmStudioUrl: e.target.value })}
                placeholder="https://xxxx.devtunnels.ms/v1"
                className="input"
              />
            </Field>
            <Field label="Model">
              <input
                value={cfg.lmStudioModel}
                onChange={(e) => set({ lmStudioModel: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Key (optional)">
              <input
                type="password"
                value={cfg.lmStudioKey}
                onChange={(e) => set({ lmStudioKey: e.target.value })}
                placeholder="••••••"
                className="input"
              />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active ? "text-white" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {active && (
        <motion.span
          layoutId="provider-tab"
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-glow-600/60 to-aqua-400/30 ring-1 ring-glow-400/40"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-2">
        {icon}
        {label}
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.7rem] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
