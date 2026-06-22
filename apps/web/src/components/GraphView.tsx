/**
 * GraphView — an interactive, force-directed graph of the brain's knowledge nodes.
 *
 * Nodes are colour-coded by their `type` (see {@link TYPE_COLORS}); edges are drawn
 * as links between them. The view is fully interactive: drag to pan, scroll to zoom,
 * drag a node to reposition it, and click a node to select it (the parent renders a
 * detail sidebar for the selection). The currently selected node and its immediate
 * neighbours are highlighted; everything else is dimmed so the local neighbourhood
 * stands out.
 *
 * This component owns only the canvas + legend. The parent ({@link BrainViewer})
 * owns the data fetch and the detail sidebar, so this stays focused and reusable.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useRef, useState } from "react";
// eslint-disable-next-line import/no-named-as-default
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { BrainGraphEdge, BrainNodeRef } from "@second-brain/shared";

/** Category → colour map. Unknown types fall back to the brand glow colour. */
export const TYPE_COLORS: Record<string, string> = {
  person: "#34d399",
  project: "#a855f7",
  concept: "#22d3ee",
  journal: "#f59e0b",
  task: "#38bdf8",
  decision: "#fb7185",
  meeting: "#60a5fa",
  email: "#fb923c",
  archive: "#64748b",
};

/** Resolve a node type to a colour, falling back to the brand glow colour. */
export function colorForType(type: string): string {
  return TYPE_COLORS[type] ?? "#7c5cff";
}

/** Internal node shape consumed by react-force-graph (mutated with x/y by the sim). */
interface GraphNode {
  id: string;
  title: string;
  type: string;
  mdPath: string;
  x?: number;
  y?: number;
}

/** Internal link shape consumed by react-force-graph. */
interface GraphLink {
  source: string;
  target: string;
  type: string;
}

export function GraphView({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: BrainNodeRef[];
  edges: BrainGraphEdge[];
  selectedId: string | null;
  onSelect: (node: BrainNodeRef) => void;
}) {
  // react-force-graph needs explicit pixel dimensions; measure the container.
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Keep the canvas sized to its container (responsive to layout/resize).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the graph payload. Links reference node ids; drop dangling edges so the
  // sim doesn't crash on a target that isn't in the node set.
  const data = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const gNodes: GraphNode[] = nodes.map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      mdPath: n.mdPath,
    }));
    const gLinks: GraphLink[] = edges
      .filter((e) => ids.has(e.src) && ids.has(e.dst))
      .map((e) => ({ source: e.src, target: e.dst, type: e.type }));
    return { nodes: gNodes, links: gLinks };
  }, [nodes, edges]);

  // The id set of nodes directly connected to the active (selected/hovered) node,
  // used to highlight a local neighbourhood and dim the rest.
  const active = hoverId ?? selectedId;
  const neighborIds = useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const e of edges) {
      if (e.src === active) set.add(e.dst);
      if (e.dst === active) set.add(e.src);
    }
    return set;
  }, [active, edges]);

  // The distinct categories present, for the legend.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  // Auto-fit the graph to the viewport shortly after the layout settles.
  useEffect(() => {
    if (!data.nodes.length || !size.w) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(500, 80), 600);
    return () => clearTimeout(t);
  }, [data.nodes.length, size.w]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-2xl bg-ink-950">
      {/* Legend (floating, top-left). */}
      {legend.length > 0 && (
        <div className="glass pointer-events-none absolute left-3 top-3 z-10 flex max-w-[60%] flex-wrap gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-[0.7rem] text-slate-300">
          {legend.map(([type, count]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorForType(type) }}
              />
              {type}
              <span className="text-slate-500">({count})</span>
            </span>
          ))}
        </div>
      )}

      {data.nodes.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-slate-500">
          No nodes in the graph yet.
        </div>
      ) : size.w === 0 ? null : (
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={120}
          nodeRelSize={5}
          onNodeHover={(n) => setHoverId((n as GraphNode | null)?.id ?? null)}
          onNodeClick={(n) => {
            const node = n as GraphNode;
            onSelect({ id: node.id, title: node.title, type: node.type, mdPath: node.mdPath });
          }}
          linkColor={(l) => {
            const src = typeof l.source === "object" ? (l.source as GraphNode).id : (l.source as string);
            const dst = typeof l.target === "object" ? (l.target as GraphNode).id : (l.target as string);
            if (neighborIds && (src === active || dst === active)) return "rgba(124,92,255,0.55)";
            if (neighborIds) return "rgba(148,163,184,0.06)";
            return "rgba(148,163,184,0.18)";
          }}
          linkWidth={(l) => {
            const src = typeof l.source === "object" ? (l.source as GraphNode).id : (l.source as string);
            const dst = typeof l.target === "object" ? (l.target as GraphNode).id : (l.target as string);
            return neighborIds && (src === active || dst === active) ? 1.5 : 0.5;
          }}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GraphNode;
            const dimmed = neighborIds ? !neighborIds.has(n.id) : false;
            const isSel = n.id === selectedId;
            const r = isSel ? 7 : 5;
            const color = colorForType(n.type);

            ctx.globalAlpha = dimmed ? 0.2 : 1;

            // Halo ring for the selected node.
            if (isSel) {
              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, r + 3, 0, 2 * Math.PI);
              ctx.fillStyle = "rgba(124,92,255,0.25)";
              ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = isSel ? 1.5 : 0.8;
            ctx.strokeStyle = isSel ? "#ffffff" : "rgba(255,255,255,0.35)";
            ctx.stroke();

            // Labels appear once zoomed in enough, or always for the active node.
            if (globalScale > 1.3 || isSel || n.id === hoverId) {
              const fontSize = Math.max(10 / globalScale, 2.5);
              ctx.font = `${fontSize}px Inter, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = dimmed ? "rgba(148,163,184,0.4)" : "rgba(226,232,240,0.95)";
              const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
              ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + r + 1.5);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as GraphNode;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, 8, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      )}
    </div>
  );
}
