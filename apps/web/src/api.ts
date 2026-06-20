/**
 * API client for the worker backend: OAuth helpers, session, and the streaming
 * chat endpoint. The session token is kept in localStorage (single-user app).
 *
 * @packageDocumentation
 */

import type {
  BrainConfigDto,
  BrainConfigUpdate,
  BrainConfigUpdateResult,
  BrainFileResponse,
  BrainInfo,
  BrainNodesResponse,
  BrainTreeResponse,
  ChatListResponse,
  ChatRecord,
  ChatTurnRequest,
  ModelsResponse,
  ProviderTestResult,
  SessionInfo,
  TurnStatusResponse,
  TurnStreamEvent,
} from "@second-brain/shared";

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
 * Test connectivity to the chosen provider through the worker (which is the path
 * a real turn takes). Returns a human-friendly result.
 */
export async function testProvider(
  body: Pick<ChatTurnRequest, "provider" | "lmStudio">,
): Promise<ProviderTestResult> {
  try {
    const res = await fetch(`${WORKER_URL}/provider/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Worker returned HTTP ${res.status}.` };
    return (await res.json()) as ProviderTestResult;
  } catch {
    return { ok: false, error: "Couldn't reach the worker backend." };
  }
}

/** Fetch the brain config (MCP servers + skills) for the management UI. */
export async function getConfig(): Promise<BrainConfigDto> {
  const res = await fetch(`${WORKER_URL}/config`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load config: HTTP ${res.status}`);
  return (await res.json()) as BrainConfigDto;
}

/** Apply a brain-config edit (MCP servers / skills). */
export async function saveConfig(update: BrainConfigUpdate): Promise<BrainConfigUpdateResult> {
  const res = await fetch(`${WORKER_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(update),
  });
  const data = (await res.json().catch(() => ({}))) as BrainConfigUpdateResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Failed to save config: HTTP ${res.status}`);
  return data;
}

/** List stored chat summaries (most recent first). */
export async function listChats(): Promise<ChatListResponse> {
  try {
    const res = await fetch(`${WORKER_URL}/chats`, { headers: authHeaders() });
    if (!res.ok) return { chats: [] };
    return (await res.json()) as ChatListResponse;
  } catch {
    return { chats: [] };
  }
}

/** Load a stored conversation by id, or null if it doesn't exist. */
export async function getChat(id: string): Promise<ChatRecord | null> {
  const res = await fetch(`${WORKER_URL}/chats/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as ChatRecord;
}

/** Delete a stored conversation by id. */
export async function deleteChat(id: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/chats/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Failed to delete chat: HTTP ${res.status}`);
  }
}

/** Whether a turn is still running server-side for the given chat. */
export async function getTurnStatus(chatId: string): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/chat/status?chatId=${encodeURIComponent(chatId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return false;
    return ((await res.json()) as TurnStatusResponse).running;
  } catch {
    return false;
  }
}

/** Fetch a stored chat image asset as a data URL (or null on failure). */
export async function getChatAsset(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${WORKER_URL}/chats/asset?path=${encodeURIComponent(path)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { dataUrl?: string }).dataUrl ?? null;
  } catch {
    return null;
  }
}

/** Repo info for the brain viewer + GitHub link. */
export async function getBrainInfo(): Promise<BrainInfo | null> {
  try {
    const res = await fetch(`${WORKER_URL}/brain/info`, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as BrainInfo;
  } catch {
    return null;
  }
}

/** List all file paths on the brain branch. */
export async function getBrainTree(): Promise<string[]> {
  const res = await fetch(`${WORKER_URL}/brain/tree`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to load brain tree: HTTP ${res.status}`);
  return ((await res.json()) as BrainTreeResponse).files;
}

/** Load a single brain file's text content (on demand). */
export async function getBrainFile(path: string): Promise<string> {
  const res = await fetch(`${WORKER_URL}/brain/file?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load file: HTTP ${res.status}`);
  return ((await res.json()) as BrainFileResponse).content;
}

/** Load the node index (id -> title/path) for resolving edge links. */
export async function getBrainNodes(): Promise<BrainNodesResponse["nodes"]> {
  try {
    const res = await fetch(`${WORKER_URL}/brain/nodes`, { headers: authHeaders() });
    if (!res.ok) return [];
    return ((await res.json()) as BrainNodesResponse).nodes;
  } catch {
    return [];
  }
}

/**
 * Transcribe a recorded audio blob via the Whisper STT server's `POST /stt`
 * endpoint (multipart/form-data, field `file`). Returns the transcript text.
 *
 * @param sttUrl - Base URL of the STT server (e.g. a devtunnel). Trailing slash optional.
 * @param audio - The recorded audio blob (webm/ogg/wav…).
 * @throws a human-friendly error if the server is unreachable or returns non-OK.
 */
export async function transcribeAudio(sttUrl: string, audio: Blob): Promise<string> {
  const base = sttUrl.replace(/\/$/, "");
  // MediaRecorder tags blobs like "audio/webm;codecs=opus", but the server's
  // content-type allow-list matches the bare type ("audio/webm"). Strip the
  // codecs suffix and re-wrap as a File so the multipart part carries the clean
  // type the server accepts.
  const cleanType = (audio.type.split(";")[0] || "audio/webm").trim();
  const ext = cleanType.includes("ogg")
    ? "ogg"
    : cleanType.includes("wav")
      ? "wav"
      : cleanType.includes("mpeg") || cleanType.includes("mp3")
        ? "mp3"
        : "webm";
  const file = new File([audio], `speech.${ext}`, { type: cleanType });
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${base}/stt`, { method: "POST", body: form });
  } catch {
    throw new Error("Couldn't reach the speech-to-text server. Is it running and the tunnel up?");
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error("The speech-to-text tunnel is up but the local server didn't respond.");
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => (d as { detail?: string }).detail)
      .catch(() => undefined);
    throw new Error(detail ? `Speech-to-text: ${detail}` : `Speech-to-text failed (HTTP ${res.status}).`);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string };
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
