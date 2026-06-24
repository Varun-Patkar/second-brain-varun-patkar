/**
 * SecretValuePicker — chooses the value for an MCP header. A header value is
 * usually a secret (auth token / API key), so the picker offers a dropdown of
 * existing secrets plus a "create new secret" flow that persists the value
 * server-side and inserts a `{{secret:NAME}}` placeholder. A "literal" escape
 * hatch covers non-secret headers (e.g. a content-version).
 *
 * The component never holds a real secret in the config it emits — only the
 * placeholder reference — so the brain branch stays free of plaintext.
 *
 * @packageDocumentation
 */

import { useState } from "react";
import { Loader2, Plus, Check, X } from "lucide-react";
import { parseSecretRef, sanitizeSecretName, secretPlaceholder } from "./mcpJson.js";

type Mode = "secret" | "literal" | "new";

/** Derive the initial editing mode from the current header value. */
function modeOf(value: string): Mode {
  return parseSecretRef(value) ? "secret" : "literal";
}

export function SecretValuePicker({
  value,
  secretNames,
  readOnly,
  onChange,
  onCreateSecret,
}: {
  /** Current header value (a `{{secret:NAME}}` placeholder or a literal string). */
  value: string;
  /** Names of secrets the user can reference. */
  secretNames: string[];
  readOnly?: boolean;
  onChange: (value: string) => void;
  /** Persist a brand-new secret, then resolve so the picker can reference it. */
  onCreateSecret: (name: string, value: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(modeOf(value));
  const currentSecret = parseSecretRef(value);

  if (readOnly) {
    return (
      <span className="input flex-1 truncate font-mono text-xs text-slate-400">
        {currentSecret ? `secret · ${currentSecret}` : value || "—"}
      </span>
    );
  }

  // Selecting from the dropdown switches mode / sets the referenced secret.
  const onSelect = (v: string): void => {
    if (v === "__new__") {
      setMode("new");
    } else if (v === "__literal__") {
      setMode("literal");
      onChange("");
    } else {
      setMode("secret");
      onChange(secretPlaceholder(v));
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <select
        value={mode === "secret" && currentSecret ? currentSecret : mode === "new" ? "__new__" : "__literal__"}
        onChange={(e) => onSelect(e.target.value)}
        className="input"
      >
        <optgroup label="Reference a secret">
          {secretNames.length === 0 && <option disabled>— no secrets yet —</option>}
          {secretNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </optgroup>
        <option value="__new__">＋ Create new secret…</option>
        <option value="__literal__">Literal value (not a secret)</option>
      </select>

      {mode === "literal" && (
        <input
          value={currentSecret ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="literal header value"
          className="input font-mono text-xs"
        />
      )}

      {mode === "new" && (
        <NewSecretInline
          onCancel={() => setMode("literal")}
          onCreate={async (name, secretValue) => {
            await onCreateSecret(name, secretValue);
            onChange(secretPlaceholder(name));
            setMode("secret");
          }}
        />
      )}
    </div>
  );
}

/** Inline name + value editor for minting a new secret from the header picker. */
function NewSecretInline({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string, value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cleanName = sanitizeSecretName(name);
  const valid = name.trim().length > 0 && secretValue.length > 0;

  const save = async (): Promise<void> => {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      await onCreate(cleanName, secretValue);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create secret");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/30 p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="secret name"
        className="input font-mono text-xs"
        autoFocus
      />
      {name && cleanName !== name && (
        <p className="text-[0.65rem] text-slate-500">Will be saved as {cleanName}</p>
      )}
      <input
        type="password"
        value={secretValue}
        onChange={(e) => setSecretValue(e.target.value)}
        placeholder="secret value (write-only)"
        className="input font-mono text-xs"
        autoComplete="off"
      />
      {err && <p className="text-[0.65rem] text-amber-400">{err}</p>}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => void save()}
          disabled={!valid || saving}
          className="flex items-center gap-1 rounded-lg bg-gradient-to-br from-glow-500 to-aqua-400 px-2.5 py-1.5 text-xs text-white transition disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save secret
        </button>
        <button
          onClick={onCancel}
          className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-slate-400 transition hover:bg-white/10"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <Check className="ml-auto h-3.5 w-3.5 text-slate-700" />
      </div>
    </div>
  );
}
