/** Message composer with send / stop, voice input (STT), and image attachments. */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Square, Mic, ImagePlus, X, Loader2, Sparkles } from "lucide-react";
import type { ChatImage } from "@second-brain/shared";
import { fileToChatImage } from "../api.js";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder.js";
import { filterQuickPrompts, type QuickPrompt } from "../quickPrompts.js";

/** A locally-staged image attachment (preview + wire payload). */
interface Attachment {
  id: string;
  previewUrl: string;
  image: ChatImage;
}

let attachId = 0;

export function Composer({
  disabled,
  streaming,
  connected,
  sttUrl,
  visionEnabled,
  draft,
  onSend,
  onStop,
  onError,
}: {
  disabled: boolean;
  streaming: boolean;
  /** Whether the provider connection test passed; gates sending. */
  connected: boolean;
  /** STT server base URL; empty hides the mic button. */
  sttUrl: string;
  /** Whether the selected model accepts images; gates the attach button. */
  visionEnabled: boolean;
  /**
   * An externally-seeded composer draft (e.g. "Declare via agent"). Each new
   * `nonce` re-applies `text` into the input, even if the text is unchanged.
   */
  draft?: { text: string; nonce: number };
  onSend: (text: string, images: ChatImage[]) => void;
  onStop: () => void;
  /** Surface composer-level errors (mic/transcription/attachment) to the UI. */
  onError?: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Apply an externally-seeded draft (keyed by nonce) into the composer + focus.
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(draft.text.length, draft.text.length);
      }
    });
  }, [draft?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow the textarea to fit its content (capped by the CSS max-height, which
  // then takes over with an internal scrollbar). Runs on every text change,
  // including programmatic ones (drafts, quick-prompt inserts, STT, clear-on-send).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  // Quick-prompt popover: opened by the button, or implicitly while the input
  // starts with "/" (which also filters the list by what follows the slash).
  const [showPrompts, setShowPrompts] = useState(false);
  const slashQuery = text.startsWith("/") ? text.slice(1) : "";
  const promptsOpen = showPrompts || text.startsWith("/");
  const filteredPrompts = promptsOpen ? filterQuickPrompts(slashQuery) : [];

  /** Insert a template's text into the composer and focus it (never sends). */
  const insertPrompt = (p: QuickPrompt): void => {
    setText(p.text);
    setShowPrompts(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(p.text.length, p.text.length);
      }
    });
  };

  const voice = useVoiceRecorder(
    sttUrl,
    (t) => setText((prev) => (prev ? `${prev} ${t}` : t)),
    onError,
  );

  /** Convert and stage image files (from upload, paste, or drop). */
  const addFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of imgs) {
      try {
        const image = await fileToChatImage(f);
        setAttachments((prev) => [
          ...prev,
          { id: `att${attachId++}`, previewUrl: URL.createObjectURL(f), image },
        ]);
      } catch {
        onError?.("Could not read image.");
      }
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.id !== id);
    });

  const submit = () => {
    if (!connected) {
      onError?.("Test your provider connection (in settings) before chatting.");
      return;
    }
    if (!text.trim() && attachments.length === 0) return;
    onSend(
      text,
      attachments.map((a) => a.image),
    );
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setText("");
  };

  return (
    <div className="glass relative rounded-2xl p-2">
      {/* Quick-prompt popover (above the input). Selecting a prompt inserts its
          text into the composer — it never sends automatically. */}
      <AnimatePresence>
        {promptsOpen && filteredPrompts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-64 overflow-auto scroll-thin rounded-xl border border-white/10 bg-ink-950/95 p-1 shadow-xl backdrop-blur-xl"
          >
            {filteredPrompts.map((p) => (
              <button
                key={p.id}
                onClick={() => insertPrompt(p)}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-white/5"
              >
                <span className="text-sm font-medium text-slate-200">{p.label}</span>
                <span className="w-full truncate text-xs text-slate-500">{p.text}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image attachment previews. */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2 px-1 pb-2 pt-1"
          >
            {attachments.map((a) => (
              <div
                key={a.id}
                className="relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-white/10"
              >
                <img src={a.previewUrl} alt="attachment" className="h-full w-full object-cover" />
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-slate-200 transition hover:bg-rose-500/70"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        {/* Quick prompts: insert a starter template (saves typing on mobile). */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowPrompts((v) => !v)}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
            promptsOpen
              ? "bg-glow-500/20 text-glow-300"
              : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
          }`}
          title="Quick prompts (or type /)"
        >
          <Sparkles className="h-5 w-5" />
        </motion.button>

        {/* Image attach (only for vision-capable models). */}
        {visionEnabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => fileInputRef.current?.click()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
              title="Attach image"
            >
              <ImagePlus className="h-5 w-5" />
            </motion.button>
          </>
        )}

        {/* Voice input (only when an STT URL is configured). */}
        {sttUrl && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => (voice.state === "recording" ? voice.stop() : void voice.start())}
            disabled={voice.state === "transcribing"}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
              voice.state === "recording"
                ? "bg-rose-500/30 text-rose-300"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
            } disabled:opacity-50`}
            title={voice.state === "recording" ? "Stop & transcribe" : "Speak"}
          >
            {voice.state === "transcribing" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : voice.state === "recording" ? (
              <Square className="h-4 w-4 fill-current" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </motion.button>
        )}

        <textarea
          value={text}
          ref={textareaRef}
          onChange={(e) => setText(e.target.value)}
          disabled={streaming}
          onPaste={(e) => {
            if (visionEnabled && e.clipboardData.files.length > 0) {
              void addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            // Escape closes the quick-prompt popover.
            if (promptsOpen && e.key === "Escape") {
              setShowPrompts(false);
              return;
            }
            // While typing a "/command", Enter picks the top match (inserts, no send).
            if (
              text.startsWith("/") &&
              filteredPrompts.length > 0 &&
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault();
              insertPrompt(filteredPrompts[0]!);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            streaming
              ? "Working on it… use the stop button to interrupt"
              : !connected
                ? "Test your provider connection in settings to start chatting…"
                : voice.state === "recording"
                  ? "Listening… tap the square to transcribe"
                  : "Ask, or dump knowledge into your brain…"
          }
          className="max-h-60 flex-1 resize-none overflow-y-auto scroll-thin bg-transparent px-3 py-2.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 disabled:opacity-60"
        />

        {streaming ? (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onStop}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/20 text-rose-300 transition hover:bg-rose-500/30"
            title="Stop"
          >
            <Square className="h-4 w-4 fill-current" />
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.05 }}
            onClick={submit}
            disabled={disabled || !connected || (!text.trim() && attachments.length === 0)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400 text-white shadow-lg transition disabled:opacity-40"
            title="Send"
          >
            <ArrowUp className="h-5 w-5" />
          </motion.button>
        )}
      </div>
    </div>
  );
}
