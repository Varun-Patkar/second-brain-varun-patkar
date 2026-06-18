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

  // Default: GitHub Copilot. Build a single-model provider from the requested
  // model so the UI can pick any model Copilot offers (see the /models endpoint)
  // without a fixed allow-list to keep in sync.
  const model = req.model || env.COPILOT_DEFAULT_MODEL || "claude-sonnet-4.6";
  const provider = createCopilotProvider({
    getCredential: () => env.COPILOT_TOKEN,
    models: [copilotModelCaps(model)],
    defaultModel: model,
  });
  return { provider, model };
}
