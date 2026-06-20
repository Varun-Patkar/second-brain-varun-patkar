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

/**
 * Transcribe a recorded audio blob via the Whisper STT server's `POST /stt`
 * endpoint (multipart/form-data, field `file`). Returns the transcript text.
 *
 * @param sttUrl - Base URL of the STT server (e.g. a devtunnel). Trailing slash optional.
 * @param audio - The recorded audio blob (webm/ogg/wav…).
 * @throws if the server is unreachable or returns a non-OK status.
 */
export async function transcribeAudio(sttUrl: string, audio: Blob): Promise<string> {
  const base = sttUrl.replace(/\/$/, "");
  const form = new FormData();
  // The server accepts webm/ogg/wav/mp3/mpeg; name + type help it pick a decoder.
  const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
  form.append("file", audio, `speech.${ext}`);
  const res = await fetch(`${base}/stt`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`STT failed: ${res.status}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/**
 * Read an image File into the wire shape expected by the chat request: raw
 * base64 (no `data:` prefix) plus its MIME type.
 */
export async function fileToChatImage(file: File): Promise<{ data: string; mimeType: string }> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return { data: btoa(binary), mimeType: file.type || "image/png" };
}
