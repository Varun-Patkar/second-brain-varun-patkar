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
import type { ChatTurnRequest } from "@second-brain/shared";
import type { Env } from "../env.js";

/** Known Copilot model capabilities; unknown ids fall back to a safe default. */
function copilotModelCaps(id: string): ModelCapabilities {
  switch (id) {
    case "o3-mini":
      return { model: id, maxInputTokens: 200000, maxOutputTokens: 100000, supportsReasoning: true };
    case "gpt-4o":
    default:
      return { model: id, maxInputTokens: 128000, maxOutputTokens: 16000, supportsVision: true };
  }
}

/** Resolve the provider + model id for a chat turn. */
export function buildProvider(env: Env, req: ChatTurnRequest): { provider: Provider; model: string } {
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
    return { provider, model: cfg.model };
  }

  // Default: GitHub Copilot.
  const ids = env.COPILOT_MODELS.split(",").map((s) => s.trim()).filter(Boolean);
  const models = (ids.length > 0 ? ids : ["gpt-4o"]).map(copilotModelCaps);
  const defaultModel = env.COPILOT_DEFAULT_MODEL || models[0]!.model;
  const provider = createCopilotProvider({
    getCredential: () => env.COPILOT_TOKEN,
    models,
    defaultModel,
  });
  return { provider, model: req.model || defaultModel };
}
