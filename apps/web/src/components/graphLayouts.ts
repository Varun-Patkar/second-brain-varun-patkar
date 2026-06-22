/**
 * graphLayouts — pure position-computation helpers for the brain graph viewer.
 *
 * Each function maps a set of nodes (and, where relevant, their links) to absolute
 * x/y coordinates in graph space. The "force" layout is handled by the simulation
 * itself, so {@link computeLayout} returns an empty map for it (the caller clears
 * any pinned positions and reheats instead).
 *
 * @packageDocumentation
 */

/** The available graph arrangements, mirroring the on-screen layout picker. */
export type LayoutName = "force" | "tree" | "concentric" | "circle" | "grid";

/** A 2-D point in graph space. */
export interface Point {
  x: number;
  y: number;
}

/** Minimal node shape the layouts need (id + type). */
export interface LayoutNode {
  id: string;
  type: string;
}

/** Minimal link shape the layouts need (endpoint ids). */
export interface LayoutLink {
  source: string;
  target: string;
}

/** Build an undirected adjacency map from links (restricted to the given node set). */
function adjacency(nodes: LayoutNode[], links: LayoutLink[]): Map<string, Set<string>> {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const l of links) {
    if (!ids.has(l.source) || !ids.has(l.target)) continue;
    adj.get(l.source)?.add(l.target);
    adj.get(l.target)?.add(l.source);
  }
  return adj;
}

/** Lay nodes out on a single circle, ordered as given. */
function circleLayout(nodes: LayoutNode[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  const n = nodes.length;
  const radius = Math.max(150, n * 9);
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(n, 1)) * 2 * Math.PI;
    pos.set(node.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  });
  return pos;
}

/** Lay nodes out on a square-ish grid. */
function gridLayout(nodes: LayoutNode[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  const spacing = 70;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const offset = ((cols - 1) * spacing) / 2;
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pos.set(node.id, { x: col * spacing - offset, y: row * spacing - offset });
  });
  return pos;
}

/** Concentric rings ordered by degree: the most-connected nodes sit at the centre. */
function concentricLayout(nodes: LayoutNode[], links: LayoutLink[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  const adj = adjacency(nodes, links);
  const sorted = [...nodes].sort((a, b) => (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0));
  const step = 120;
  let idx = 0;
  let ring = 0;
  while (idx < sorted.length) {
    const capacity = ring === 0 ? 1 : ring * 6;
    const count = Math.min(capacity, sorted.length - idx);
    const radius = ring * step;
    for (let i = 0; i < count; i++) {
      const node = sorted[idx];
      if (!node) {
        idx++;
        continue;
      }
      const angle = count === 1 ? 0 : (i / count) * 2 * Math.PI;
      pos.set(node.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      idx++;
    }
    ring++;
  }
  return pos;
}

/**
 * A layered tree: BFS from the highest-degree node assigns each node a depth, and
 * every depth becomes a horizontal row. Disconnected nodes are appended on a final
 * row so nothing is lost.
 */
function treeLayout(nodes: LayoutNode[], links: LayoutLink[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  if (nodes.length === 0) return pos;
  const adj = adjacency(nodes, links);
  // Root = most-connected node.
  const root = [...nodes].sort((a, b) => (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0))[0];
  if (!root) return pos;

  const depthOf = new Map<string, number>();
  const queue: string[] = [root.id];
  depthOf.set(root.id, 0);
  while (queue.length) {
    const id = queue.shift() as string;
    const d = depthOf.get(id) ?? 0;
    for (const nb of adj.get(id) ?? []) {
      if (!depthOf.has(nb)) {
        depthOf.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  // Disconnected nodes go one level below the deepest reached level.
  const maxDepth = Math.max(0, ...[...depthOf.values()]);
  for (const n of nodes) if (!depthOf.has(n.id)) depthOf.set(n.id, maxDepth + 1);

  // Bucket by depth and spread each level horizontally.
  const levels = new Map<number, string[]>();
  for (const [id, d] of depthOf) {
    const arr = levels.get(d) ?? [];
    arr.push(id);
    levels.set(d, arr);
  }
  const spacingX = 80;
  const spacingY = 110;
  for (const [d, ids] of levels) {
    const offset = ((ids.length - 1) * spacingX) / 2;
    ids.forEach((id, i) => pos.set(id, { x: i * spacingX - offset, y: d * spacingY }));
  }
  return pos;
}

/**
 * Compute absolute positions for the requested layout. Returns an empty map for
 * "force" (the simulation owns positions in that mode).
 */
export function computeLayout(
  name: LayoutName,
  nodes: LayoutNode[],
  links: LayoutLink[],
): Map<string, Point> {
  switch (name) {
    case "circle":
      return circleLayout(nodes);
    case "grid":
      return gridLayout(nodes);
    case "concentric":
      return concentricLayout(nodes, links);
    case "tree":
      return treeLayout(nodes, links);
    case "force":
    default:
      return new Map();
  }
}
