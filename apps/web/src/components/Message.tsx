/** A single chat message bubble with markdown + optional reasoning disclosure. */

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ImageViewer } from "./ImageViewer.js";

export function Message({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  // Reasoning auto-expands while the model is still thinking (no answer yet).
  const thinking = streaming && !isUser && !message.content;
  const [showReasoning, setShowReasoning] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const reasoningOpen = showReasoning || (thinking && Boolean(message.reasoning));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        {message.reasoning && !isUser && (
          <div className="mb-1">
            <button
              onClick={() => setShowReasoning((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full bg-glow-600/15 px-2.5 py-1 text-[0.7rem] text-glow-400 transition hover:bg-glow-600/25"
            >
              <Sparkles className={`h-3 w-3 ${thinking ? "animate-pulse" : ""}`} />
              {thinking ? "thinking" : "reasoning"}
              <ChevronDown className={`h-3 w-3 transition ${reasoningOpen ? "rotate-180" : ""}`} />
            </button>
            {reasoningOpen && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 font-mono text-xs text-slate-400 scroll-thin"
              >
                {message.reasoning}
              </motion.pre>
            )}
          </div>
        )}

        <div
          className={
            isUser
              ? "rounded-2xl rounded-br-md bg-gradient-to-br from-glow-600 to-glow-500 px-4 py-2.5 text-white shadow-lg"
              : "glass rounded-2xl rounded-bl-md px-4 py-3"
          }
        >
          {message.images && message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setViewerSrc(src)}
                  className="block overflow-hidden rounded-lg ring-1 ring-white/15 transition hover:ring-glow-400/60"
                  title="View image"
                >
                  <img src={src} alt="attachment" className="h-24 w-24 object-cover" />
                </button>
              ))}
            </div>
          )}
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : message.segments && message.segments.length > 0 ? (
            <div className="prose-brain">
              {message.segments.map((seg, i) =>
                seg.type === "tool" ? (
                  <ToolCallCard key={`t${i}`} call={seg.call} />
                ) : seg.text ? (
                  <ReactMarkdown key={`s${i}`} remarkPlugins={[remarkGfm]}>
                    {seg.text}
                  </ReactMarkdown>
                ) : null,
              )}
              {streaming && !message.content && message.segments.every((s) => s.type === "tool") && (
                <ThinkingDots />
              )}
            </div>
          ) : (
            <div className={`prose-brain ${streaming && !message.content ? "text-slate-500" : ""}`}>
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              ) : streaming ? (
                <ThinkingDots />
              ) : null}
            </div>
          )}
        </div>
      </div>
      <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />
    </motion.div>
  );
}

/** Animated "Thinking…" indicator shown while the assistant has no answer yet. */
function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-400">
      Thinking
      <span className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full bg-glow-400"
            animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
          />
        ))}
      </span>
    </span>
  );
}
