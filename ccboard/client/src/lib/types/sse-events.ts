export interface AgentMessageEvent {
  type: "message";
  role: "human" | "assistant";
  text: string;
  timestamp?: string;
}

export interface SupervisorMessageEvent {
  type: "message";
  role: "human" | "assistant";
  text: string;
  timestamp?: string;
}

export interface SupervisorStatusEvent {
  type: "status";
  isWaiting: boolean;
}

export interface ActionEvent {
  type: "action";
  tool: string;
  detail: string;
  timestamp?: string;
  filePath?: string;
  command?: string;
  description?: string;
  oldString?: string;
  newString?: string;
  pattern?: string;
  path?: string;
  // Agent tool
  prompt?: string;
  subagentType?: string;
  model?: string;
  // Grep extras
  glob?: string;
  outputMode?: string;
  // Read extras
  offset?: string;
  limit?: string;
}

export interface ThinkingEvent {
  type: "thinking";
  text: string;
  timestamp?: string;
}

export interface PaneEvent {
  type: "pane";
  status: "working" | "waiting" | "interactive";
  workingText?: string;
  spinnerVerb?: string;
  interactivePrompt?: {
    context: string;
    options: Array<{ number: string; text: string; isTextInput?: boolean }>;
  } | null;
}

export type ActionStreamEvent =
  | { type: "connected" }
  | ActionEvent
  | ThinkingEvent
  | { type: "status"; text: string }
  | { type: "agents"; text: string }
  | { type: "subagent"; text: string }
  | { type: "waiting" };

export type SupervisorStreamEvent =
  | { type: "connected" }
  | SupervisorMessageEvent
  | SupervisorStatusEvent;
