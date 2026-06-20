/** Local UI types for the chat frontend. */

import type { MessageSegment, ProviderChoice } from "@second-brain/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  /** Ordered text + tool-call segments (assistant turns); rendered inline. */
  segments?: MessageSegment[];
  /** Image attachments rendered with the message (data URLs). */
  images?: string[];
}

/** The provider configuration chosen in the UI. */
export interface ProviderConfig {
  provider: ProviderChoice;
  /** Copilot model id. */
  copilotModel: string;
  /** LM Studio devtunnel URL. */
  lmStudioUrl: string;
  /** LM Studio optional key. */
  lmStudioKey: string;
  /** LM Studio model id. */
  lmStudioModel: string;
  /**
   * Speech-to-text server base URL (e.g. a devtunnel to the local Whisper
   * server). Used by the composer mic button; empty disables voice input.
   */
  sttUrl: string;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "copilot",
  copilotModel: "claude-sonnet-4.6",
  lmStudioUrl: "",
  lmStudioKey: "",
  lmStudioModel: "local-model",
  sttUrl: "",
};

/**
 * Whether the currently-selected model is expected to accept image input. Mirrors
 * the worker's capability mapping (providers/index.ts) so the composer only offers
 * image attachment when the model can actually use it. LM Studio capabilities are
 * unknown to the client, so vision is assumed off there.
 */
export function configSupportsVision(cfg: ProviderConfig): boolean {
  if (cfg.provider !== "copilot") return false;
  const m = cfg.copilotModel;
  return m.startsWith("claude") || m.startsWith("gpt-5") || m.startsWith("gemini");
}
