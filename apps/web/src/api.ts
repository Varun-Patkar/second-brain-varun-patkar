/**
 * API client for the worker backend: OAuth helpers, session, and the streaming
 * chat endpoint. The session token is kept in localStorage (single-user app).
 *
 * @packageDocumentation
 */

import type { ChatTurnRequest, ModelsResponse, SessionInfo, TurnStreamEvent } from "@second-brain/shared";

/** Worker base URL, injected at build time (see .env / SETUP). */
const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined)?.replace(/\/$/, "") ??
  "https://second-brain.varun-patkar.workers.dev";

const TOKEN_KEY = "sb.session";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Get the GitHub authorize URL to redirect the user to. */
export async function getLoginUrl(): Promise<string> {
  const res = await fetch(`${WORKER_URL}/auth/login`);
  if (!res.ok) throw new Error("Failed to start login");
  const { url } = (await res.json()) as { url: string };
  return url;
}

/** Exchange an OAuth code + state for a session token. */
export async function completeLogin(code: string, state: string): Promise<SessionInfo> {
  const res = await fetch(`${WORKER_URL}/auth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  const data = (await res.json()) as { token?: string; info?: SessionInfo; error?: string };
  if (!res.ok || !data.token || !data.info) throw new Error(data.error ?? "login_failed");
  setToken(data.token);
  return data.info;
}

/** Fetch the current session, or null if unauthenticated. */
export async function getSession(): Promise<SessionInfo | null> {
  if (!getToken()) return null;
  const res = await fetch(`${WORKER_URL}/session`, { headers: authHeaders() });
  if (!res.ok) {
    clearToken();
    return null;
  }
  return (await res.json()) as SessionInfo;
}

/** Fetch the dynamic list of available Copilot models (empty on failure). */
export async function getModels(): Promise<ModelsResponse> {
  try {
    const res = await fetch(`${WORKER_URL}/models`, { headers: authHeaders() });
    if (!res.ok) return { models: [], default: "" };
    return (await res.json()) as ModelsResponse;
  } catch {
    return { models: [], default: "" };
  }
}

/** Stream a chat turn, yielding parsed SSE events. */
export async function* streamChat(
  body: ChatTurnRequest,
  signal?: AbortSignal,
): AsyncGenerator<TurnStreamEvent> {
  const res = await fetch(`${WORKER_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: "chat_failed" }));
    throw new Error((err as { error?: string }).error ?? "chat_failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as TurnStreamEvent;
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
