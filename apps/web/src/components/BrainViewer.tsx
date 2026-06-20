/**
 * BrainViewer — an in-app, read-only browser for the brain branch, so the owner
 * can inspect the wiki without going to GitHub. Shows a collapsible file tree;
 * a file's content is fetched only when it is clicked. Markdown is rendered with
 * its frontmatter shown as a tidy metadata table; JSON is pretty-printed.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBrainFile, getBrainTree } from "../api.js";

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
  const [paths, setPaths] = useState<string[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    setLoadingTree(true);
    getBrainTree()
      .then(setPaths)
      .catch((e) => setTreeError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoadingTree(false));
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

  return (
    <div className="mx-auto flex h-full w-[90vw] flex-col gap-3 p-3 md:p-4">
      {/* Header */}
      <header className="glass flex items-center justify-between rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glow-500 to-aqua-400">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gradient">Brain viewer</div>
            <div className="text-[0.7rem] text-slate-500">{paths.length} file(s) on the brain branch</div>
          </div>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chat
        </button>
      </header>

      {/* Body: tree + content */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
        {/* File tree */}
        <aside className="glass min-h-0 overflow-auto scroll-thin rounded-2xl p-2">
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

        {/* File content */}
        <section className="glass min-h-0 overflow-auto scroll-thin rounded-2xl p-4">
          {!selected ? (
            <div className="grid h-full place-items-center text-center text-sm text-slate-500">
              Select a file to view its contents.
            </div>
          ) : loadingFile ? (
            <div className="grid h-full place-items-center text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <FileContent path={selected} content={content} />
          )}
        </section>
      </div>
    </div>
  );
}

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

/** Render a file's content: markdown (with frontmatter table) or pretty JSON. */
function FileContent({ path, content }: { path: string; content: string }) {
  if (path.endsWith(".json")) {
    let pretty = content;
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      /* show raw if not valid JSON */
    }
    return (
      <div>
        <div className="mb-3 break-all font-mono text-xs text-slate-500">{path}</div>
        <pre className="overflow-auto rounded-xl bg-black/40 p-3 font-mono text-xs text-slate-300 scroll-thin">
          {pretty}
        </pre>
      </div>
    );
  }

  if (path.endsWith(".md")) {
    const { frontmatter, body } = splitFrontmatter(content);
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="mb-3 break-all font-mono text-xs text-slate-500">{path}</div>
        {frontmatter.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <div className="border-b border-white/5 px-3 py-1.5 text-[0.65rem] uppercase tracking-wide text-slate-500">
              Frontmatter
            </div>
            <table className="w-full text-xs">
              <tbody>
                {frontmatter.map(([k, v]) => (
                  <tr key={k} className="border-b border-white/[0.04] last:border-0">
                    <td className="w-32 px-3 py-1.5 align-top font-mono text-slate-500">{k}</td>
                    <td className="px-3 py-1.5 align-top font-mono text-slate-300">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="prose-brain">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      </motion.div>
    );
  }

  return (
    <div>
      <div className="mb-3 break-all font-mono text-xs text-slate-500">{path}</div>
      <pre className="overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 font-mono text-xs text-slate-300 scroll-thin">
        {content}
      </pre>
    </div>
  );
}

/** Split a markdown document into frontmatter key/value pairs + body. */
function splitFrontmatter(raw: string): { frontmatter: Array<[string, string]>; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { frontmatter: [], body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: [], body: text };
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const pairs: Array<[string, string]> = [];
  for (const line of header.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      // Continuation / list line — append to the previous value for readability.
      const lastPair = pairs[pairs.length - 1];
      if (lastPair && line.trim()) lastPair[1] += ` ${line.trim()}`;
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    pairs.push([key, value]);
  }
  return { frontmatter: pairs, body };
}
