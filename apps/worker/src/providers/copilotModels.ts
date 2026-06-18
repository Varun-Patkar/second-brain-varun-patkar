/**
 * Fetch the list of GitHub Copilot models available to the configured token.
 *
 * Copilot exposes an OpenAI-style `GET /models` endpoint. We surface the
 * picker-enabled models so the frontend can populate its dropdown dynamically
 * instead of hardcoding a list.
 *
 * @packageDocumentation
 */

import type { CopilotModelInfo } from "@second-brain/shared";
import type { Env } from "../env.js";

interface CopilotModel {
  id: string;
  name?: string;
  model_picker_enabled?: boolean;
}

/** Query Copilot for the models the current token may use. */
export async function fetchCopilotModels(env: Env): Promise<CopilotModelInfo[]> {
  const res = await fetch("https://api.githubcopilot.com/models", {
    headers: {
      Authorization: `Bearer ${env.COPILOT_TOKEN}`,
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.20.0",
      "Copilot-Integration-Id": "vscode-chat",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Copilot /models failed: ${res.status}`);
  const json = (await res.json()) as { data?: CopilotModel[] };

  const seen = new Set<string>();
  const out: CopilotModelInfo[] = [];
  for (const m of json.data ?? []) {
    if (m.model_picker_enabled === false) continue;
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: m.name ?? m.id });
  }
  return out;
}
