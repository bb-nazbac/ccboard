/**
 * Socket.IO client — single persistent connection with external store.
 * Components subscribe via useSyncExternalStore hooks.
 */

import { io, Socket } from "socket.io-client";
import { useSyncExternalStore, useCallback } from "react";
import type { Session, ContextInfo } from "../types/session";
import type { ChatMessage, SupervisorStatus } from "../types/api";
import type { ReviewCategory } from "../types/reports";
import type { ActionEvent, PaneEvent } from "../types/sse-events";
import { sseLog } from "../utils/logger";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface PaneState {
  status: "working" | "waiting" | "interactive";
  workingText: string;
  spinnerVerb: string;
  interactivePrompt: PaneEvent["interactivePrompt"];
}

interface Store {
  sessions: Session[];
  messages: Map<number, ChatMessage[]>;
  actions: Map<number, ActionEvent[]>;
  reviews: Map<number, ReviewCategory[]>;
  supervisorStatus: Map<number, SupervisorStatus>;
  supervisorMessages: Map<number, ChatMessage[]>;
  context: Map<number, ContextInfo>;
  pane: Map<number, PaneState>;
  connected: boolean;
  lastSeq: number;
}

const store: Store = {
  sessions: [],
  messages: new Map(),
  actions: new Map(),
  reviews: new Map(),
  supervisorStatus: new Map(),
  supervisorMessages: new Map(),
  context: new Map(),
  pane: new Map(),
  connected: false,
  lastSeq: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ---------------------------------------------------------------------------
// Event types from server
// ---------------------------------------------------------------------------

interface ActionEventData {
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
}

interface ReviewCategoryData {
  category: string;
  status: string;
  summary: string;
  findingCount: number;
  timestamp: string | null;
  isVerdict: boolean;
  report: Record<string, unknown>;
}

interface SupervisorStatusData {
  active: boolean;
  tmuxSession?: string;
  isWaiting?: boolean;
}

interface PaneStateData {
  status: "working" | "waiting" | "interactive";
  workingText: string;
  spinnerVerb: string;
  interactivePrompt: PaneEvent["interactivePrompt"];
}

type ServerEvent =
  | { type: "snapshot"; seq: number; sessions: Session[]; messages: Record<string, ChatMessage[]>; actions: Record<string, ActionEventData[]>; reviews: Record<string, ReviewCategoryData[]>; supervisorStatus: Record<string, SupervisorStatusData>; context: Record<string, ContextInfo>; supervisorMessages: Record<string, ChatMessage[]>; pane: Record<string, PaneStateData> }
  | { type: "sessions:update"; seq: number; sessions: Session[] }
  | { type: "messages:new"; seq: number; pid: number; messages: ChatMessage[] }
  | { type: "actions:new"; seq: number; pid: number; actions: ActionEventData[] }
  | { type: "reviews:update"; seq: number; pid: number; categories: ReviewCategoryData[] }
  | { type: "supervisor:status"; seq: number; pid: number; status: SupervisorStatusData }
  | { type: "supervisor:messages"; seq: number; pid: number; messages: ChatMessage[] }
  | { type: "context:update"; seq: number; pid: number; context: ContextInfo }
  | { type: "pane:update"; seq: number; pid: number; pane: PaneStateData };

// ---------------------------------------------------------------------------
// Helpers to convert server data to client types
// ---------------------------------------------------------------------------

function toActionEvent(a: ActionEventData): ActionEvent {
  return {
    type: "action",
    tool: a.tool,
    detail: a.detail,
    timestamp: a.timestamp,
    filePath: a.filePath,
    command: a.command,
    description: a.description,
    oldString: a.oldString,
    newString: a.newString,
    pattern: a.pattern,
    path: a.path,
  };
}

function toReviewCategory(r: ReviewCategoryData): ReviewCategory {
  return {
    category: r.category,
    status: r.status as ReviewCategory["status"],
    summary: r.summary,
    findingCount: r.findingCount,
    timestamp: r.timestamp,
    isVerdict: r.isVerdict,
    report: r.report as ReviewCategory["report"],
  };
}

function toSupervisorStatus(s: SupervisorStatusData): SupervisorStatus {
  return {
    active: s.active,
    tmuxSession: s.tmuxSession,
    isWaiting: s.isWaiting,
  };
}

function toPaneState(p: PaneStateData): PaneState {
  return {
    status: p.status,
    workingText: p.workingText,
    spinnerVerb: p.spinnerVerb,
    interactivePrompt: p.interactivePrompt,
  };
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

function handleEvent(event: ServerEvent): void {
  store.lastSeq = event.seq;

  switch (event.type) {
    case "snapshot": {
      store.sessions = event.sessions;
      store.messages = new Map();
      store.actions = new Map();
      store.reviews = new Map();
      store.supervisorStatus = new Map();
      store.supervisorMessages = new Map();
      store.context = new Map();
      store.pane = new Map();

      for (const [pidStr, msgs] of Object.entries(event.messages)) {
        store.messages.set(Number(pidStr), msgs);
      }
      for (const [pidStr, acts] of Object.entries(event.actions)) {
        store.actions.set(Number(pidStr), acts.map(toActionEvent));
      }
      for (const [pidStr, revs] of Object.entries(event.reviews)) {
        store.reviews.set(Number(pidStr), revs.map(toReviewCategory));
      }
      for (const [pidStr, ss] of Object.entries(event.supervisorStatus)) {
        store.supervisorStatus.set(Number(pidStr), toSupervisorStatus(ss));
      }
      for (const [pidStr, msgs] of Object.entries(event.supervisorMessages)) {
        store.supervisorMessages.set(Number(pidStr), msgs);
      }
      for (const [pidStr, ctx] of Object.entries(event.context)) {
        store.context.set(Number(pidStr), ctx);
      }
      for (const [pidStr, p] of Object.entries(event.pane)) {
        store.pane.set(Number(pidStr), toPaneState(p));
      }
      sseLog.info("snapshot received", { sessions: event.sessions.length });
      break;
    }
    case "sessions:update":
      store.sessions = event.sessions;
      break;
    case "messages:new": {
      const existing = store.messages.get(event.pid) ?? [];
      const merged = [...existing, ...event.messages].slice(-100);
      store.messages.set(event.pid, merged);
      break;
    }
    case "actions:new": {
      const existing = store.actions.get(event.pid) ?? [];
      const merged = [...existing, ...event.actions.map(toActionEvent)].slice(-500);
      store.actions.set(event.pid, merged);
      break;
    }
    case "reviews:update":
      store.reviews.set(event.pid, event.categories.map(toReviewCategory));
      break;
    case "supervisor:status":
      store.supervisorStatus.set(event.pid, toSupervisorStatus(event.status));
      break;
    case "supervisor:messages": {
      const existing = store.supervisorMessages.get(event.pid) ?? [];
      const merged = [...existing, ...event.messages].slice(-100);
      store.supervisorMessages.set(event.pid, merged);
      break;
    }
    case "context:update":
      store.context.set(event.pid, event.context);
      break;
    case "pane:update":
      store.pane.set(event.pid, toPaneState(event.pane));
      break;
  }

  notify();
}

// ---------------------------------------------------------------------------
// Socket.IO connection
// ---------------------------------------------------------------------------

let socket: Socket | null = null;

export function initSocket(): void {
  if (socket) return;

  const url = import.meta.env.DEV
    ? "http://localhost:3200"
    : window.location.origin;

  socket = io(url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on("connect", () => {
    sseLog.info("socket connected", socket?.id);
    store.connected = true;
    // Request replay if we have a previous sequence
    if (store.lastSeq > 0) {
      socket?.emit("request:replay", { since: store.lastSeq });
    }
    notify();
  });

  socket.on("disconnect", () => {
    sseLog.warn("socket disconnected");
    store.connected = false;
    notify();
  });

  socket.on("event", (data: ServerEvent) => {
    handleEvent(data);
  });
}

// ---------------------------------------------------------------------------
// React hooks (useSyncExternalStore)
// ---------------------------------------------------------------------------

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ACTIONS: ActionEvent[] = [];
const EMPTY_REVIEWS: ReviewCategory[] = [];

export function useSessions(): Session[] {
  return useSyncExternalStore(subscribe, () => store.sessions);
}

export function useMessages(pid: number): ChatMessage[] {
  const getSnapshot = useCallback(() => store.messages.get(pid) ?? EMPTY_MESSAGES, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useActions(pid: number): ActionEvent[] {
  const getSnapshot = useCallback(() => store.actions.get(pid) ?? EMPTY_ACTIONS, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useReviews(pid: number): ReviewCategory[] {
  const getSnapshot = useCallback(() => store.reviews.get(pid) ?? EMPTY_REVIEWS, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useContext(pid: number): ContextInfo | null {
  const getSnapshot = useCallback(() => store.context.get(pid) ?? null, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useSupervisorStatus(pid: number): SupervisorStatus | null {
  const getSnapshot = useCallback(() => store.supervisorStatus.get(pid) ?? null, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useSupervisorMessages(pid: number): ChatMessage[] {
  const getSnapshot = useCallback(() => store.supervisorMessages.get(pid) ?? EMPTY_MESSAGES, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function usePaneState(pid: number): PaneState | null {
  const getSnapshot = useCallback(() => store.pane.get(pid) ?? null, [pid]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useConnected(): boolean {
  return useSyncExternalStore(subscribe, () => store.connected);
}
