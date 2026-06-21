/**
 * MobileSettings — a bottom-up sheet (modal overlay) that surfaces the provider
 * picker and agent-activity trace on small screens, where the desktop sidebar is
 * hidden. Slides up from the bottom with a rounded "tongue" top edge and can be
 * dismissed by the backdrop, the close button, or a downward drag.
 *
 * @packageDocumentation
 */

import { AnimatePresence, motion } from "framer-motion";
import { X, FolderTree, Github, ListTodo } from "lucide-react";
import type { TraceEvent, TurnMetrics } from "@second-brain/shared";
import type { ProviderConfig } from "../types.js";
import type { Connection } from "../hooks/useProviderConnection.js";
import { ProviderPicker } from "./ProviderPicker.js";
import { Trace } from "./Trace.js";

/**
 * Props for the mobile settings sheet.
 *
 * @param open - Whether the sheet is visible.
 * @param onClose - Called when the user dismisses the sheet.
 * @param cfg - Current provider configuration.
 * @param onChange - Provider configuration setter.
 * @param models - Dynamic Copilot model ids (optional).
 * @param conn - Provider connection state.
 * @param onTest - Run a connection test.
 * @param onManageConfig - Open the MCP/skills manager.
 * @param trace - Live agent-activity events for the current turn.
 * @param metrics - Per-turn subrequest metrics (or null before the first turn).
 */
export function MobileSettings({
  open,
  onClose,
  cfg,
  onChange,
  models,
  conn,
  onTest,
  onManageConfig,
  onOpenBrain,
  onOpenTasks,
  repoUrl,
  trace,
  metrics,
}: {
  open: boolean;
  onClose: () => void;
  cfg: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
  models?: string[];
  conn?: Connection;
  onTest?: () => void;
  onManageConfig?: () => void;
  /** Open the in-app brain viewer (mobile-only entry point). */
  onOpenBrain?: () => void;
  /** Open the tasks page (mobile-only entry point). */
  onOpenTasks?: () => void;
  /** GitHub repo URL (mobile-only link). */
  repoUrl?: string;
  trace: TraceEvent[];
  metrics: TurnMetrics | null;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden"
          initial={false}
        >
          {/* Backdrop — tap to dismiss. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Bottom sheet — slides up, rounded top "tongue", draggable to dismiss. */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) onClose();
            }}
            className="glass relative flex max-h-[85vh] flex-col rounded-t-3xl border-b-0 px-3 pb-4 pt-2"
          >
            {/* Grab handle. */}
            <div className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-white/20" />

            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-slate-300">Settings &amp; activity</span>
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto scroll-thin px-0.5">
              {/* Brain viewer + Tasks + GitHub (desktop has these in the top bar). */}
              {(onOpenBrain || onOpenTasks || repoUrl) && (
                <div className="grid grid-cols-2 gap-2">
                  {onOpenTasks && (
                    <button
                      onClick={onOpenTasks}
                      className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                    >
                      <ListTodo className="h-4 w-4" />
                      Tasks
                    </button>
                  )}
                  {onOpenBrain && (
                    <button
                      onClick={onOpenBrain}
                      className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                    >
                      <FolderTree className="h-4 w-4" />
                      Brain viewer
                    </button>
                  )}
                  {repoUrl && (
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                    >
                      <Github className="h-4 w-4" />
                      GitHub
                    </a>
                  )}
                </div>
              )}
              <ProviderPicker
                cfg={cfg}
                onChange={onChange}
                {...(models ? { models } : {})}
                {...(conn ? { conn } : {})}
                {...(onTest ? { onTest } : {})}
                {...(onManageConfig ? { onManageConfig } : {})}
              />
              <div className="h-[44vh] min-h-[16rem]">
                <Trace trace={trace} metrics={metrics} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
