/**
 * App shell: handles the OAuth callback, session bootstrap, and the main layout
 * (chat stream + provider/trace sidebar).
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Brain } from "lucide-react";
import type { SessionInfo } from "@second-brain/shared";
import { clearToken, completeLogin, getModels, getSession } from "./api.js";
import { DEFAULT_PROVIDER_CONFIG, type ProviderConfig } from "./types.js";
import { useChat } from "./hooks/useChat.js";
import { Login } from "./components/Login.js";
import { TopBar } from "./components/TopBar.js";
import { ProviderPicker } from "./components/ProviderPicker.js";
import { Message } from "./components/Message.js";
import { Trace } from "./components/Trace.js";
import { Composer } from "./components/Composer.js";

type AuthState = "loading" | "anon" | "authed";

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cfg, setCfg] = useState<ProviderConfig>(DEFAULT_PROVIDER_CONFIG);
  const [models, setModels] = useState<string[]>([]);
  const chat = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Bootstrap: complete OAuth callback if present, else restore session.
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      if (code && state) {
        try {
          const info = await completeLogin(code, state);
          setSession(info);
          setAuth("authed");
        } catch {
          setAuth("anon");
        } finally {
          window.history.replaceState({}, "", window.location.pathname);
        }
        return;
      }
      const existing = await getSession();
      if (existing) {
        setSession(existing);
        setAuth("authed");
      } else {
        setAuth("anon");
      }
    })();
  }, []);

  // Auto-scroll to newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.streaming]);

  // Once authenticated, load the dynamic Copilot model list.
  useEffect(() => {
    if (auth === "authed") void getModels().then((r) => setModels(r.models.map((m) => m.id)));
  }, [auth]);

  const signOut = () => {
    clearToken();
    setSession(null);
    setAuth("anon");
  };

  if (auth === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-glow-500/30 border-t-glow-400" />
      </div>
    );
  }

  if (auth === "anon" || !session) return <Login />;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-3 p-3 md:p-4">
      <TopBar session={session} onSignOut={signOut} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        {/* Chat column */}
        <div className="flex min-h-0 flex-col gap-3">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto scroll-thin px-1 py-2">
            {chat.messages.length === 0 && <EmptyState />}
            {chat.messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                streaming={chat.streaming && i === chat.messages.length - 1}
              />
            ))}
          </div>

          <AnimatePresence>
            {chat.error && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {chat.error}
              </motion.div>
            )}
          </AnimatePresence>

          <Composer
            disabled={chat.streaming}
            streaming={chat.streaming}
            onSend={(text) => chat.send(text, cfg)}
            onStop={chat.stop}
          />
        </div>

        {/* Sidebar */}
        <aside className="hidden min-h-0 flex-col gap-3 lg:flex">
          <ProviderPicker cfg={cfg} onChange={setCfg} models={models} />
          <div className="min-h-0 flex-1">
            <Trace trace={chat.trace} metrics={chat.metrics} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="grid h-full place-items-center text-center"
    >
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid h-16 w-16 animate-float place-items-center rounded-2xl bg-gradient-to-br from-glow-500 to-aqua-400 shadow-lg shadow-glow-600/30">
          <Brain className="h-8 w-8 text-white" />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-slate-200">Your brain is listening</h2>
        <p className="text-sm text-slate-500">
          Ask a question to retrieve knowledge, or tell it something new to remember. Every turn is
          grounded in your wiki and tidied automatically.
        </p>
      </div>
    </motion.div>
  );
}
