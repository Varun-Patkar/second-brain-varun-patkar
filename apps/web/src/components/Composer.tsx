/** Message composer with send / stop. */

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Square } from "lucide-react";

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="glass rounded-2xl p-2">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask, or dump knowledge into your brain…"
          className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-slate-200 outline-none placeholder:text-slate-600"
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
            disabled={disabled || !text.trim()}
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
