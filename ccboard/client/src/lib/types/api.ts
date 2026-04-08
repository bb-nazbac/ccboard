export interface ChatMessage {
  role: "human" | "assistant";
  text: string;
  timestamp?: string;
}

export interface ToolAction {
  type: "tool_use" | "assistant_text";
  tool?: string;
  text?: string;
  timestamp?: string;
  command?: string;
  filePath?: string;
  pattern?: string;
  path?: string;
  description?: string;
  oldString?: string;
  newString?: string;
  agentType?: string;
  input?: string;
}

export interface ActionTurn {
  humanMessage: string;
  timestamp?: string;
  actions: ToolAction[];
}

export interface ResumableSession {
  sessionId: string;
  cwd: string;
  shortName: string;
  slug: string | null;
  lastSnippet: string | null;
  lastModified: number;
}

export interface SupervisorStatus {
  active: boolean;
  tmuxSession?: string;
  isWaiting?: boolean;
}
