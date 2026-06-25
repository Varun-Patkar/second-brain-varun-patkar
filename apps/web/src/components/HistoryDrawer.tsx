/**
 * HistoryDrawer — lists stored conversations (from the brain branch) and lets the
 * owner open any past chat to review or continue it. Chat history is not used for
 * retrieval grounding; it's purely for revisiting past sessions.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, MessageSquare, Loader2, Plus, Trash2 } from "lucide-react";
import type { ChatSummary } from "@second-brain/shared";
import { deleteChat, listChats } from "../api.js";

export function HistoryDrawer({
  open,
  onClose,
  onSelect,
  onNewChat,
  onDeleted,
  currentChatId,
  refreshKey,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  /** Called after a chat is deleted (id of the removed chat). */
  onDeleted: (id: string) => void;
  currentChatId: string | null;
  /** Changes whenever a turn is persisted, prompting a re-sync of the chat list. */
  refreshKey?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listChats()
      .then((r) => setChats(r.chats))
      .finally(() => setLoading(false));
  }, [open, refreshKey]);

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      onDeleted(id);
    } catch {
      /* keep the row; a transient failure can be retried */
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex" initial={false}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="glass relative flex h-full w-80 max-w-[85vw] flex-col rounded-r-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="text-sm font-semibold text-slate-200">Chat history</span>
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3">
              <button
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400 px-3 py-2 text-sm font-medium text-white shadow-lg transition"
              >
                <Plus className="h-4 w-4" />
                New chat
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-auto scroll-thin px-3 pb-3">
              {loading ? (
                <div className="grid place-items-center py-10 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : chats.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-slate-600">No saved chats yet.</p>
              ) : (
                chats.map((c) => (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-1 rounded-xl pr-1 transition ${
                      c.id === currentChatId ? "bg-glow-600/20" : "hover:bg-white/5"
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelect(c.id);
                        onClose();
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left text-sm"
                    >
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span
                          className={`block truncate ${
                            c.id === currentChatId ? "text-slate-100" : "text-slate-300"
                          }`}
                        >
                          {c.title}
                        </span>
                        <span className="block text-[0.7rem] text-slate-600">
                          {new Date(c.updatedAt).toLocaleString()}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => void onDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100 disabled:opacity-100"
                      title="Delete chat"
                    >
                      {deletingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
