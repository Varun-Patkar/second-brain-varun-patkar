/** Top bar: branding, session avatar, sign-out. */

import { motion } from "framer-motion";
import { Brain, LogOut, SlidersHorizontal } from "lucide-react";
import type { SessionInfo } from "@second-brain/shared";

export function TopBar({
  session,
  onSignOut,
  onOpenSettings,
}: {
  session: SessionInfo;
  onSignOut: () => void;
  /** Open the mobile settings/activity sheet. Only rendered on small screens. */
  onOpenSettings?: () => void;
}) {
  return (
    <header className="glass sticky top-0 z-20 flex items-center justify-between rounded-2xl px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <motion.div
          className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400"
          whileHover={{ scale: 1.08, rotate: 6 }}
        >
          <Brain className="h-5 w-5 text-white" />
        </motion.div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-gradient">Second Brain</div>
          <div className="text-[0.7rem] text-slate-500">single-owner knowledge base</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3">
          <img src={session.avatarUrl} alt={session.login} className="h-7 w-7 rounded-full" />
          <span className="text-sm text-slate-300">{session.login}</span>
        </div>
        {/* Mobile-only: opens the provider picker + agent activity as a bottom sheet. */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 lg:hidden"
            title="Settings & activity"
          >
            <SlidersHorizontal className="h-4.5 w-4.5" />
          </button>
        )}
        <button
          onClick={onSignOut}
          className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
          title="Sign out"
        >
          <LogOut className="h-4.5 w-4.5" />
        </button>
      </div>
    </header>
  );
}
