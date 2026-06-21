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
import { clearToken, completeLogin, getBrainInfo, getModels, getSession } from "./api.js";
import { DEFAULT_PROVIDER_CONFIG, configSupportsVision, type ProviderConfig } from "./types.js";
import { useChat } from "./hooks/useChat.js";
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { useProviderConnection } from "./hooks/useProviderConnection.js";
import { Login } from "./components/Login.js";
import { TopBar } from "./components/TopBar.js";
import { ProviderPicker } from "./components/ProviderPicker.js";
import { Message } from "./components/Message.js";
import { Trace } from "./components/Trace.js";
import { Composer } from "./components/Composer.js";
import { MobileSettings } from "./components/MobileSettings.js";
import { ConfigManager } from "./components/ConfigManager.js";
import { HistoryDrawer } from "./components/HistoryDrawer.js";
import { BrainViewer } from "./components/BrainViewer.js";
import { TasksPage } from "./components/TasksPage.js";

type AuthState = "loading" | "anon" | "authed";

/** A parsed view route derived from the URL hash. */
type Route = { name: "brain" } | { name: "tasks" } | { name: "chat"; id?: string };

/** Parse the URL hash into a route (the navigation source of truth). */
function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "brain") return { name: "brain" };
  if (h === "tasks") return { name: "tasks" };
  if (h.startsWith("chat/")) {
    const id = decodeURIComponent(h.slice("chat/".length));
    return id ? { name: "chat", id } : { name: "chat" };
  }
  return { name: "chat" };
}

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  // Persisted across reloads (provider, devtunnel URLs, model choices).
  const [cfg, setCfg] = useLocalStorage<ProviderConfig>("sb.providerConfig", DEFAULT_PROVIDER_CONFIG);
  const [models, setModels] = useState<string[]>([]);
  // Controls the mobile bottom-sheet (provider picker + agent activity).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Controls the MCP/skills management modal.
  const [configOpen, setConfigOpen] = useState(false);
  // Controls the chat-history drawer.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Which top-level view is shown: the chat, the brain viewer, or the tasks page.
  // Driven by the URL hash (#brain / #tasks) so each is directly reachable.
  const [view, setView] = useState<"chat" | "brain" | "tasks">(() => {
    const name = parseHash().name;
    return name === "brain" ? "brain" : name === "tasks" ? "tasks" : "chat";
  });
  // GitHub repo URL (for the external link button).
  const [repoUrl, setRepoUrl] = useState<string | undefined>(undefined);
  const chat = useChat();
  const { conn, test } = useProviderConnection(cfg, auth === "authed");
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

  // On login, honour a direct `#chat/<id>` URL (load that conversation); otherwise
  // resume an in-flight turn if the page was refreshed mid-turn.
  useEffect(() => {
    if (auth !== "authed") return;
    const route = parseHash();
    if (route.name === "chat" && route.id) {
      void chat.openChat(route.id);
    } else {
      void chat.resumeActive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  // Load repo info for the GitHub link + brain viewer.
  useEffect(() => {
    if (auth === "authed") void getBrainInfo().then((i) => i && setRepoUrl(i.repoUrl));
  }, [auth]);

  // Keep the view in sync with the URL hash (browser back/forward, direct links).
  // The hash is the navigation source of truth: `#brain` shows the viewer, and
  // `#chat/<id>` loads that conversation when it differs from the active one.
  useEffect(() => {
    const onHash = (): void => {
      const route = parseHash();
      setView(route.name === "brain" ? "brain" : route.name === "tasks" ? "tasks" : "chat");
      if (route.name === "chat" && route.id && route.id !== chat.chatId) {
        void chat.openChat(route.id);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.chatId, chat.openChat]);

  // When a fresh chat id is assigned (first message of a new conversation), reflect
  // it in the URL so the conversation is bookmarkable / shareable. Only while the
  // chat view is active, to avoid clobbering `#brain`.
  useEffect(() => {
    if (view !== "chat") return;
    const route = parseHash();
    if (chat.chatId) {
      if (route.name !== "chat" || route.id !== chat.chatId) {
        window.location.hash = `#chat/${encodeURIComponent(chat.chatId)}`;
      }
    } else if (route.name === "chat" && route.id) {
      // New/empty chat: drop the id from the URL.
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [chat.chatId, view]);

  const openBrain = (): void => {
    window.location.hash = "#brain";
    setView("brain");
  };
  const openTasks = (): void => {
    window.location.hash = "#tasks";
    setView("tasks");
  };
  const backToChat = (): void => {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setView("chat");
  };

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

  if (view === "brain") return <BrainViewer onBack={backToChat} />;
  if (view === "tasks") return <TasksPage onBack={backToChat} />;

  return (
    <div className="mx-auto flex h-full w-[90vw] flex-col gap-3 p-3 md:p-4">
      <TopBar
        session={session}
        onSignOut={signOut}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onNewChat={chat.newChat}
        onOpenBrain={openBrain}
        onOpenTasks={openTasks}
        {...(repoUrl ? { repoUrl } : {})}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
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
            {chat.resuming && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-xl border border-glow-500/30 bg-glow-500/10 px-3 py-2 text-sm text-glow-300"
              >
                <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-glow-400/40 border-t-glow-300" />
                Resuming your turn — it's still running on the server…
              </motion.div>
            )}
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
            connected={conn.status === "ok"}
            sttUrl={cfg.sttUrl}
            visionEnabled={configSupportsVision(cfg)}
            onSend={(text, images) => chat.send(text, cfg, images)}
            onStop={chat.stop}
            onError={chat.setError}
          />
        </div>

        {/* Sidebar (desktop only). */}
        <aside className="hidden min-h-0 flex-col gap-3 lg:flex">
          <ProviderPicker
            cfg={cfg}
            onChange={setCfg}
            models={models}
            conn={conn}
            onTest={test}
            onManageConfig={() => setConfigOpen(true)}
          />
          <div className="min-h-0 flex-1">
            <Trace trace={chat.trace} metrics={chat.metrics} />
          </div>
        </aside>
      </div>

      {/* Mobile-only bottom sheet mirroring the desktop sidebar. */}
      <MobileSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        cfg={cfg}
        onChange={setCfg}
        models={models}
        conn={conn}
        onTest={test}
        onManageConfig={() => {
          setSettingsOpen(false);
          setConfigOpen(true);
        }}
        onOpenBrain={() => {
          setSettingsOpen(false);
          openBrain();
        }}
        onOpenTasks={() => {
          setSettingsOpen(false);
          openTasks();
        }}
        {...(repoUrl ? { repoUrl } : {})}
        trace={chat.trace}
        metrics={chat.metrics}
      />

      {/* MCP + skills management modal. */}
      <ConfigManager open={configOpen} onClose={() => setConfigOpen(false)} />

      {/* Chat history drawer. */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => void chat.openChat(id)}
        onNewChat={chat.newChat}
        onDeleted={(id) => {
          if (id === chat.chatId) chat.newChat();
        }}
        currentChatId={chat.chatId}
      />
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
