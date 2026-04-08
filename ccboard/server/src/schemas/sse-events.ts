import { z } from "zod";

// --- Agent message stream ---

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({
    type: z.literal("message"),
    role: z.enum(["human", "assistant"]),
    text: z.string(),
    timestamp: z.string().optional(),
  }),
]);
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

// --- Supervisor stream ---

export const SupervisorStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({
    type: z.literal("message"),
    role: z.enum(["human", "assistant"]),
    text: z.string(),
    timestamp: z.string().optional(),
  }),
  z.object({
    type: z.literal("status"),
    isWaiting: z.boolean(),
  }),
]);
export type SupervisorStreamEvent = z.infer<typeof SupervisorStreamEventSchema>;

// --- Action stream ---

export const ActionStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({
    type: z.literal("action"),
    tool: z.string(),
    detail: z.string(),
    timestamp: z.string().optional(),
    filePath: z.string().optional(),
    command: z.string().optional(),
    description: z.string().optional(),
    oldString: z.string().optional(),
    newString: z.string().optional(),
    pattern: z.string().optional(),
    path: z.string().optional(),
  }),
  z.object({ type: z.literal("thinking"), text: z.string(), timestamp: z.string().optional() }),
  z.object({ type: z.literal("status"), text: z.string() }),
  z.object({ type: z.literal("agents"), text: z.string() }),
  z.object({ type: z.literal("subagent"), text: z.string() }),
  z.object({ type: z.literal("waiting") }),
]);
export type ActionStreamEvent = z.infer<typeof ActionStreamEventSchema>;

// --- Pane stream ---

export const InteractiveOptionSchema = z.object({
  number: z.string(),
  text: z.string(),
  isTextInput: z.boolean().optional(),
});
export type InteractiveOption = z.infer<typeof InteractiveOptionSchema>;

export const InteractivePromptSchema = z.object({
  context: z.string(),
  options: z.array(InteractiveOptionSchema),
});
export type InteractivePrompt = z.infer<typeof InteractivePromptSchema>;

export const PaneStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({
    type: z.literal("pane"),
    status: z.enum(["working", "waiting", "interactive"]),
    workingText: z.string().optional(),
    spinnerVerb: z.string().optional(),
    interactivePrompt: InteractivePromptSchema.nullable().optional(),
  }),
]);
export type PaneStreamEvent = z.infer<typeof PaneStreamEventSchema>;
