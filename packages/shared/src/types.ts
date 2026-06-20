/**
 * Shared domain model for the second brain.
 *
 * The graph (Cloudflare D1) is a fast, rebuildable index over the markdown wiki.
 * These types describe both the graph entities and the wire contracts exchanged
 * between the static frontend and the Cloudflare Worker backend.
 *
 * @packageDocumentation
 */

/**
 * Kind of a knowledge node. Kept as a string union with an open fallback so the
 * agents can introduce new entity kinds without a code change, while common kinds
 * stay strongly typed for editor autocomplete.
 */
export type NodeType =
  | "person"
  | "project"
  | "concept"
  | "journal"
  | "archive"
  | (string & {});

/** Kind of a directed relationship between two nodes. */
export type EdgeType =
  | "relates_to"
  | "part_of"
  | "mentions"
  | "depends_on"
  | "authored_by"
  | (string & {});

/** A single knowledge node — one row in D1 `nodes`, one markdown file on `brain`. */
export interface BrainNode {
  /** Stable id, also stored in the markdown frontmatter. */
  id: string;
  type: NodeType;
  title: string;
  /** Path of the backing markdown file on the `brain` branch. */
  mdPath: string;
  /** One-line description shown in the graph index; full detail lives in markdown. */
  summary: string;
  /** How many times this node has been retrieved; drives archival. */
  refCount: number;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of last access; drives archival. */
  lastAccessed?: string | undefined;
  archived: boolean;
}

/** A typed, directed edge between two nodes — one row in D1 `edges`. */
export interface BrainEdge {
  id: string;
  src: string;
  dst: string;
  type: EdgeType;
  weight: number;
}

/** The neighbor of a node returned during 1-hop graph expansion. */
export interface NeighborRef {
  id: string;
  type: NodeType;
  edge: EdgeType;
}

/**
 * A retrieval hit. Search returns **summaries only** (no markdown bodies) so the
 * agent must make a deliberate second `read_markdown` call for the few it needs.
 */
export interface SearchResult {
  id: string;
  type: NodeType;
  title: string;
  summary: string;
  mdPath: string;
  /** BM25 relevance score from D1 FTS5 (higher = better). */
  score: number;
  neighbors: NeighborRef[];
}

/** The full content of a node, including parsed frontmatter. */
export interface NodeDocument {
  id: string;
  mdPath: string;
  /** Markdown body below the frontmatter. */
  body: string;
  frontmatter: NodeFrontmatter;
}

/** YAML frontmatter mirrored into every markdown file so D1 is rebuildable. */
export interface NodeFrontmatter {
  id: string;
  type: NodeType;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  edges?: Array<{ to: string; type: EdgeType }>;
}

/** A single write requested by the brain agent (batched into one git commit). */
export interface BrainWrite {
  /** Omit to create a new node (server assigns an id). */
  id?: string;
  type: NodeType;
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  edges?: Array<{ to: string; type: EdgeType }>;
}

/** Result of applying a batch of writes. */
export interface WriteResult {
  /** SHA of the single commit produced for the whole batch. */
  commitSha: string;
  results: Array<{ id: string; path: string; action: "created" | "updated" }>;
}

/** A consolidation operation proposed by the consolidator (dry-run before apply). */
export type ConsolidationOp =
  | { op: "merge"; survivor: string; absorbed: string; reason: string }
  | { op: "link"; src: string; dst: string; type: EdgeType; reason: string }
  | { op: "trash"; id: string; reason: string };

/** Outcome of a consolidation pass over a touched subgraph. */
export interface ConsolidationResult {
  plan: ConsolidationOp[];
  applied: ConsolidationOp[];
  /** Ops a validator rejected or deferred to the monthly job. */
  deferred: ConsolidationOp[];
}

/* ------------------------------------------------------------------ */
/* Wire contracts: frontend <-> worker                                 */
/* ------------------------------------------------------------------ */

/** Which LLM provider a turn should use. */
export type ProviderChoice = "copilot" | "lmstudio";

/** LM Studio connection details supplied by the user per request (never stored). */
export interface LmStudioConfig {
  /** Devtunnel URL of the local LM Studio OpenAI-compatible endpoint. */
  baseUrl: string;
  /** Optional API key; sent over TLS, never logged or persisted. */
  key?: string;
  /** Model id to request. */
  model: string;
}

/** Request body for a chat turn. */
export interface ChatTurnRequest {
  message: string;
  provider: ProviderChoice;
  /** Copilot model id (ignored when provider is lmstudio). */
  model?: string;
  lmStudio?: LmStudioConfig;
  /**
   * Optional image attachments for vision-capable models. `data` is raw base64
   * (no `data:` URL prefix); ignored by the worker when the chosen model does not
   * advertise vision support.
   */
  images?: ChatImage[];
  /** Conversation id; the turn is appended to this chat's history on the brain. */
  chatId?: string;
  /** Resume token from a previous partial turn (budget checkpoint). */
  resumeToken?: string;
}

/** A single image attachment sent with a chat turn. */
export interface ChatImage {
  /** Raw base64-encoded image bytes (no `data:` prefix). */
  data: string;
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
}

/** Per-turn budget/observability counters surfaced to the UI. */
export interface TurnMetrics {
  subrequestsUsed: number;
  llmCalls: number;
  gitCalls: number;
  d1Calls: number;
  dirtySetSize: number;
  /** Number of tools available to the brain this turn (core + MCP). */
  toolsEnabled?: number;
  /** Number of skills loaded for the brain this turn. */
  skillsEnabled?: number;
}

/** One step in the agent trace shown in the UI. */
export interface TraceEvent {
  agent: "brain" | "consolidator";
  tool?: string;
  detail: string;
  at: string;
}

/** Server-sent event payloads streamed to the frontend during a turn. */
export type TurnStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "trace"; event: TraceEvent }
  | { type: "metrics"; metrics: TurnMetrics }
  | { type: "partial"; resumeToken: string; metrics: TurnMetrics }
  | { type: "error"; code: string; message: string }
  | { type: "done"; metrics: TurnMetrics };

/** The authenticated owner session returned after GitHub OAuth. */
export interface SessionInfo {
  login: string;
  avatarUrl: string;
}

/** A Copilot model the UI can offer. */
export interface CopilotModelInfo {
  id: string;
  name: string;
}

/** Response of the worker `/models` endpoint. */
export interface ModelsResponse {
  models: CopilotModelInfo[];
  default: string;
}

/* ------------------------------------------------------------------ */
/* Provider connection test + brain config (UI-editable MCP / skills)  */
/* ------------------------------------------------------------------ */

/** Result of a provider connectivity test (`POST /provider/test`). */
export interface ProviderTestResult {
  ok: boolean;
  /** Human-friendly explanation when `ok` is false. */
  error?: string;
}

/** A remote MCP server exposed to the brain agent. */
export interface McpServerConfig {
  /** Stable id; namespaces the server's tools. */
  id: string;
  /** Remote MCP HTTPS endpoint. */
  url: string;
  /** Whether the server's tools are enabled. Defaults to true. */
  enabled?: boolean;
}

/** A skill bundle (name + description + markdown body). */
export interface BrainSkill {
  name: string;
  description: string;
  content: string;
}

/** The brain config returned by `GET /config`. */
export interface BrainConfigDto {
  mcpServers: McpServerConfig[];
  skills: BrainSkill[];
}

/** A config edit submitted via `POST /config` (and the `write_config` tool). */
export interface BrainConfigUpdate {
  /** Full replacement list for `mcp.json` (omit to leave MCP servers unchanged). */
  mcpServers?: McpServerConfig[];
  /** Skills to create or overwrite. */
  upsertSkills?: BrainSkill[];
  /** Skill names to delete. */
  deleteSkills?: string[];
}

/** Result of applying a config edit. */
export interface BrainConfigUpdateResult {
  commitSha: string;
  changed: string[];
}

/* ------------------------------------------------------------------ */
/* Chat history (stored on the brain branch, not indexed in D1/FTS)    */
/* ------------------------------------------------------------------ */

/** A stored chat message, including the agent trace + metrics for assistant turns. */
export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Reasoning/thinking text for assistant turns (if the model emitted any). */
  reasoning?: string;
  /** Agent activity (tool calls with inputs/outputs) for the assistant turn. */
  trace?: TraceEvent[];
  /** Per-turn metrics for the assistant turn. */
  metrics?: TurnMetrics;
}

/** A full stored conversation on the brain branch (`chats/<id>.json`). */
export interface ChatRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
}

/** A lightweight chat summary for the history list (`chats/index.json`). */
export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Response of `GET /chats`. */
export interface ChatListResponse {
  chats: ChatSummary[];
}

/** Response of `GET /chat/status?chatId=…` — whether a turn is still running. */
export interface TurnStatusResponse {
  running: boolean;
}
