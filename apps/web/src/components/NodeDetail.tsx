/**
 * NodeDetail — the graph view's right-hand detail sidebar. Shows the selected
 * node's metadata, its markdown content, and its connections rendered as clickable
 * chips that re-target the selection (so you can walk the graph from the panel).
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import type { BrainGraphEdge, BrainNodeRef } from "@second-brain/shared";
import { FileContent } from "./MarkdownFile.js";
import { colorForType } from "./GraphView.js";

export function NodeDetail({
  node,
  content,
  loading,
  edges,
  nodes,
  onSelect,
  onClose,
}: {
  node: BrainNodeRef | undefined;
  content: string;
  loading: boolean;
  edges: BrainGraphEdge[];
  nodes: Map<string, BrainNodeRef>;
  onSelect: (node: BrainNodeRef) => void;
  onClose: () => void;
}) {
  // Connections in both directions, de-duplicated by the neighbour id.
  const connections = useMemo(() => {
    if (!node) return [];
    const out: Array<{ ref: BrainNodeRef; type: string; dir: "out" | "in" }> =
      [];
    const seen = new Set<string>();
    for (const e of edges) {
      let otherId: string | null = null;
      let dir: "out" | "in" = "out";
      if (e.src === node.id) {
        otherId = e.dst;
        dir = "out";
      } else if (e.dst === node.id) {
        otherId = e.src;
        dir = "in";
      }
      if (!otherId || seen.has(otherId)) continue;
      const ref = nodes.get(otherId);
      if (ref) {
        seen.add(otherId);
        out.push({ ref, type: e.type, dir });
      }
    }
    return out;
  }, [node, edges, nodes]);

  return (
    <>
      {/* Backdrop for the mobile bottom-sheet presentation. */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
      />
      <motion.aside
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] min-h-0 flex-col overflow-hidden rounded-t-2xl shadow-2xl lg:static lg:z-auto lg:max-h-none lg:rounded-2xl lg:shadow-none"
      >
        {/* Grab handle (mobile bottom-sheet affordance). */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20 lg:hidden" />
        <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorForType(node?.type ?? "") }}
              />
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-slate-400">
                {node?.type ?? "node"}
              </span>
            </div>
            <h2 className="mt-1.5 truncate text-sm font-semibold text-slate-100">
              {node?.title ?? "Node"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto scroll-thin p-4">
          {/* Connections. */}
          {connections.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 text-[0.65rem] uppercase tracking-wide text-slate-500">
                Connections ({connections.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {connections.map(({ ref, type, dir }) => (
                  <button
                    key={ref.id}
                    onClick={() => onSelect(ref)}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-xs text-slate-300 transition hover:border-glow-500/40 hover:bg-glow-600/15"
                    title={`${dir === "out" ? "→" : "←"} ${type}`}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: colorForType(ref.type) }}
                    />
                    <span className="max-w-[140px] truncate">{ref.title}</span>
                    <span className="font-mono text-[0.6rem] text-slate-500">
                      {type}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Markdown content. */}
          {loading ? (
            <div className="grid place-items-center py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : node ? (
            <FileContent
              path={node.mdPath}
              content={content}
              nodes={nodes}
              onOpen={(p) => {
                const ref = [...nodes.values()].find((n) => n.mdPath === p);
                if (ref) onSelect(ref);
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">
              This node is no longer in the index.
            </p>
          )}
        </div>
      </motion.aside>
    </>
  );
}
