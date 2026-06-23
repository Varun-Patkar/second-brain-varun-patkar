/** Animated login screen — single owner, GitHub OAuth. */

import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Github, Loader2, FolderTree, ListTodo } from "lucide-react";
import { getLoginUrl } from "../api.js";

export function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      window.location.href = await getLoginUrl();
    } catch {
      setError("Could not reach the backend. Check VITE_WORKER_URL.");
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="glass relative w-full max-w-md overflow-hidden rounded-3xl p-8 text-center shadow-2xl"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-glow-500/30 blur-3xl" />
        <motion.div
          className="relative mx-auto mb-6 grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-glow-500 to-aqua-400 shadow-lg"
          animate={{ rotate: [0, 4, -4, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Brain className="h-10 w-10 text-white" />
          <span className="absolute inset-0 rounded-2xl ring-2 ring-glow-400/40 animate-pulse-ring" />
        </motion.div>

        <h1 className="mb-2 text-3xl font-bold tracking-tight">
          <span className="text-gradient">Second Brain</span>
        </h1>
        <p className="mb-8 text-sm text-slate-400">
          Varun Patkar's ever-evolving knowledge base. Only Varun can sign in —
          but anyone can explore the brain and tasks, read-only.
        </p>

        <button
          onClick={onLogin}
          disabled={loading}
          className="group inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white/90 px-5 py-3 font-semibold text-ink-950 transition hover:bg-white disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Github className="h-5 w-5" />}
          {loading ? "Redirecting…" : "Continue with GitHub"}
        </button>

        {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

        {/* Public, read-only entry points: no sign-in required. */}
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">Explore without signing in</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                window.location.hash = "#brain";
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <FolderTree className="h-4 w-4" />
              Brain
            </button>
            <button
              onClick={() => {
                window.location.hash = "#tasks";
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <ListTodo className="h-4 w-4" />
              Tasks
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
