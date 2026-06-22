/**
 * MarkdownFile — renders a single brain file's content: markdown (with a tidy
 * frontmatter table + clickable edge links) or pretty-printed JSON. Shared by the
 * file-tree view and the graph detail sidebar so both render identically.
 *
 * @packageDocumentation
 */

import { motion } from "framer-motion";
import { Link as LinkIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { BrainNodeRef } from "@second-brain/shared";

/** Render a file's content: markdown (with frontmatter table) or pretty JSON. */
export function FileContent({
  path,
  content,
  nodes,
  onOpen,
}: {
  path: string;
  content: string;
  nodes: Map<string, BrainNodeRef>;
  onOpen: (path: string) => void;
}) {
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
    const { frontmatter, edges, body } = splitFrontmatter(content);
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="mb-3 break-all font-mono text-xs text-slate-500">{path}</div>
        {frontmatter.length > 0 && (
          <div className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
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

        {/* Edges rendered as clickable links to the target node. */}
        {edges.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <div className="border-b border-white/5 px-3 py-1.5 text-[0.65rem] uppercase tracking-wide text-slate-500">
              Links
            </div>
            <div className="flex flex-col gap-1 p-2">
              {edges.map((e, i) => {
                const target = nodes.get(e.to);
                return (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-aqua-400">
                      {e.type}
                    </span>
                    {target ? (
                      <button
                        onClick={() => onOpen(target.mdPath)}
                        className="flex items-center gap-1 text-glow-400 underline decoration-glow-400/40 underline-offset-2 transition hover:text-glow-300"
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        {target.title}
                        <span className="text-[0.7rem] text-slate-500">({target.type})</span>
                      </button>
                    ) : (
                      <span className="font-mono text-xs text-slate-500" title="Target not in the current index (maybe trashed)">
                        {e.to}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="prose-brain">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{body}</ReactMarkdown>
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

/** Split a markdown document into frontmatter pairs, edges, and body. */
export function splitFrontmatter(raw: string): {
  frontmatter: Array<[string, string]>;
  edges: Array<{ to: string; type: string }>;
  body: string;
} {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { frontmatter: [], edges: [], body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: [], edges: [], body: text };
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\n+/, "");

  const pairs: Array<[string, string]> = [];
  const edges: Array<{ to: string; type: string }> = [];
  const lines = header.split("\n");
  let inEdges = false;
  for (const line of lines) {
    // Edge list items: "- { to: <id>, type: <edge> }".
    if (inEdges && line.trimStart().startsWith("-")) {
      const m = line.match(/to:\s*([^,]+),\s*type:\s*([^}]+)/);
      if (m && m[1] && m[2]) edges.push({ to: m[1].trim(), type: m[2].trim() });
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key === "edges") {
      inEdges = true; // edges live on the following indented "- {…}" lines
      continue;
    }
    inEdges = false;
    pairs.push([key, value]);
  }
  return { frontmatter: pairs, edges, body };
}
