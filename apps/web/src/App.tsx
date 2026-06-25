/**
 * App shell: handles the OAuth callback, session bootstrap, and the main layout
 * (chat stream + provider/trace sidebar).
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Brain, Info } from "lucide-react";
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
import { HistoryDrawer } from "./components/HistoryDrawer.js";

// Full-page views are code-split: the brain viewer pulls in the heavy graph
// library, so it (and the other secondary pages) load on demand rather than
// bloating the initial chat bundle.
const BrainViewer = lazy(() =>
  import("./components/BrainViewer.js").then((m) => ({ default: m.BrainViewer })),
);
const TasksPage = lazy(() => import("./components/TasksPage.js").then((m) => ({ default: m.TasksPage })));
const ConfigPage = lazy(() =>
  import("./components/ConfigPage.js").then((m) => ({ default: m.ConfigPage })),
);

type AuthState = "loading" | "anon" | "authed";

/** A parsed view route derived from the URL hash. */
type Route = { name: "brain" } | { name: "tasks" } | { name: "config" } | { name: "chat"; id?: string };

/** Parse the URL hash into a route (the navigation source of truth). */
function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "brain") return { name: "brain" };
  if (h === "tasks") return { name: "tasks" };
  if (h === "config") return { name: "config" };
  if (h.startsWith("chat/")) {
    const id = decodeURIComponent(h.slice("chat/".length));
    return id ? { name: "chat", id } : { name: "chat" };
  }
  return { name: "chat" };
}

/**
 * Rough client-side token estimate (~4 chars/token) for the context meter, used as
 * a fallback when the backend hasn't reported real usage yet (e.g. before the first
 * turn, on a freshly loaded chat, or if the provider omits usage). Adds a baseline
 * for the system prompt + tool schemas the worker always sends.
 */
function estimateClientTokens(messages: Array<{ content: string }>): number {
  if (messages.length === 0) return 0;
  let chars = 0;
  for (const m of messages) chars += m.content?.length ?? 0;
  return Math.ceil(chars / 4) + 1500;
}

/** Approximate context window for the selected model (mirrors the worker's caps). */
function clientTokenLimit(cfg: ProviderConfig): number {
  if (cfg.provider === "lmstudio") return 262144;
  const m = cfg.copilotModel || "";
  if (m.startsWith("claude")) return 200000;
  if (m.startsWith("gpt-5")) return 272000;
  if (m.startsWith("gemini")) return 1048576;
  return 128000;
}

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  // Persisted across reloads (provider, devtunnel URLs, model choices).
  const [cfg, setCfg] = useLocalStorage<ProviderConfig>("sb.providerConfig", DEFAULT_PROVIDER_CONFIG);
  const [models, setModels] = useState<string[]>([]);
  // Controls the mobile bottom-sheet (provider picker + agent activity).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Controls the chat-history drawer.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Transient toast message (e.g. "that conversation no longer exists").
  const [toast, setToast] = useState<string | null>(null);
  // Which top-level view is shown: chat, brain viewer, tasks, or config page.
  // Driven by the URL hash (#brain / #tasks / #config) so each is directly reachable.
  const [view, setView] = useState<"chat" | "brain" | "tasks" | "config">(() => {
    const name = parseHash().name;
    return name === "brain" ? "brain" : name === "tasks" ? "tasks" : name === "config" ? "config" : "chat";
  });
  // GitHub repo URL (for the external link button).
  const [repoUrl, setRepoUrl] = useState<string | undefined>(undefined);
  // A composer draft seeded by "Declare via agent" — bumping the nonce re-applies
  // the text into the composer even if it matches the previous draft.
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(null);
  const chat = useChat();
  const { conn, test } = useProviderConnection(cfg, auth === "authed");
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  // Show a transient toast that auto-dismisses.
  const showToast = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };

  // Start a new conversation: clear the chat id from the URL, then reset state.
  const newChat = (): void => {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    chat.newChat();
  };

  // Open a stored chat by id; if it no longer exists (e.g. deleted), toast and
  // fall back to a fresh conversation.
  const openChatOrToast = async (id: string): Promise<void> => {
    const found = await chat.openChat(id);
    if (!found) {
      showToast("That conversation no longer exists.");
      newChat();
    }
  };

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
      void openChatOrToast(route.id);
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
      setView(
        route.name === "brain"
          ? "brain"
          : route.name === "tasks"
            ? "tasks"
            : route.name === "config"
              ? "config"
              : "chat",
      );
      if (route.name === "chat" && route.id && route.id !== chat.chatId) {
        void openChatOrToast(route.id);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.chatId, chat.openChat]);

  // When a fresh chat id is assigned (first message of a new conversation), reflect
  // it in the URL so the conversation is bookmarkable / shareable. Only while the
  // chat view is active, to avoid clobbering `#brain`. Never clears the hash here —
  // that is done explicitly in `newChat` — so a direct `#chat/<id>` load is not
  // wiped before the async `openChat` sets `chatId`.
  useEffect(() => {
    if (view !== "chat" || !chat.chatId) return;
    const route = parseHash();
    if (route.name !== "chat" || route.id !== chat.chatId) {
      window.location.hash = `#chat/${encodeURIComponent(chat.chatId)}`;
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
  const openConfig = (): void => {
    window.location.hash = "#config";
    setView("config");
  };
  const backToChat = (): void => {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setView("chat");
  };

  // "Declare via agent": start a fresh conversation, drop the user into the chat
  // view, and pre-fill the composer with a prompt describing the MCP server/skill
  // they want the agent to add (they finish the details, then send).
  const declareViaAgent = (prompt: string): void => {
    newChat();
    setDraft({ text: prompt, nonce: Date.now() });
    backToChat();
  };

  const signOut = () => {
    clearToken();
    setSession(null);
    setAuth("anon");
  };

  // Context-window meter values: prefer real backend metrics, else a client
  // estimate so the meter is always visible (even before the first turn).
  const tokenLimit = chat.metrics?.tokenLimit ?? clientTokenLimit(cfg);
  const tokensUsed = chat.metrics?.tokensUsed ?? estimateClientTokens(chat.messages);

  if (auth === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-glow-500/30 border-t-glow-400" />
      </div>
    );
  }

  if (auth === "anon" || !session) {
    // Anonymous visitors get read-only access to the public knowledge views
    // (brain viewer + tasks + config) so anyone can explore the brain without
    // signing in. Everything agentic — chat, providers, history, secrets, and any
    // writes — stays behind the owner-only GitHub login.
    if (view === "brain" || view === "tasks" || view === "config") {
      return (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-glow-500/30 border-t-glow-400" />
            </div>
          }
        >
          {view === "brain" && <BrainViewer onBack={backToChat} readOnly />}
          {view === "tasks" && <TasksPage onBack={backToChat} readOnly />}
          {view === "config" && <ConfigPage onBack={() => (window.location.href = window.location.pathname)} readOnly />}
        </Suspense>
      );
    }
    return <Login />;
  }

  if (view === "brain" || view === "tasks" || view === "config") {
    return (
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-glow-500/30 border-t-glow-400" />
          </div>
        }
      >
        {view === "brain" && <BrainViewer onBack={backToChat} />}
        {view === "tasks" && <TasksPage onBack={backToChat} />}
        {view === "config" && <ConfigPage onBack={backToChat} onDeclareViaAgent={declareViaAgent} />}
      </Suspense>
    );
  }

  return (
    <div className="mx-auto flex h-full w-[90vw] flex-col gap-3 p-3 md:p-4">
      <TopBar
        session={session}
        onSignOut={signOut}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onNewChat={newChat}
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
            {...(draft ? { draft } : {})}
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
            onManageConfig={openConfig}
          />
          <div className="min-h-0 flex-1">
            <Trace trace={chat.trace} metrics={chat.metrics} tokensUsed={tokensUsed} tokenLimit={tokenLimit} />
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
          openConfig();
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
        tokensUsed={tokensUsed}
        tokenLimit={tokenLimit}
      />

      {/* MCP + skills management is now a full page (#config), not a modal. */}

      {/* Transient toast (e.g. when a conversation no longer exists). */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="glass fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 shadow-xl"
          >
            <Info className="h-4 w-4 shrink-0 text-aqua-400" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat history drawer. */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => void openChatOrToast(id)}
        onNewChat={newChat}
        onDeleted={(id) => {
          if (id === chat.chatId) newChat();
        }}
        currentChatId={chat.chatId}
        refreshKey={chat.chatsVersion}
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
