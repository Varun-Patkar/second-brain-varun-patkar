/**
 * SecretsSection — the write-only secrets manager inside the config hub.
 *
 * Secrets live server-side (encrypted in KV) and are NEVER sent to the LLM or the
 * markdown wiki. This UI can only LIST names, SET/OVERWRITE a value, or DELETE a
 * secret — it can never read a stored value back. The show/hide toggle reveals
 * only what the user is CURRENTLY typing, not any stored value.
 *
 * Reference a secret elsewhere (e.g. in an MCP server URL) as `{{secret:NAME}}`;
 * it is resolved server-side at the point of use.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, KeyRound, Eye, EyeOff, Save, Check } from "lucide-react";
import { deleteSecret, getSecretNames, putSecret } from "../api.js";

export function SecretsSection() {
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The name currently being edited (existing) — shows an inline value input.
  const [editing, setEditing] = useState<string | null>(null);
  // The "add new secret" draft.
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const load = (): void => {
    setLoading(true);
    setError(null);
    getSecretNames()
      .then(setNames)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load secrets"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onSaved = (name: string): void => {
    setEditing(null);
    setAdding(false);
    setNewName("");
    setNames((prev) => (prev.includes(name) ? prev : [...prev, name].sort((a, b) => a.localeCompare(b))));
  };

  const onDelete = async (name: string): Promise<void> => {
    setError(null);
    try {
      await deleteSecret(name);
      setNames((prev) => prev.filter((n) => n !== name));
      if (editing === name) setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete secret");
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
        <KeyRound className="h-4 w-4" />
        Secrets
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Stored encrypted on the server and never sent to the model or saved to the wiki. Reference one
        as <code className="rounded bg-black/40 px-1 text-aqua-400">{"{{secret:NAME}}"}</code> in an MCP
        server URL. Values are write-only — they can be overwritten or deleted, never read back.
      </p>

      {error && <div className="mb-2 text-xs text-amber-400">{error}</div>}

      {loading ? (
        <div className="grid place-items-center py-8 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {names.length === 0 && !adding && (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
              No secrets stored yet.
            </p>
          )}

          {names.map((name) => (
            <div key={name} className="rounded-xl border border-white/10 bg-black/20 p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200">{name}</span>
                <span className="font-mono text-xs text-slate-600">••••••••</span>
                <button
                  onClick={() => setEditing(editing === name ? null : name)}
                  className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
                >
                  Update
                </button>
                <button
                  onClick={() => void onDelete(name)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {editing === name && (
                <SecretValueEditor name={name} onSaved={() => onSaved(name)} onError={setError} />
              )}
            </div>
          ))}

          {/* Add a new secret. */}
          {adding ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="name (letters, digits, _ . -)"
                className="input mb-2 font-mono"
                autoFocus
              />
              {newName.trim() && /^[A-Za-z0-9_.-]{1,64}$/.test(newName.trim()) ? (
                <SecretValueEditor
                  name={newName.trim()}
                  onSaved={() => onSaved(newName.trim())}
                  onError={setError}
                  onCancel={() => {
                    setAdding(false);
                    setNewName("");
                  }}
                />
              ) : (
                <p className="text-xs text-slate-500">
                  {newName.trim() ? "Use only letters, digits, _ . - (max 64)." : "Enter a name to continue."}
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-sm text-slate-400 transition hover:border-white/30 hover:text-slate-200"
            >
              <Plus className="h-4 w-4" />
              Add secret
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Inline value editor for setting/overwriting a secret (masked, show-while-typing). */
function SecretValueEditor({
  name,
  onSaved,
  onError,
  onCancel,
}: {
  name: string;
  onSaved: () => void;
  onError: (msg: string | null) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    if (!value) return;
    setSaving(true);
    onError(null);
    try {
      await putSecret(name, value);
      setValue("");
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="new value"
          className="input pr-9 font-mono"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <button
          onClick={() => setReveal((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
          title={reveal ? "Hide" : "Show while typing"}
          type="button"
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <button
        onClick={() => void save()}
        disabled={!value || saving}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-glow-500 to-aqua-400 text-white transition disabled:opacity-40"
        title="Save secret"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      </button>
      {onCancel && (
        <button
          onClick={onCancel}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10"
          title="Cancel"
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
