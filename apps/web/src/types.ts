/** Local UI types for the chat frontend. */

import type { ProviderChoice } from "@second-brain/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
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
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "copilot",
  copilotModel: "gpt-4o",
  lmStudioUrl: "",
  lmStudioKey: "",
  lmStudioModel: "local-model",
};
