/**
 * McpSection — the MCP servers block of the config page. Offers three ways to add
 * a server: the visual editor ({@link McpServerEditor}), pasting standard
 * `mcp.json` (raw secrets are lifted into the secrets store automatically), and
 * delegating to the agent via a prefilled chat prompt.
 *
 * @packageDocumentation
 */

import { useState } from "react";
import { Server, Plus, ClipboardPaste, Sparkles, Loader2, X } from "lucide-react";
import type { McpServerConfig } from "@second-brain/shared";
import { McpServerEditor } from "./McpServerEditor.js";
import { parseMcpJson } from "./mcpJson.js";

/** Prompt seeded into a fresh chat when the user asks the agent to add a server. */
const AGENT_PROMPT =
  "Add a new remote MCP server to my brain config. Here's what I want " +
  "(fill in the details): the server is called ___, its HTTPS URL is ___, it uses " +
  "the ___ transport, and it needs these headers for auth: ___. If a header needs a " +
  "secret, store it as a secret and reference it as {{secret:NAME}} — never write the " +
  "raw value into mcp.json.";

export function McpSection({
  servers,
  readOnly,
  secretNames,
  onChange,
  onCreateSecret,
  onDeclareViaAgent,
}: {
  servers: McpServerConfig[];
  readOnly?: boolean;
  secretNames: string[];
  onChange: (servers: McpServerConfig[]) => void;
  onCreateSecret: (name: string, value: string) => Promise<void>;
  onDeclareViaAgent: (prompt: string) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const patchServer = (i: number, patch: Partial<McpServerConfig>): void =>
    onChange(servers.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeServer = (i: number): void => onChange(servers.filter((_, idx) => idx !== i));
  const addServer = (): void => onChange([...servers, { id: "", url: "", enabled: true, type: "http" }]);

  /** Parse pasted JSON, persist any extracted secrets, then append the servers. */
  const importJson = async (): Promise<void> => {
    setImportErr(null);
    setImportNote(null);
    let parsed;
    try {
      parsed = parseMcpJson(jsonText, secretNames);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Invalid JSON");
      return;
    }
    setImporting(true);
    try {
      for (const sec of parsed.secrets) await onCreateSecret(sec.name, sec.value);
      onChange([...servers, ...parsed.servers]);
      setJsonText("");
      setPasting(false);
      const secNote =
        parsed.secrets.length > 0
          ? ` ${parsed.secrets.length} secret(s) were extracted into the secrets store.`
          : "";
      setImportNote(`Imported ${parsed.servers.length} server(s).${secNote}`);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Failed to save extracted secrets");
    } finally {
      setImporting(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
        <Server className="h-4 w-4" />
        MCP servers (remote HTTPS only)
      </div>

      <div className="space-y-2">
        {servers.map((s, i) => (
          <McpServerEditor
            key={i}
            server={s}
            {...(readOnly ? { readOnly } : {})}
            secretNames={secretNames}
            onPatch={(patch) => patchServer(i, patch)}
            onRemove={() => removeServer(i)}
            onCreateSecret={onCreateSecret}
          />
        ))}
        {servers.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
            No MCP servers configured.
          </p>
        )}

        {importNote && <p className="text-xs text-emerald-400">{importNote}</p>}

        {!readOnly && (
          <>
            {/* Paste JSON importer. */}
            {pasting ? (
              <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Paste mcp.json</span>
                  <button
                    onClick={() => {
                      setPasting(false);
                      setImportErr(null);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  rows={8}
                  placeholder={'{\n  "mcpServers": {\n    "WebIQ": {\n      "url": "https://api.example.com/mcp",\n      "type": "http",\n      "headers": { "x-apikey": "sk-…" }\n    }\n  }\n}'}
                  className="input resize-y font-mono text-xs"
                />
                <p className="text-[0.7rem] text-slate-500">
                  Supports the standard <code className="text-aqua-400">mcpServers</code> map or a{" "}
                  <code className="text-aqua-400">servers</code> array. Any raw secret in a header is moved into the
                  secrets store and replaced with a <code className="text-aqua-400">{"{{secret:NAME}}"}</code> reference.
                </p>
                {importErr && <p className="text-xs text-amber-400">{importErr}</p>}
                <button
                  onClick={() => void importJson()}
                  disabled={!jsonText.trim() || importing}
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-glow-500 to-aqua-400 px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-40"
                >
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                  Import
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={addServer}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
                >
                  <Plus className="h-4 w-4" />
                  Add MCP server
                </button>
                <button
                  onClick={() => setPasting(true)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
                >
                  <ClipboardPaste className="h-4 w-4" />
                  Paste JSON
                </button>
                <button
                  onClick={() => onDeclareViaAgent(AGENT_PROMPT)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-glow-500/30 px-3 py-2 text-sm text-glow-300 transition hover:border-glow-500/50 hover:text-glow-200"
                >
                  <Sparkles className="h-4 w-4" />
                  Declare via agent
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
