/**
 * Build the LLM provider for a turn from the user's choice. Copilot uses the
 * server-side static token; LM Studio uses the per-request devtunnel URL and
 * optional key. Credentials flow only through `getCredential` callbacks.
 *
 * @packageDocumentation
 */

import { createCopilotProvider, createOpenAICompatibleProvider } from "agent-framework-js/providers";
import type { Provider } from "agent-framework-js/providers";
import type { ModelCapabilities } from "agent-framework-js";
import type { ChatTurnRequest, ProviderTestResult } from "@second-brain/shared";
import type { Env } from "../env.js";
import { fetchCopilotModels } from "./copilotModels.js";

/** Map a Copilot model id to capabilities by family; unknown ids get a safe default. */
function copilotModelCaps(id: string): ModelCapabilities {
  if (id.startsWith("claude")) {
    return { model: id, maxInputTokens: 200000, maxOutputTokens: 64000, supportsVision: true };
  }
  if (id.startsWith("gpt-5")) {
    return { model: id, maxInputTokens: 272000, maxOutputTokens: 128000, supportsVision: true };
  }
  if (id.startsWith("gemini")) {
    return { model: id, maxInputTokens: 1048576, maxOutputTokens: 65536, supportsVision: true };
  }
  return { model: id, maxInputTokens: 128000, maxOutputTokens: 16000 };
}

/** Resolve the provider + model id for a chat turn. */
export function buildProvider(
  env: Env,
  req: ChatTurnRequest,
): { provider: Provider; model: string; supportsVision: boolean } {
  if (req.provider === "lmstudio") {
    const cfg = req.lmStudio;
    if (!cfg?.baseUrl || !cfg.model) {
      throw new Error("LM Studio requires a baseUrl and model.");
    }
    const provider = createOpenAICompatibleProvider({
      baseUrl: cfg.baseUrl,
      getCredential: () => cfg.key ?? "",
      capabilities: { model: cfg.model, maxInputTokens: 262144, maxOutputTokens: 32000 },
    });
    // LM Studio model capabilities are caller-supplied and unknown here; assume no vision.
    return { provider, model: cfg.model, supportsVision: false };
  }

  // Default: GitHub Copilot. Build a single-model provider from the requested
  // model so the UI can pick any model Copilot offers (see the /models endpoint)
  // without a fixed allow-list to keep in sync.
  const model = req.model || env.COPILOT_DEFAULT_MODEL || "claude-sonnet-4.6";
  const caps = copilotModelCaps(model);
  const provider = createCopilotProvider({
    getCredential: () => env.COPILOT_TOKEN,
    models: [caps],
    defaultModel: model,
  });
  return { provider, model, supportsVision: caps.supportsVision === true };
}

/**
 * Test that the selected provider is reachable and usable, returning a
 * human-friendly result. Copilot is verified by listing models (proves the token
 * works); LM Studio is verified by hitting its OpenAI-compatible `/models`
 * endpoint over the supplied devtunnel URL.
 */
export async function testProvider(
  env: Env,
  req: Pick<ChatTurnRequest, "provider" | "lmStudio">,
): Promise<ProviderTestResult> {
  if (req.provider === "lmstudio") {
    const cfg = req.lmStudio;
    if (!cfg?.baseUrl) return { ok: false, error: "Enter the LM Studio devtunnel URL first." };
    const base = cfg.baseUrl.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/models`, {
        headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {},
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "LM Studio rejected the key (401/403). Check the optional key." };
      }
      if (res.status === 404) {
        return { ok: false, error: "Reached the server but /models was not found — is the URL missing /v1?" };
      }
      return { ok: false, error: `LM Studio returned HTTP ${res.status}.` };
    } catch {
      return {
        ok: false,
        error: "Couldn't reach LM Studio. Is the server running and the dev tunnel up?",
      };
    }
  }

  // Copilot: a successful model list proves the server-side token is valid.
  try {
    const models = await fetchCopilotModels(env);
    if (models.length === 0) {
      return { ok: false, error: "Copilot responded but offered no models — token may be limited." };
    }
    return { ok: true };
  } catch (err) {
    const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (m.includes("401") || m.includes("unauthor") || m.includes("expired")) {
      return { ok: false, error: "Copilot token expired or invalid — refresh COPILOT_TOKEN on the worker." };
    }
    return { ok: false, error: "Couldn't reach GitHub Copilot. Try again in a moment." };
  }
}
