/**
 * GraphView — an interactive, multi-layout graph of the brain's knowledge nodes.
 *
 * Features (mirroring a classic graph explorer):
 * - A left control rail: a node **search** box, **type filters** (per-category
 *   toggles with counts + All/None, click a category name to isolate it), a
 *   **layout** picker (force / tree / concentric / circle / grid), and an
 *   **edge-label** toggle.
 * - Floating **Fit** (recentre + zoom-to-fit) and **Re-layout** buttons.
 * - Colour-coded nodes + visible edges with arrowheads. Selecting/hovering a node
 *   highlights its 1-hop neighbourhood and dims the rest; searching highlights the
 *   matches and zooms to them.
 *
 * The component owns only the canvas + controls; the parent ({@link BrainViewer})
 * owns the data fetch and the right-hand detail sidebar.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useRef, useState } from "react";
// eslint-disable-next-line import/no-named-as-default
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { Search, Maximize2, RefreshCw, Tag } from "lucide-react";
import type { BrainGraphEdge, BrainNodeRef } from "@second-brain/shared";
import { computeLayout, type LayoutName } from "./graphLayouts.js";

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

/** Internal node shape consumed by react-force-graph (mutated with x/y/fx/fy). */
interface GraphNode {
  id: string;
  title: string;
  type: string;
  mdPath: string;
  x?: number;
  y?: number;
}

/** The pinnable fields react-force-graph reads to fix a node in place. */
type Pinnable = { x?: number; y?: number; fx?: number; fy?: number };

/** Internal link shape consumed by react-force-graph. */
interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

/** The available layouts, in display order. */
const LAYOUTS: Array<{ id: LayoutName; label: string }> = [
  { id: "force", label: "Force-directed" },
  { id: "tree", label: "Tree" },
  { id: "concentric", label: "Concentric" },
  { id: "circle", label: "Circle" },
  { id: "grid", label: "Grid" },
];

/** Resolve a link endpoint (id string or node object) to its id. */
function endpointId(e: string | GraphNode): string {
  return typeof e === "object" ? e.id : e;
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Distinct categories present + their counts (drives the type filter + legend).
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  // Controls state. Types start all-enabled (GraphView mounts after data loads).
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(
    () => new Set(nodes.map((n) => n.type)),
  );
  const [layout, setLayout] = useState<LayoutName>("force");
  const [query, setQuery] = useState("");
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);

  // Build the (stable) graph payload. Visibility + layout are applied without
  // rebuilding this, so node positions persist across filter/highlight changes.
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

  // Keep the canvas sized to its container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Whether a node passes the active type filter. */
  const isNodeVisible = (n: GraphNode): boolean => enabledTypes.has(n.type);

  // 1-hop neighbourhood of the active (hovered or selected) node, for highlighting.
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

  // Search matches (visible nodes whose title contains the query).
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      if (enabledTypes.has(n.type) && n.title.toLowerCase().includes(q)) set.add(n.id);
    }
    return set;
  }, [query, nodes, enabledTypes]);

  /** Recentre + zoom so everything visible fits the viewport. */
  const fit = () => fgRef.current?.zoomToFit(500, 70);

  /** Pan + zoom to frame a specific set of node ids (used for search). */
  const fitToNodes = (ids: Set<string>) => {
    const pts = data.nodes.filter((n) => ids.has(n.id) && n.x != null && n.y != null);
    if (pts.length === 0 || !size.w) return;
    const xs = pts.map((n) => n.x as number);
    const ys = pts.map((n) => n.y as number);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = maxX - minX + 120;
    const h = maxY - minY + 120;
    const k = Math.min(size.w / w, size.h / h, 6);
    fgRef.current?.centerAt(cx, cy, 500);
    fgRef.current?.zoom(Math.max(k, 0.5), 500);
  };

  /**
   * Apply a layout to the currently-visible nodes. "force" clears any pinned
   * positions and reheats the simulation; the geometric layouts pin every visible
   * node to a computed coordinate. Hidden nodes are left untouched.
   */
  const applyLayout = (name: LayoutName) => {
    const fg = fgRef.current;
    const visible = data.nodes.filter(isNodeVisible);
    if (name === "force") {
      for (const n of data.nodes) {
        delete (n as Pinnable).fx;
        delete (n as Pinnable).fy;
      }
      fg?.d3ReheatSimulation();
    } else {
      const linkPairs = data.links.map((l) => ({
        source: endpointId(l.source),
        target: endpointId(l.target),
      }));
      const pos = computeLayout(name, visible, linkPairs);
      for (const n of visible) {
        const p = pos.get(n.id);
        if (!p) continue;
        const pin = n as Pinnable;
        pin.x = p.x;
        pin.y = p.y;
        pin.fx = p.x;
        pin.fy = p.y;
      }
      fg?.d3ReheatSimulation();
    }
    setTimeout(fit, 450);
  };

  // Re-apply the layout whenever the layout choice or the visible set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data.nodes.length || !size.w) return;
    const t = setTimeout(() => applyLayout(layout), 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, enabledTypes, data, size.w]);

  // When a search resolves to matches, frame them.
  useEffect(() => {
    if (matchIds && matchIds.size > 0) {
      const t = setTimeout(() => fitToNodes(matchIds), 150);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIds]);

  const toggleType = (type: string) =>
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  // Click a category name to isolate it (or restore all when already isolated).
  const isolateType = (type: string) =>
    setEnabledTypes((prev) =>
      prev.size === 1 && prev.has(type) ? new Set(typeCounts.map(([t]) => t)) : new Set([type]),
    );

  return (
    <div className="flex h-full w-full flex-col gap-3 lg:flex-row">
      {/* Control rail. */}
      <aside className="glass flex shrink-0 flex-col gap-4 overflow-auto scroll-thin rounded-2xl p-3 lg:w-56">
        {/* Search */}
        <div>
          <div className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
            Search
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && matchIds && fitToNodes(matchIds)}
              placeholder="Search nodes…"
              className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />
          </div>
          {matchIds && (
            <div className="mt-1 text-[0.65rem] text-slate-500">{matchIds.size} match(es)</div>
          )}
        </div>

        {/* Type filters */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
              Types
            </span>
            <div className="flex items-center gap-1.5 text-[0.65rem]">
              <button
                onClick={() => setEnabledTypes(new Set())}
                className="text-slate-500 transition hover:text-slate-300"
              >
                None
              </button>
              <span className="text-slate-700">·</span>
              <button
                onClick={() => setEnabledTypes(new Set(typeCounts.map(([t]) => t)))}
                className="text-slate-500 transition hover:text-slate-300"
              >
                All
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            {typeCounts.map(([type, count]) => {
              const on = enabledTypes.has(type);
              return (
                <div
                  key={type}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-white/5"
                >
                  <button
                    onClick={() => toggleType(type)}
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
                      on ? "border-transparent" : "border-white/20 bg-transparent"
                    }`}
                    style={on ? { backgroundColor: colorForType(type) } : undefined}
                    title={on ? "Hide this type" : "Show this type"}
                  >
                    {on && <span className="h-1.5 w-1.5 rounded-[1px] bg-black/60" />}
                  </button>
                  <button
                    onClick={() => isolateType(type)}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm capitalize transition ${
                      on ? "text-slate-200" : "text-slate-600"
                    }`}
                    title="Click to isolate this type"
                  >
                    <span className="truncate">{type}</span>
                  </button>
                  <span className="shrink-0 text-[0.65rem] text-slate-500">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Layout picker */}
        <div>
          <div className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
            Layout
          </div>
          <div className="flex flex-col gap-1">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLayout(l.id)}
                className={`rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                  layout === l.id
                    ? "bg-glow-600/25 text-slate-100 ring-1 ring-glow-500/40"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Edge labels */}
        <div>
          <div className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
            Edges
          </div>
          <button
            onClick={() => setShowEdgeLabels((v) => !v)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
              showEdgeLabels ? "bg-glow-600/25 text-slate-100" : "text-slate-400 hover:bg-white/5"
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            Show edge labels
          </button>
        </div>
      </aside>

      {/* Canvas. */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-ink-950">
        {/* Floating actions. */}
        <div className="absolute right-3 top-3 z-10 flex gap-2">
          <button
            onClick={fit}
            className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-white/10"
            title="Fit graph to view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fit
          </button>
          <button
            onClick={() => applyLayout(layout)}
            className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-white/10"
            title="Recompute the current layout"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-layout
          </button>
        </div>

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
            cooldownTicks={140}
            nodeRelSize={5}
            nodeVisibility={(n) => isNodeVisible(n as GraphNode)}
            linkVisibility={(l) =>
              isNodeVisible(l.source as GraphNode) && isNodeVisible(l.target as GraphNode)
            }
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={0.85}
            onNodeHover={(n) => setHoverId((n as GraphNode | null)?.id ?? null)}
            onNodeClick={(n) => {
              const node = n as GraphNode;
              onSelect({ id: node.id, title: node.title, type: node.type, mdPath: node.mdPath });
            }}
            linkColor={(l) => {
              const src = endpointId(l.source as string | GraphNode);
              const dst = endpointId(l.target as string | GraphNode);
              if (neighborIds && (src === active || dst === active)) return "rgba(124,92,255,0.7)";
              if (neighborIds) return "rgba(148,163,184,0.08)";
              return "rgba(148,163,184,0.35)";
            }}
            linkWidth={(l) => {
              const src = endpointId(l.source as string | GraphNode);
              const dst = endpointId(l.target as string | GraphNode);
              return neighborIds && (src === active || dst === active) ? 2 : 0.8;
            }}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={(l, ctx, globalScale) => {
              if (!showEdgeLabels) return;
              const s = l.source as GraphNode;
              const t = l.target as GraphNode;
              if (s.x == null || t.x == null) return;
              const mx = (s.x + (t.x ?? 0)) / 2;
              const my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
              const fontSize = Math.max(8 / globalScale, 2);
              ctx.font = `${fontSize}px Inter, sans-serif`;
              ctx.fillStyle = "rgba(148,163,184,0.75)";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText((l as GraphLink).type, mx, my);
            }}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GraphNode;
              const isSel = n.id === selectedId;
              const isMatch = matchIds ? matchIds.has(n.id) : false;
              const dimmed = matchIds
                ? !isMatch
                : neighborIds
                  ? !neighborIds.has(n.id)
                  : false;
              const r = isSel ? 7 : 5;
              const color = colorForType(n.type);
              ctx.globalAlpha = dimmed ? 0.18 : 1;

              if (isSel || isMatch) {
                ctx.beginPath();
                ctx.arc(n.x ?? 0, n.y ?? 0, r + 3, 0, 2 * Math.PI);
                ctx.fillStyle = isSel ? "rgba(124,92,255,0.3)" : "rgba(34,211,238,0.25)";
                ctx.fill();
              }

              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.lineWidth = isSel ? 1.5 : 0.8;
              ctx.strokeStyle = isSel ? "#ffffff" : "rgba(255,255,255,0.35)";
              ctx.stroke();

              if (globalScale > 1.3 || isSel || isMatch || n.id === hoverId) {
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
    </div>
  );
}
