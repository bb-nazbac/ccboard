import { z } from "zod";

export const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    name: z.string(),
    input: z.record(z.unknown()),
    id: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().optional(),
    content: z.unknown(),
  }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const UsageSchema = z.object({
  input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const JsonlUserEntrySchema = z.object({
  type: z.literal("user"),
  promptId: z.string().optional(),
  sourceToolAssistantUUID: z.string().optional(),
  message: z.object({
    content: z.union([z.string(), z.array(z.unknown())]),
  }),
  timestamp: z.string().optional(),
  slug: z.string().optional(),
  uuid: z.string().optional(),
});
export type JsonlUserEntry = z.infer<typeof JsonlUserEntrySchema>;

export const JsonlAssistantEntrySchema = z.object({
  type: z.literal("assistant"),
  message: z.object({
    content: z.array(z.unknown()),
    usage: UsageSchema.optional(),
  }),
  timestamp: z.string().optional(),
  uuid: z.string().optional(),
});
export type JsonlAssistantEntry = z.infer<typeof JsonlAssistantEntrySchema>;

export const JsonlSystemEntrySchema = z.object({
  type: z.literal("system"),
  subtype: z.string().optional(),
  timestamp: z.string().optional(),
});
export type JsonlSystemEntry = z.infer<typeof JsonlSystemEntrySchema>;

/** Any JSONL entry — use type narrowing on the `type` field */
export type JsonlEntry = JsonlUserEntry | JsonlAssistantEntry | JsonlSystemEntry;
