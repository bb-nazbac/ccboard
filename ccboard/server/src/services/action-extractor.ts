import type { JsonlEntry, JsonlUserEntry, JsonlAssistantEntry } from "../schemas/jsonl.js";
import type { ToolAction, ActionTurn, ChatMessage } from "../schemas/api.js";
import type { ContextInfo } from "../schemas/session.js";

/**
 * Parse a single content block from an assistant message into a ToolAction.
 * Returns null for blocks that don't map to actions.
 */
export function parseToolAction(
  block: Record<string, unknown>,
  timestamp: string | undefined,
): ToolAction | null {
  if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
    return { type: "assistant_text", text: block.text.slice(0, 2000), timestamp };
  }
  if (block.type !== "tool_use") return null;

  const inp = (block.input ?? {}) as Record<string, unknown>;
  const toolName = block.name as string;
  const action: ToolAction = { type: "tool_use", tool: toolName, timestamp };

  switch (toolName) {
    case "Bash":
      action.command = typeof inp.command === "string" ? inp.command.slice(0, 500) : undefined;
      action.description = typeof inp.description === "string" ? inp.description : undefined;
      break;
    case "Read":
      action.filePath = typeof inp.file_path === "string" ? inp.file_path : undefined;
      break;
    case "Write":
      action.filePath = typeof inp.file_path === "string" ? inp.file_path : undefined;
      action.newString = typeof inp.content === "string" ? inp.content.slice(0, 1000) : undefined;
      break;
    case "Edit":
      action.filePath = typeof inp.file_path === "string" ? inp.file_path : undefined;
      action.oldString = typeof inp.old_string === "string" ? inp.old_string.slice(0, 1000) : undefined;
      action.newString = typeof inp.new_string === "string" ? inp.new_string.slice(0, 1000) : undefined;
      break;
    case "Glob":
      action.pattern = typeof inp.pattern === "string" ? inp.pattern : undefined;
      break;
    case "Grep":
      action.pattern = typeof inp.pattern === "string" ? inp.pattern : undefined;
      action.path = typeof inp.path === "string" ? inp.path : undefined;
      break;
    case "Agent":
      action.description = typeof inp.description === "string" ? inp.description : undefined;
      action.agentType = typeof inp.subagent_type === "string" ? inp.subagent_type : undefined;
      break;
    default:
      action.input = JSON.stringify(inp).slice(0, 300);
  }
  return action;
}

/**
 * Extract human-typed text from a JSONL user entry's message content.
 */
export function extractHumanText(entry: JsonlUserEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text: string } =>
        typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
      )
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

/**
 * Check if a message is supervisor noise (auto-generated status pings, JSON prompts, etc.).
 */
export function isSupervisorNoise(text: string | undefined | null): boolean {
  if (!text) return false;
  return (
    text.includes("pair-programming supervisor") ||
    text.includes("latest activity from the session you are supervising") ||
    text.includes("Provide your initial review as JSON") ||
    text.includes("Provide your updated review as JSON") ||
    /^\s*\{"summary"/.test(text)
  );
}

/**
 * Extract ALL actions grouped into turns by human message.
 * Each turn has the user prompt plus all tool calls / assistant text from the response.
 */
export function extractActionTurns(entries: JsonlEntry[]): ActionTurn[] {
  const turns: ActionTurn[] = [];
  let currentTurn: ActionTurn | null = null;

  for (const e of entries) {
    // Human message starts a new turn
    if (isHumanPrompt(e)) {
      const text = extractHumanText(e);
      if (!text.trim()) continue;
      if (isSupervisorNoise(text)) continue;
      currentTurn = {
        humanMessage: text.slice(0, 2000),
        timestamp: e.timestamp,
        actions: [],
      };
      turns.push(currentTurn);
    }

    // Assistant actions go into the current turn
    if (e.type === "assistant" && currentTurn) {
      const content = (e as JsonlAssistantEntry).message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const blockRec = block as Record<string, unknown>;
        if (blockRec.type === "text" && isSupervisorNoise(blockRec.text as string)) continue;
        const action = parseToolAction(blockRec, e.timestamp);
        if (action) currentTurn.actions.push(action);
      }
    }
  }

  return turns;
}

/**
 * Build a flat conversation message chain (human + assistant text only, no tool internals).
 */
export function extractMessageChain(entries: JsonlEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const e of entries) {
    // Human messages
    if (isHumanPrompt(e)) {
      const text = extractHumanText(e);
      if (!text.trim() || isSupervisorNoise(text)) continue;
      messages.push({ role: "human", text, timestamp: e.timestamp });
    }

    // Assistant text responses (not tool calls)
    if (e.type === "assistant") {
      const content = (e as JsonlAssistantEntry).message?.content;
      if (!Array.isArray(content)) continue;
      const textParts = content
        .filter((c): c is { type: string; text: string } => {
          const rec = c as Record<string, unknown>;
          return (
            rec.type === "text" &&
            typeof rec.text === "string" &&
            !!rec.text.trim() &&
            !isSupervisorNoise(rec.text as string)
          );
        })
        .map((c) => c.text);
      if (textParts.length > 0) {
        messages.push({
          role: "assistant",
          text: textParts.join("\n"),
          timestamp: e.timestamp,
        });
      }
    }
  }

  return messages;
}

/**
 * Extract context-window info (token usage, turn count, tool call count) from JSONL entries.
 */
export function extractContextInfo(entries: JsonlEntry[]): ContextInfo {
  let lastUsage: ContextInfo["lastUsage"] = null;
  let totalTurns = 0;
  let totalToolCalls = 0;

  // Find last usage from the most recent assistant entry
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.type !== "assistant") continue;
    const assistant = e as JsonlAssistantEntry;
    const usage = assistant.message?.usage;
    if (usage && !lastUsage) {
      lastUsage = {
        input_tokens: usage.input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
      };
    }
  }

  // Count turns and tool calls
  for (const e of entries) {
    if (isHumanPrompt(e)) {
      totalTurns++;
    }
    if (e.type === "assistant") {
      const content = (e as JsonlAssistantEntry).message?.content;
      if (Array.isArray(content)) {
        totalToolCalls += content.filter(
          (c) => (c as Record<string, unknown>).type === "tool_use",
        ).length;
      }
    }
  }

  const totalContextTokens = lastUsage
    ? (lastUsage.input_tokens ?? 0) +
      (lastUsage.cache_read_input_tokens ?? 0) +
      (lastUsage.cache_creation_input_tokens ?? 0)
    : 0;

  return {
    totalContextTokens,
    lastUsage,
    totalTurns,
    totalToolCalls,
    totalMessages: entries.length,
  };
}

// ---- helpers ----

/** Type guard: is this a human-typed prompt (not a tool result)? */
function isHumanPrompt(e: JsonlEntry): e is JsonlUserEntry {
  return (
    e.type === "user" &&
    !!(e as JsonlUserEntry).promptId &&
    !(e as JsonlUserEntry).sourceToolAssistantUUID
  );
}
