export type SessionStatus = "waiting" | "working" | "idle" | "dead";

export interface Session {
  pid: number;
  sessionId: string;
  cwd: string;
  shortName: string;
  startedAt?: number;
  lastActivity: number;
  status: SessionStatus;
  cpu: number;
  tty: string;
  snippet: string | null;
  lastUserMessage: string | null;
  slug: string | null;
  managed: boolean;
  tmuxSession: string | null;
}

export interface ContextInfo {
  totalContextTokens: number;
  lastUsage: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  } | null;
  totalTurns: number;
  totalToolCalls: number;
  totalMessages: number;
}
