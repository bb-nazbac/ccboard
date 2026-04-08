import { z } from "zod";

export const ClaudeProcessSchema = z.object({
  pid: z.number(),
  stat: z.string(),
  cpu: z.number(),
  tty: z.string(),
});
export type ClaudeProcess = z.infer<typeof ClaudeProcessSchema>;

export const SessionStatusSchema = z.enum(["waiting", "working", "idle", "dead"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  shortName: z.string(),
  startedAt: z.number().optional(),
  lastActivity: z.number(),
  status: SessionStatusSchema,
  cpu: z.number(),
  tty: z.string(),
  snippet: z.string().nullable(),
  lastUserMessage: z.string().nullable(),
  slug: z.string().nullable(),
  managed: z.boolean(),
  tmuxSession: z.string().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionContextSchema = z.object({
  lastActivity: z.number().nullable(),
  snippet: z.string().nullable(),
  lastUserMessage: z.string().nullable(),
  slug: z.string().nullable(),
  isWaitingForUser: z.boolean(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const ContextInfoSchema = z.object({
  totalContextTokens: z.number(),
  lastUsage: z
    .object({
      input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .nullable(),
  totalTurns: z.number(),
  totalToolCalls: z.number(),
  totalMessages: z.number(),
});
export type ContextInfo = z.infer<typeof ContextInfoSchema>;
