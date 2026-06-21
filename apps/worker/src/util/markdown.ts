/**
 * Minimal, schema-specific markdown frontmatter (de)serialization.
 *
 * We control every write, so instead of pulling a full YAML library into the
 * Worker we serialize/parse just the fields of {@link NodeFrontmatter}. The parser
 * is tolerant enough to rebuild the graph from existing files, but intentionally
 * limited to the known shape.
 *
 * @packageDocumentation
 */

import type { NodeFrontmatter, EdgeType, NodeType } from "@second-brain/shared";

const FENCE = "---";

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return v;
}

/** Serialize frontmatter + body into a complete markdown document string. */
export function serializeDocument(fm: NodeFrontmatter, body: string): string {
  const lines: string[] = [FENCE];
  lines.push(`id: ${fm.id}`);
  lines.push(`type: ${fm.type}`);
  lines.push(`title: ${quote(fm.title)}`);
  lines.push(`summary: ${quote(fm.summary)}`);
  lines.push(`createdAt: ${fm.createdAt}`);
  lines.push(`updatedAt: ${fm.updatedAt}`);
  if (fm.status) {
    lines.push(`status: ${fm.status}`);
  }
  if (fm.tags && fm.tags.length > 0) {
    lines.push(`tags: [${fm.tags.map((t) => quote(t)).join(", ")}]`);
  }
  if (fm.edges && fm.edges.length > 0) {
    lines.push("edges:");
    for (const e of fm.edges) lines.push(`  - { to: ${e.to}, type: ${e.type} }`);
  }
  lines.push(FENCE, "");
  return `${lines.join("\n")}\n${body.trimStart()}`;
}

/** Parse a markdown document string into its frontmatter and body. */
export function parseDocument(raw: string): { frontmatter: NodeFrontmatter; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith(FENCE)) {
    throw new Error("Document is missing frontmatter fence");
  }
  const end = text.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) throw new Error("Unterminated frontmatter");
  const header = text.slice(FENCE.length, end).trim();
  const body = text.slice(end + FENCE.length + 1).replace(/^\n+/, "");

  const fm: Partial<NodeFrontmatter> & { tags?: string[]; edges?: Array<{ to: string; type: EdgeType }> } = {};
  const headerLines = header.split("\n");
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i] ?? "";
    if (line.startsWith("edges:")) {
      const edges: Array<{ to: string; type: EdgeType }> = [];
      while (i + 1 < headerLines.length && (headerLines[i + 1] ?? "").trimStart().startsWith("-")) {
        const m = (headerLines[++i] ?? "").match(/to:\s*([^,]+),\s*type:\s*([^}]+)/);
        if (m && m[1] && m[2]) edges.push({ to: m[1].trim(), type: m[2].trim() as EdgeType });
      }
      fm.edges = edges;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    switch (key) {
      case "id":
        fm.id = value;
        break;
      case "type":
        fm.type = value as NodeType;
        break;
      case "title":
        fm.title = unquote(value);
        break;
      case "summary":
        fm.summary = unquote(value);
        break;
      case "createdAt":
        fm.createdAt = value;
        break;
      case "updatedAt":
        fm.updatedAt = value;
        break;
      case "status":
        if (value === "open" || value === "done") fm.status = value;
        break;
      case "tags": {
        const inner = value.replace(/^\[/, "").replace(/\]$/, "").trim();
        fm.tags = inner ? inner.split(",").map((t) => unquote(t)) : [];
        break;
      }
    }
  }

  if (!fm.id || !fm.type || !fm.title) {
    throw new Error("Frontmatter missing required fields (id/type/title)");
  }
  return {
    frontmatter: {
      id: fm.id,
      type: fm.type,
      title: fm.title,
      summary: fm.summary ?? "",
      createdAt: fm.createdAt ?? "",
      updatedAt: fm.updatedAt ?? "",
      ...(fm.status ? { status: fm.status } : {}),
      ...(fm.tags ? { tags: fm.tags } : {}),
      ...(fm.edges ? { edges: fm.edges } : {}),
    },
    body,
  };
}

/** Build the on-branch markdown path for a node from its type and id. */
export function nodePath(type: NodeType, id: string): string {
  const folder = `${type}s`.replace(/ss$/, "s");
  return `${folder}/${id}.md`;
}
