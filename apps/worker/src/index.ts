/**
 * Worker entry point: CORS, owner-locked auth routes, and the SSE chat endpoint.
 *
 * Routes:
 *   GET  /health          — liveness
 *   GET  /auth/login      — returns the GitHub authorize URL (+ CSRF state)
 *   POST /auth/callback   — exchanges { code, state } for an owner session token
 *   GET  /session         — returns the current session info (auth required)
 *   POST /chat            — runs a turn, streaming TurnStreamEvent as SSE (auth required)
 *
 * @packageDocumentation
 */

import type { ChatTurnRequest, TurnStreamEvent } from "@second-brain/shared";
import type { Env } from "./env.js";
import { buildAuthorizeUrl, completeOAuth } from "./auth/oauth.js";
import { verifySession } from "./auth/session.js";
import { runTurn } from "./turn.js";

/** Build CORS headers, allowing the configured Pages origin and localhost dev. */
function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed =
    origin && (origin === env.ALLOWED_ORIGIN || /^https?:\/\/localhost(:\d+)?$/.test(origin))
      ? origin
      : env.ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, init: ResponseInit, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...(init.headers ?? {}) },
  });
}

/** Extract and verify the bearer session token; returns the session or null. */
async function authed(env: Env, req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token ? verifySession(env, token) : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const corsHeaders = cors(env, origin);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- Health ---
    if (url.pathname === "/health") {
      return json({ ok: true }, { status: 200 }, corsHeaders);
    }

    // --- Auth: start login ---
    if (url.pathname === "/auth/login" && req.method === "GET") {
      const { url: authorizeUrl } = await buildAuthorizeUrl(env);
      return json({ url: authorizeUrl }, { status: 200 }, corsHeaders);
    }

    // --- Auth: OAuth callback ---
    if (url.pathname === "/auth/callback" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { code?: string; state?: string };
      if (!body.code || !body.state) {
        return json({ error: "missing_code_or_state" }, { status: 400 }, corsHeaders);
      }
      const result = await completeOAuth(env, body.code, body.state);
      if ("error" in result) {
        return json({ error: result.error }, { status: 401 }, corsHeaders);
      }
      return json(result, { status: 200 }, corsHeaders);
    }

    // --- Session info ---
    if (url.pathname === "/session" && req.method === "GET") {
      const session = await authed(env, req);
      if (!session) return json({ error: "unauthorized" }, { status: 401 }, corsHeaders);
      return json(session, { status: 200 }, corsHeaders);
    }

    // --- Chat (SSE) ---
    if (url.pathname === "/chat" && req.method === "POST") {
      const session = await authed(env, req);
      if (!session) return json({ error: "unauthorized" }, { status: 401 }, corsHeaders);

      const body = (await req.json().catch(() => null)) as ChatTurnRequest | null;
      if (!body?.message || !body.provider) {
        return json({ error: "invalid_request" }, { status: 400 }, corsHeaders);
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const emit = (event: TurnStreamEvent): void => {
        void writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Run the turn and close the stream when finished.
      void runTurn(env, body, emit)
        .catch((err: unknown) => {
          emit({ type: "error", code: "fatal", message: err instanceof Error ? err.message : "unknown" });
        })
        .finally(() => void writer.close());

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeaders,
        },
      });
    }

    return json({ error: "not_found" }, { status: 404 }, corsHeaders);
  },
} satisfies ExportedHandler<Env>;
