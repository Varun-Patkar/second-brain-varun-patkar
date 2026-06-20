/**
 * ImageViewer — a full-screen modal lightbox for viewing a chat image. Opens when
 * an image is clicked; dismiss via the backdrop, the close button, or Escape.
 *
 * @packageDocumentation
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  // Close on Escape while open.
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  return (
    <AnimatePresence>
      {src && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-slate-200 transition hover:bg-white/20"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
          <motion.img
            src={src}
            alt="attachment"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            // Stop propagation so clicking the image itself doesn't close the modal.
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
