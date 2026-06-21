/** Top bar: branding, session avatar, sign-out. */

import { motion } from "framer-motion";
import { Brain, LogOut, SlidersHorizontal, History, SquarePen, Github, FolderTree } from "lucide-react";
import type { SessionInfo } from "@second-brain/shared";

export function TopBar({
  session,
  onSignOut,
  onOpenSettings,
  onOpenHistory,
  onNewChat,
  onOpenBrain,
  repoUrl,
}: {
  session: SessionInfo;
  onSignOut: () => void;
  /** Open the mobile settings/activity sheet. Only rendered on small screens. */
  onOpenSettings?: () => void;
  /** Open the chat-history drawer. */
  onOpenHistory?: () => void;
  /** Start a new, empty conversation. */
  onNewChat?: () => void;
  /** Open the in-app brain viewer. */
  onOpenBrain?: () => void;
  /** GitHub repo URL (for the external link button). */
  repoUrl?: string;
}) {
  return (
    <header className="glass sticky top-0 z-20 flex items-center justify-between gap-2 rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <motion.div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400"
          whileHover={{ scale: 1.08, rotate: 6 }}
        >
          <Brain className="h-5 w-5 text-white" />
        </motion.div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-gradient">Second Brain</div>
          <div className="hidden truncate text-[0.7rem] text-slate-500 sm:block">
            single-owner knowledge base
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9"
            title="Chat history"
          >
            <History className="h-4.5 w-4.5" />
          </button>
        )}
        {onNewChat && (
          <button
            onClick={onNewChat}
            className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9"
            title="New chat"
          >
            <SquarePen className="h-4.5 w-4.5" />
          </button>
        )}
        {/* Brain viewer + GitHub: desktop only; on mobile they live in the settings sheet. */}
        {onOpenBrain && (
          <button
            onClick={onOpenBrain}
            className="hidden h-9 w-9 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 lg:grid"
            title="Brain viewer"
          >
            <FolderTree className="h-4.5 w-4.5" />
          </button>
        )}
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 w-9 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 lg:grid"
            title="Open the GitHub repo"
          >
            <Github className="h-4.5 w-4.5" />
          </a>
        )}
        <div className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-1 sm:pr-3">
          <img src={session.avatarUrl} alt={session.login} className="h-7 w-7 rounded-full" />
          <span className="hidden text-sm text-slate-300 sm:inline">{session.login}</span>
        </div>
        {/* Mobile-only: opens the provider picker + agent activity as a bottom sheet. */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9 lg:hidden"
            title="Settings & activity"
          >
            <SlidersHorizontal className="h-4.5 w-4.5" />
          </button>
        )}
        <button
          onClick={onSignOut}
          className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300 sm:h-9 sm:w-9"
          title="Sign out"
        >
          <LogOut className="h-4.5 w-4.5" />
        </button>
      </div>
    </header>
  );
}
