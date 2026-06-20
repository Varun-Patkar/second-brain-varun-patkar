/**
 * useProviderConnection — tracks whether the selected LLM provider is reachable,
 * so the UI can gate chat until a successful test. Copilot (server-side token) is
 * auto-tested once authenticated; LM Studio is tested on demand (its devtunnel URL
 * is user-entered and may be incomplete). The status resets whenever the relevant
 * provider config changes.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useState } from "react";
import { testProvider } from "../api.js";
import type { ProviderConfig } from "../types.js";

export type ConnStatus = "idle" | "testing" | "ok" | "fail";

export interface Connection {
  status: ConnStatus;
  /** Human-friendly failure reason when status is "fail". */
  error?: string;
}

/**
 * @param cfg - Current provider config.
 * @param ready - True once the session is authenticated (gates the auto-test).
 */
export function useProviderConnection(cfg: ProviderConfig, ready: boolean) {
  const [conn, setConn] = useState<Connection>({ status: "idle" });

  const test = useCallback(async () => {
    setConn({ status: "testing" });
    const body =
      cfg.provider === "lmstudio"
        ? {
            provider: "lmstudio" as const,
            lmStudio: {
              baseUrl: cfg.lmStudioUrl,
              model: cfg.lmStudioModel,
              ...(cfg.lmStudioKey ? { key: cfg.lmStudioKey } : {}),
            },
          }
        : { provider: "copilot" as const };
    const r = await testProvider(body);
    setConn(r.ok ? { status: "ok" } : { status: "fail", ...(r.error ? { error: r.error } : {}) });
  }, [cfg.provider, cfg.lmStudioUrl, cfg.lmStudioModel, cfg.lmStudioKey]);

  // Reset whenever the relevant provider config changes.
  useEffect(() => {
    setConn({ status: "idle" });
  }, [cfg.provider, cfg.copilotModel, cfg.lmStudioUrl, cfg.lmStudioModel, cfg.lmStudioKey]);

  // Auto-test Copilot once authenticated (its token lives on the worker).
  useEffect(() => {
    if (ready && cfg.provider === "copilot") void test();
    // Intentionally limited deps: re-run on auth + provider/model change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cfg.provider, cfg.copilotModel]);

  return { conn, test };
}
