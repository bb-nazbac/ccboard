import { z } from "zod";

// --- Launch ---

export const LaunchRequestSchema = z.object({
  cwd: z.string(),
  resume: z.boolean().optional(),
  sessionId: z.string().optional(),
  name: z.string().optional(),
});
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>;

export const LaunchResponseSchema = z.object({
  ok: z.boolean(),
  agentTmux: z.string().optional(),
  supTmux: z.string().optional(),
  error: z.string().optional(),
});
export type LaunchResponse = z.infer<typeof LaunchResponseSchema>;

// --- Resumable sessions ---

export const ResumableSessionSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  shortName: z.string(),
  slug: z.string().nullable(),
  lastSnippet: z.string().nullable(),
  lastModified: z.number(),
});
export type ResumableSession = z.infer<typeof ResumableSessionSchema>;

// --- Send message ---

export const SendRequestSchema = z.object({
  message: z.string().min(1),
});
export type SendRequest = z.infer<typeof SendRequestSchema>;

export const SendResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type SendResponse = z.infer<typeof SendResponseSchema>;

// --- Supervisor status ---

export const SupervisorStatusSchema = z.object({
  active: z.boolean(),
  tmuxSession: z.string().optional(),
  isWaiting: z.boolean().optional(),
  latestOutput: z.unknown().nullable().optional(),
});
export type SupervisorStatus = z.infer<typeof SupervisorStatusSchema>;

// --- Chat messages ---

export const ChatMessageSchema = z.object({
  role: z.enum(["human", "assistant"]),
  text: z.string(),
  timestamp: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// --- Action turns ---

export const ToolActionSchema = z.object({
  type: z.enum(["tool_use", "assistant_text"]),
  tool: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.string().optional(),
  command: z.string().optional(),
  filePath: z.string().optional(),
  pattern: z.string().optional(),
  path: z.string().optional(),
  description: z.string().optional(),
  oldString: z.string().optional(),
  newString: z.string().optional(),
  agentType: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  input: z.string().optional(),
});
export type ToolAction = z.infer<typeof ToolActionSchema>;

export const ActionTurnSchema = z.object({
  humanMessage: z.string(),
  timestamp: z.string().optional(),
  actions: z.array(ToolActionSchema),
});
export type ActionTurn = z.infer<typeof ActionTurnSchema>;

// --- Diff ---

export const DiffResponseSchema = z.object({
  diff: z.string(),
  staged: z.string(),
});
export type DiffResponse = z.infer<typeof DiffResponseSchema>;
