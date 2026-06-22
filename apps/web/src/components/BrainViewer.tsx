/**
 * BrainViewer — an in-app, read-only browser for the brain branch, so the owner
 * can inspect the wiki without going to GitHub. Shows a collapsible file tree;
 * a file's content is fetched only when it is clicked. Markdown is rendered with
 * its frontmatter shown as a tidy metadata table; JSON is pretty-printed.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  FileJson,
  File as FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  Brain,
  Lock,
  Network,
  FolderTree,
} from "lucide-react";
import type { BrainGraphEdge, BrainNodeRef } from "@second-brain/shared";
import { getBrainFile, getBrainGraph, getBrainTree } from "../api.js";
import { GraphView } from "./GraphView.js";
import { NodeDetail } from "./NodeDetail.js";
import { FileContent } from "./MarkdownFile.js";

/** A node in the file tree built from flat paths. */
interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: Map<string, TreeNode>;
}

/** Build a nested tree from flat file paths. */
function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isFile: false, children: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      if (!cur.children.has(part)) {
        cur.children.set(part, { name: part, path: childPath, isFile, children: new Map() });
      }
      cur = cur.children.get(part)!;
    });
  }
  return root;
}

/** Sort: folders first, then files, both alphabetically. */
function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export function BrainViewer({ onBack }: { onBack: () => void }) {
  // Which presentation is active. The interactive graph is the default; the file
  // tree is the alternative, classic view. Persisted only in component state.
  const [mode, setMode] = useState<"graph" | "files">("graph");

  const [paths, setPaths] = useState<string[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);
  // Node index (id -> {title, path, type}) for resolving edge links + the graph.
  const [nodes, setNodes] = useState<Map<string, BrainNodeRef>>(new Map());
  // Flat node list + edges backing the graph view.
  const [graphNodes, setGraphNodes] = useState<BrainNodeRef[]>([]);
  const [edges, setEdges] = useState<BrainGraphEdge[]>([]);
  const [loadingGraph, setLoadingGraph] = useState(true);
  // The graph node currently selected (drives highlight + detail sidebar).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setLoadingTree(true);
    getBrainTree()
      .then(setPaths)
      .catch((e) => setTreeError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoadingTree(false));
    setLoadingGraph(true);
    getBrainGraph()
      .then(({ nodes: list, edges: e }) => {
        setGraphNodes(list);
        setEdges(e);
        setNodes(new Map(list.map((n) => [n.id, n])));
      })
      .catch(() => {
        /* graph stays empty; the files view still works */
      })
      .finally(() => setLoadingGraph(false));
  }, []);

  const tree = useMemo(() => buildTree(paths), [paths]);

  const openFile = async (path: string) => {
    setSelected(path);
    setLoadingFile(true);
    setContent("");
    try {
      setContent(await getBrainFile(path));
    } catch (e) {
      setContent(`> Could not load this file: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // Select a node from the graph (or a connection chip): highlight it + load its markdown.
  const selectGraphNode = (node: BrainNodeRef) => {
    setSelectedNodeId(node.id);
    void openFile(node.mdPath);
  };

  // The header is shared by both modes; the body swaps on `mode`.
  const header = (
    <header className="glass flex items-center justify-between gap-2 rounded-2xl px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400">
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-gradient">Brain viewer</div>
          <div className="text-[0.7rem] text-slate-500">
            {mode === "graph"
              ? `${graphNodes.length} node(s) · ${edges.length} edge(s)`
              : `${paths.length} file(s) on the brain branch`}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* View toggle: graph (default) ↔ files. */}
        <div className="flex items-center rounded-xl bg-white/5 p-0.5 text-sm">
          <button
            onClick={() => setMode("graph")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition ${
              mode === "graph" ? "bg-glow-600/30 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
            title="Interactive graph"
          >
            <Network className="h-4 w-4" />
            <span className="hidden sm:inline">Graph</span>
          </button>
          <button
            onClick={() => setMode("files")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition ${
              mode === "files" ? "bg-glow-600/30 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
            title="File tree"
          >
            <FolderTree className="h-4 w-4" />
            <span className="hidden sm:inline">Files</span>
          </button>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to chat</span>
        </button>
      </div>
    </header>
  );

  // Graph mode spans the full viewport width; the files mode keeps the cosy 90vw.
  const widthClass = mode === "graph" ? "w-full" : "w-[90vw]";

  return (
    <div className={`mx-auto flex h-full min-w-0 flex-col gap-3 overflow-hidden p-3 md:p-4 ${widthClass}`}>
      {header}

      {mode === "graph" ? (
        <div
          className={`grid min-h-0 flex-1 grid-cols-1 gap-3 ${
            selectedNodeId ? "lg:grid-cols-[1fr_380px]" : "lg:grid-cols-1"
          }`}
        >
          {/* Graph canvas. */}
          <div className="min-h-0 min-w-0">
            {loadingGraph ? (
              <div className="glass grid h-full place-items-center rounded-2xl text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <GraphView
                nodes={graphNodes}
                edges={edges}
                selectedId={selectedNodeId}
                onSelect={selectGraphNode}
              />
            )}
          </div>

          {/* Detail sidebar — only shown once a node is picked. */}
          {selectedNodeId && (
            <NodeDetail
              node={nodes.get(selectedNodeId)}
              content={content}
              loading={loadingFile}
              edges={edges}
              nodes={nodes}
              onSelect={selectGraphNode}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      ) : (
        /* Files mode: tree + content. On small screens these stack into a
           master/detail flow; on lg+ both panes are always visible. */
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
          <aside
            className={`glass min-h-0 overflow-auto scroll-thin rounded-2xl p-2 lg:block ${
              selected ? "hidden" : "block"
            }`}
          >
            {loadingTree ? (
              <div className="grid place-items-center py-10 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : treeError ? (
              <p className="px-2 py-6 text-center text-xs text-amber-400">{treeError}</p>
            ) : (
              <TreeFolder node={tree} depth={0} selected={selected} onOpen={openFile} defaultOpen />
            )}
          </aside>

          <section
            className={`glass min-h-0 flex-col overflow-auto scroll-thin rounded-2xl p-4 lg:flex ${
              selected ? "flex" : "hidden lg:flex"
            }`}
          >
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="mb-3 flex items-center gap-2 self-start rounded-xl bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/10 lg:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
                Files
              </button>
            )}
            {!selected ? (
              <div className="grid h-full place-items-center text-center text-sm text-slate-500">
                Select a file to view its contents.
              </div>
            ) : loadingFile ? (
              <div className="grid h-full place-items-center text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <FileContent path={selected} content={content} nodes={nodes} onOpen={openFile} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * The graph detail sidebar lives in NodeDetail.tsx; the markdown renderer lives in
 * MarkdownFile.tsx. The remaining components below back the classic file-tree view.
 */

/** A collapsible folder (or the root) in the tree. */
function TreeFolder({
  node,
  depth,
  selected,
  onOpen,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
  defaultOpen?: boolean;
}) {
  return (
    <div>
      {sortedChildren(node).map((child) =>
        child.isFile ? (
          <FileRow key={child.path} node={child} depth={depth} selected={selected} onOpen={onOpen} />
        ) : (
          <FolderRow
            key={child.path}
            node={child}
            depth={depth}
            selected={selected}
            onOpen={onOpen}
            defaultOpen={Boolean(defaultOpen && depth === 0)}
          />
        ),
      )}
    </div>
  );
}

function FolderRow({
  node,
  depth,
  selected,
  onOpen,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  // The chats folder is browsed/edited live in the chat-history drawer, not here.
  const locked = node.path === "chats";
  if (locked) {
    return (
      <div
        title="Please refer to chat history to view and interact live."
        className="flex w-full cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-1.5 py-1 text-sm text-slate-500"
        style={{ marginLeft: `${depth * 12}px` }}
      >
        <Lock className="ml-1 h-3.5 w-3.5 shrink-0 text-slate-600" />
        <Folder className="h-4 w-4 shrink-0 text-slate-600" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-sm text-slate-300 transition hover:bg-white/5"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition ${open ? "rotate-90" : ""}`} />
        {open ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-aqua-400" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-slate-400" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && <TreeFolder node={node} depth={depth + 1} selected={selected} onOpen={onOpen} />}
    </div>
  );
}

function FileRow({
  node,
  depth,
  selected,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  const Icon = node.name.endsWith(".json") ? FileJson : node.name.endsWith(".md") ? FileText : FileIcon;
  return (
    <button
      onClick={() => onOpen(node.path)}
      className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-sm transition ${
        selected === node.path ? "bg-glow-600/20 text-slate-100" : "text-slate-400 hover:bg-white/5"
      }`}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
    >
      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
