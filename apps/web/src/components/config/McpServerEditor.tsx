/**
 * McpServerEditor — visual editor for one MCP server entry: id, URL, transport
 * type, enabled flag, and a headers editor whose values flow through the
 * {@link SecretValuePicker} (so auth tokens become `{{secret:NAME}}` references).
 * A collapsible JSON preview shows exactly what will be written to `mcp.json`.
 *
 * @packageDocumentation
 */

import { useMemo, useState } from "react";
import { Trash2, Plus, ChevronDown, ChevronRight, Code2 } from "lucide-react";
import type { McpServerConfig } from "@second-brain/shared";
import { SecretValuePicker } from "./SecretValuePicker.js";
import { serverToJsonPreview } from "./mcpJson.js";

/** A single editable header row (local key/value pair with a stable id). */
interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

let headerRowSeq = 0;

/** Build the editable header rows from a server's headers record. */
function rowsFromHeaders(headers?: Record<string, string>): HeaderRow[] {
  return Object.entries(headers ?? {}).map(([key, value]) => ({ id: headerRowSeq++, key, value }));
}

/** Collapse header rows back into a record (dropping rows with an empty key). */
function headersFromRows(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
  return out;
}

export function McpServerEditor({
  server,
  readOnly,
  secretNames,
  onPatch,
  onRemove,
  onCreateSecret,
}: {
  server: McpServerConfig;
  readOnly?: boolean;
  secretNames: string[];
  onPatch: (patch: Partial<McpServerConfig>) => void;
  onRemove: () => void;
  onCreateSecret: (name: string, value: string) => Promise<void>;
}) {
  // Header rows are kept locally so editing a key doesn't lose focus; every change
  // is pushed up as a fresh `headers` record.
  const [rows, setRows] = useState<HeaderRow[]>(() => rowsFromHeaders(server.headers));
  const [showHeaders, setShowHeaders] = useState((server.headers && Object.keys(server.headers).length > 0) || false);
  const [showJson, setShowJson] = useState(false);

  const commitRows = (next: HeaderRow[]): void => {
    setRows(next);
    onPatch({ headers: headersFromRows(next) });
  };
  const patchRow = (id: number, patch: Partial<HeaderRow>): void =>
    commitRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const preview = useMemo(() => serverToJsonPreview(server), [server]);
  const httpsWarn = server.url && !/^https:\/\//i.test(server.url);

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-2.5">
      {/* id + url + remove */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={server.id}
          onChange={(e) => onPatch({ id: e.target.value })}
          placeholder="id (e.g. docs)"
          className="input w-full sm:w-32 sm:flex-none"
          disabled={readOnly}
        />
        <div className="flex w-full items-center gap-2 sm:flex-1">
          <input
            value={server.url}
            onChange={(e) => onPatch({ url: e.target.value })}
            placeholder="https://mcp.example.com"
            className="input flex-1"
            disabled={readOnly}
          />
          {!readOnly && (
            <button
              onClick={onRemove}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
              title="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* type + enabled */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <label className="flex items-center gap-1.5">
          Transport
          <select
            value={server.type ?? "http"}
            onChange={(e) => onPatch({ type: e.target.value as "http" | "sse" })}
            className="input w-auto py-1"
            disabled={readOnly}
          >
            <option value="http">http (Streamable)</option>
            <option value="sse">sse (legacy)</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={server.enabled !== false}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
            className="accent-glow-500"
            disabled={readOnly}
          />
          Enabled
        </label>
        {httpsWarn && <span className="text-amber-400">— must be an https URL</span>}
      </div>

      {/* headers (collapsible) */}
      <div className="rounded-lg border border-white/5 bg-black/20">
        <button
          onClick={() => setShowHeaders((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300"
        >
          {showHeaders ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Headers (auth){rows.length > 0 ? ` · ${rows.length}` : ""}
        </button>
        {showHeaders && (
          <div className="space-y-2 px-2.5 pb-2.5">
            {rows.length === 0 && (
              <p className="text-[0.7rem] text-slate-500">
                No headers. Add one (e.g. <code className="text-aqua-400">x-apikey</code>) and pick a secret for its value.
              </p>
            )}
            {rows.map((row) => (
              <div key={row.id} className="flex flex-col gap-1.5 rounded-lg bg-black/20 p-2 sm:flex-row sm:items-start">
                <input
                  value={row.key}
                  onChange={(e) => patchRow(row.id, { key: e.target.value })}
                  placeholder="header name"
                  className="input font-mono text-xs sm:w-40 sm:flex-none"
                  disabled={readOnly}
                />
                <SecretValuePicker
                  value={row.value}
                  secretNames={secretNames}
                  {...(readOnly ? { readOnly } : {})}
                  onChange={(v) => patchRow(row.id, { value: v })}
                  onCreateSecret={onCreateSecret}
                />
                {!readOnly && (
                  <button
                    onClick={() => commitRows(rows.filter((r) => r.id !== row.id))}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                    title="Remove header"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button
                onClick={() => commitRows([...rows, { id: headerRowSeq++, key: "", value: "" }])}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-white/30 hover:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
                Add header
              </button>
            )}
          </div>
        )}
      </div>

      {/* JSON preview (collapsible) */}
      <div className="rounded-lg border border-white/5 bg-black/20">
        <button
          onClick={() => setShowJson((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300"
        >
          <Code2 className="h-3.5 w-3.5" />
          {showJson ? "Hide" : "Show"} JSON preview
        </button>
        {showJson && (
          <pre className="overflow-auto rounded-b-lg bg-black/40 p-2.5 font-mono text-[0.7rem] leading-relaxed text-slate-300 scroll-thin">
            {preview}
          </pre>
        )}
      </div>
    </div>
  );
}
