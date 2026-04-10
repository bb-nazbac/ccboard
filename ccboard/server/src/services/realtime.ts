/**
 * Real-time WebSocket layer using Socket.IO.
 * Replaces the SSE polling model with a single persistent connection per client.
 */

import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { stat, open, readdir, readFile } from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import { createLogger } from "../lib/logger.js";
import { getSessions } from "./session-reader.js";
import { resolveActiveJsonl, resolveJsonlForPid } from "./jsonl-resolver.js";
import { readFullConversation, tailFile } from "./jsonl-parser.js";
import {
  extractActionTurns,
  extractMessageChain,
  extractContextInfo,
  isSupervisorNoise,
} from "./action-extractor.js";
import { isTmuxPaneWaiting } from "./tmux.js";
import { normaliseReport } from "./report-normaliser.js";
import {
  supervisors,
  reconnectSupervisor,
  resolveSupervisorJsonlPath,
  extractSupervisorMessages,
} from "./supervisor-manager.js";
import type { Session } from "../schemas/session.js";
import type { ContextInfo } from "../schemas/session.js";
import type { ChatMessage } from "../schemas/api.js";
import type { NormalisedReport } from "../schemas/reports.js";

const log = createLogger("realtime");

// ---------------------------------------------------------------------------
// Event types
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
  report: NormalisedReport;
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
  interactivePrompt: {
    context: string;
    options: Array<{ number: string; text: string; isTextInput?: boolean }>;
  } | null;
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
// In-memory state
// ---------------------------------------------------------------------------

let currentSessions: Session[] = [];
const messagesMap = new Map<number, ChatMessage[]>();
const actionsMap = new Map<number, ActionEventData[]>();
const reviewsMap = new Map<number, ReviewCategoryData[]>();
const supervisorStatusMap = new Map<number, SupervisorStatusData>();
const contextMap = new Map<number, ContextInfo>();
const supervisorMessagesMap = new Map<number, ChatMessage[]>();
const paneMap = new Map<number, PaneStateData>();

// Sequence counter + ring buffer for replay
let seqCounter = 0;
const RING_BUFFER_SIZE = 1000;
const ringBuffer: ServerEvent[] = [];

function nextSeq(): number {
  return ++seqCounter;
}

function pushEvent(event: ServerEvent): void {
  ringBuffer.push(event);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.splice(0, ringBuffer.length - RING_BUFFER_SIZE);
  }
}

// File byte tracking for JSONL tailing
const jsonlSizes = new Map<number, number>(); // pid -> last known file size
const jsonlPaths = new Map<number, string>();  // pid -> resolved JSONL path
const supJsonlSizes = new Map<number, number>();
const supJsonlPaths = new Map<number, string>();

// For pane dedup
const lastPaneKeys = new Map<number, string>();

// For reviews dedup - track report file mtimes
const lastReviewMtimes = new Map<number, string>(); // pid -> serialised mtimes

// ---------------------------------------------------------------------------
// Public accessors (for REST endpoints to read from in-memory state)
// ---------------------------------------------------------------------------

export function getRealtimeSessions(): Session[] {
  return currentSessions;
}

export function getRealtimeMessages(pid: number): ChatMessage[] {
  return messagesMap.get(pid) ?? [];
}

export function getRealtimeActions(pid: number): ActionEventData[] {
  return actionsMap.get(pid) ?? [];
}

export function getRealtimeReviews(pid: number): ReviewCategoryData[] {
  return reviewsMap.get(pid) ?? [];
}

export function getRealtimeContext(pid: number): ContextInfo | null {
  return contextMap.get(pid) ?? null;
}

export function getRealtimeSupervisorStatus(pid: number): SupervisorStatusData | null {
  return supervisorStatusMap.get(pid) ?? null;
}

export function getRealtimeSupervisorMessages(pid: number): ChatMessage[] {
  return supervisorMessagesMap.get(pid) ?? [];
}

// ---------------------------------------------------------------------------
// Socket.IO server
// ---------------------------------------------------------------------------

let io: SocketServer | null = null;

function broadcast(event: ServerEvent): void {
  pushEvent(event);
  io?.emit("event", event);
}

function buildSnapshot(): ServerEvent {
  const messages: Record<string, ChatMessage[]> = {};
  const actions: Record<string, ActionEventData[]> = {};
  const reviews: Record<string, ReviewCategoryData[]> = {};
  const supStatus: Record<string, SupervisorStatusData> = {};
  const context: Record<string, ContextInfo> = {};
  const supMessages: Record<string, ChatMessage[]> = {};
  const pane: Record<string, PaneStateData> = {};

  for (const s of currentSessions) {
    const pid = s.pid;
    const msgs = messagesMap.get(pid);
    if (msgs) messages[String(pid)] = msgs;
    const acts = actionsMap.get(pid);
    if (acts) actions[String(pid)] = acts;
    const revs = reviewsMap.get(pid);
    if (revs) reviews[String(pid)] = revs;
    const ss = supervisorStatusMap.get(pid);
    if (ss) supStatus[String(pid)] = ss;
    const ctx = contextMap.get(pid);
    if (ctx) context[String(pid)] = ctx;
    const sm = supervisorMessagesMap.get(pid);
    if (sm) supMessages[String(pid)] = sm;
    const p = paneMap.get(pid);
    if (p) pane[String(pid)] = p;
  }

  return {
    type: "snapshot",
    seq: nextSeq(),
    sessions: currentSessions,
    messages,
    actions,
    reviews,
    supervisorStatus: supStatus,
    context,
    supervisorMessages: supMessages,
    pane,
  };
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

/** Read new bytes from a file since lastSize, return parsed lines and new size */
async function readNewLines(filePath: string, lastSize: number): Promise<{ lines: string[]; newSize: number }> {
  const info = await stat(filePath);
  if (info.size <= lastSize) return { lines: [], newSize: lastSize };

  const fh = await open(filePath, "r");
  const buf = Buffer.alloc(info.size - lastSize);
  await fh.read(buf, 0, buf.length, lastSize);
  await fh.close();

  return {
    lines: buf.toString("utf-8").split("\n").filter((l) => l.trim()),
    newSize: info.size,
  };
}

/** Extract user text from a JSONL user entry */
function extractUserText(entry: Record<string, unknown>): string {
  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  return "";
}

/** Extract assistant text parts from a JSONL assistant entry */
function extractAssistantText(entry: Record<string, unknown>): string {
  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return "";
  const content = msg.content;
  if (!Array.isArray(content)) return "";
  const textParts = content
    .filter((c: Record<string, unknown>) => c.type === "text" && (c.text as string)?.trim())
    .map((c: Record<string, unknown>) => c.text as string);
  return textParts.join("\n");
}

// --- Sessions watcher (every 2s) ---

async function watchSessions(): Promise<void> {
  try {
    const sessions = await getSessions();
    const changed =
      sessions.length !== currentSessions.length ||
      sessions.some((s, i) => {
        const prev = currentSessions[i];
        return (
          !prev ||
          s.pid !== prev.pid ||
          s.status !== prev.status ||
          s.lastActivity !== prev.lastActivity ||
          s.snippet !== prev.snippet ||
          s.cpu !== prev.cpu
        );
      });

    if (changed) {
      currentSessions = sessions;
      const event: ServerEvent = {
        type: "sessions:update",
        seq: nextSeq(),
        sessions,
      };
      broadcast(event);
      log.debug({ count: sessions.length }, "sessions:update");
    }
  } catch (err) {
    log.error({ err }, "sessions watcher error");
  }
}

// --- JSONL watcher (messages + actions) per active session ---

async function watchJsonl(): Promise<void> {
  for (const session of currentSessions) {
    const pid = session.pid;
    try {
      // Resolve JSONL path if not cached
      if (!jsonlPaths.has(pid)) {
        const resolved = await resolveActiveJsonl(pid, session.cwd, session.sessionId);
        if (!resolved) continue;
        jsonlPaths.set(pid, resolved);

        // Initialise: load historical data
        const lines = await tailFile(resolved, 256 * 1024);
        const entries = lines.map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }).filter((e): e is Record<string, unknown> => e !== null);

        const msgChain = extractMessageChain(entries as import("../schemas/jsonl.js").JsonlEntry[]);
        messagesMap.set(pid, msgChain.slice(-100));

        const turns = extractActionTurns(entries as import("../schemas/jsonl.js").JsonlEntry[]);
        const flat: ActionEventData[] = [];
        for (const turn of turns.slice(-20)) {
          for (const a of turn.actions) {
            if (a.type === "tool_use" && a.tool) {
              flat.push({
                type: "action",
                tool: a.tool,
                detail: a.text ?? a.description ?? "",
                timestamp: a.timestamp,
                filePath: a.filePath,
                command: a.command,
                description: a.description,
                oldString: a.oldString,
                newString: a.newString,
                pattern: a.pattern,
                path: a.path,
              });
            }
          }
        }
        actionsMap.set(pid, flat.slice(-200));

        // Set initial file size
        try {
          const info = await stat(resolved);
          jsonlSizes.set(pid, info.size);
        } catch {
          jsonlSizes.set(pid, 0);
        }
        continue; // Don't process new lines on first pass
      }

      const jsonlPath = jsonlPaths.get(pid);
      if (!jsonlPath) continue;

      const lastSize = jsonlSizes.get(pid) ?? 0;
      const { lines, newSize } = await readNewLines(jsonlPath, lastSize);
      if (lines.length === 0) continue;
      jsonlSizes.set(pid, newSize);

      const newMessages: ChatMessage[] = [];
      const newActions: ActionEventData[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;

          // Messages
          if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
            const text = extractUserText(entry);
            if (text.trim() && !isSupervisorNoise(text)) {
              newMessages.push({ role: "human", text, timestamp: entry.timestamp as string | undefined });
            }
          }
          if (entry.type === "assistant") {
            const text = extractAssistantText(entry);
            if (text && !isSupervisorNoise(text)) {
              newMessages.push({ role: "assistant", text, timestamp: entry.timestamp as string | undefined });
            }

            // Actions
            const msg = entry.message as Record<string, unknown> | undefined;
            const content = msg?.content;
            if (Array.isArray(content)) {
              for (const block of content as Record<string, unknown>[]) {
                if (block.type === "tool_use") {
                  const inp = (block.input ?? {}) as Record<string, string>;
                  const name = block.name as string;
                  let detail = "";
                  switch (name) {
                    case "Bash": detail = inp.description ?? inp.command?.slice(0, 120) ?? ""; break;
                    case "Read": case "Write": case "Edit": detail = inp.file_path ?? ""; break;
                    case "Grep": detail = `/${inp.pattern ?? ""}/ ${inp.path ?? ""}`; break;
                    case "Glob": detail = inp.pattern ?? ""; break;
                    case "Agent": detail = inp.description ?? inp.prompt?.slice(0, 80) ?? ""; break;
                    default: detail = name;
                  }
                  const actionEvt: ActionEventData = {
                    type: "action", tool: name, detail, timestamp: entry.timestamp as string | undefined,
                  };
                  if (name === "Edit") { actionEvt.filePath = inp.file_path; actionEvt.oldString = inp.old_string?.slice(0, 2000); actionEvt.newString = inp.new_string?.slice(0, 2000); }
                  if (name === "Write") { actionEvt.filePath = inp.file_path; actionEvt.newString = inp.content?.slice(0, 2000); }
                  if (name === "Bash") { actionEvt.command = inp.command; actionEvt.description = inp.description; }
                  if (name === "Grep") { actionEvt.pattern = inp.pattern; actionEvt.path = inp.path; }
                  if (name === "Read") { actionEvt.filePath = inp.file_path; }
                  newActions.push(actionEvt);
                }
              }
            }
          }
        } catch {
          // skip malformed lines
        }
      }

      if (newMessages.length > 0) {
        const existing = messagesMap.get(pid) ?? [];
        const merged = [...existing, ...newMessages].slice(-100);
        messagesMap.set(pid, merged);
        broadcast({ type: "messages:new", seq: nextSeq(), pid, messages: newMessages });
        log.debug({ pid, count: newMessages.length }, "messages:new");
      }

      if (newActions.length > 0) {
        const existing = actionsMap.get(pid) ?? [];
        const merged = [...existing, ...newActions].slice(-200);
        actionsMap.set(pid, merged);
        broadcast({ type: "actions:new", seq: nextSeq(), pid, actions: newActions });
        log.debug({ pid, count: newActions.length }, "actions:new");
      }
    } catch {
      // skip errors for this session
    }
  }
}

// --- Context watcher (every 5s per session) ---

async function watchContext(): Promise<void> {
  for (const session of currentSessions) {
    const pid = session.pid;
    try {
      const jsonlPath = await resolveJsonlForPid(pid, session.cwd, session.sessionId);
      if (!jsonlPath) continue;

      const entries = await readFullConversation(jsonlPath);
      const ctx = extractContextInfo(entries);

      const prev = contextMap.get(pid);
      if (
        !prev ||
        prev.totalContextTokens !== ctx.totalContextTokens ||
        prev.totalTurns !== ctx.totalTurns ||
        prev.totalToolCalls !== ctx.totalToolCalls
      ) {
        contextMap.set(pid, ctx);
        broadcast({ type: "context:update", seq: nextSeq(), pid, context: ctx });
        log.debug({ pid, tokens: ctx.totalContextTokens }, "context:update");
      }
    } catch {
      // skip
    }
  }
}

// --- Reviews watcher (every 10s per managed session) ---

async function watchReviews(): Promise<void> {
  for (const session of currentSessions) {
    if (!session.managed) continue;
    const pid = session.pid;
    try {
      const reportsDir = join(session.cwd, ".ccboard", "reports");
      let dirs: string[];
      try {
        dirs = await readdir(reportsDir);
      } catch {
        continue; // no reports dir
      }

      // Check mtimes for changes
      const mtimes: string[] = [];
      for (const dir of dirs) {
        try {
          const info = await stat(join(reportsDir, dir, "latest.json"));
          mtimes.push(`${dir}:${info.mtimeMs}`);
        } catch {
          // skip
        }
      }
      const mtimeKey = mtimes.join("|");
      if (mtimeKey === lastReviewMtimes.get(pid)) continue;
      lastReviewMtimes.set(pid, mtimeKey);

      const categories: ReviewCategoryData[] = [];
      for (const dir of dirs) {
        try {
          const raw = JSON.parse(
            await readFile(join(reportsDir, dir, "latest.json"), "utf-8"),
          ) as Record<string, unknown>;
          if (!raw.category) raw.category = dir;
          const report = normaliseReport(raw);
          categories.push({
            category: report.category || dir,
            status: report.status,
            summary: report.summary,
            findingCount: Array.isArray(report.findings) ? report.findings.length : 0,
            timestamp: report.timestamp || null,
            isVerdict: dir === "council-verdict" || report.category === "council-verdict",
            report,
          });
        } catch {
          // skip
        }
      }

      // Sort: verdict first, then alphabetical
      categories.sort((a, b) => {
        if (a.isVerdict && !b.isVerdict) return -1;
        if (!a.isVerdict && b.isVerdict) return 1;
        return (a.category || "").localeCompare(b.category || "");
      });

      reviewsMap.set(pid, categories);
      broadcast({ type: "reviews:update", seq: nextSeq(), pid, categories });
      log.debug({ pid, count: categories.length }, "reviews:update");
    } catch {
      // skip
    }
  }
}

// --- Supervisor watcher (messages + status) ---

async function watchSupervisors(): Promise<void> {
  for (const session of currentSessions) {
    if (!session.managed) continue;
    const pid = session.pid;
    try {
      // Check supervisor status
      let sup = supervisors.get(pid) ?? undefined;
      if (!sup) {
        sup = (await reconnectSupervisor(pid, session)) ?? undefined;
      }

      const statusData: SupervisorStatusData = {
        active: !!sup,
        tmuxSession: sup?.tmuxSession,
        isWaiting: sup ? isTmuxPaneWaiting(sup.tmuxSession) : undefined,
      };

      const prevStatus = supervisorStatusMap.get(pid);
      if (
        !prevStatus ||
        prevStatus.active !== statusData.active ||
        prevStatus.isWaiting !== statusData.isWaiting
      ) {
        supervisorStatusMap.set(pid, statusData);
        broadcast({ type: "supervisor:status", seq: nextSeq(), pid, status: statusData });
        log.debug({ pid, active: statusData.active, waiting: statusData.isWaiting }, "supervisor:status");
      }

      if (!sup) continue;

      // Watch supervisor JSONL for messages
      if (!supJsonlPaths.has(pid)) {
        const supPath = await resolveSupervisorJsonlPath(session.cwd, sup.tmuxSession);
        if (!supPath) continue;
        supJsonlPaths.set(pid, supPath);

        // Load initial messages
        try {
          const raw = await readFile(supPath, "utf-8");
          const msgs = extractSupervisorMessages(raw, 50);
          supervisorMessagesMap.set(pid, msgs);
          const info = await stat(supPath);
          supJsonlSizes.set(pid, info.size);
        } catch {
          supJsonlSizes.set(pid, 0);
        }
        continue;
      }

      const supPath = supJsonlPaths.get(pid);
      if (!supPath) continue;

      const lastSize = supJsonlSizes.get(pid) ?? 0;
      const { lines, newSize } = await readNewLines(supPath, lastSize);
      if (lines.length === 0) continue;
      supJsonlSizes.set(pid, newSize);

      const newMessages: ChatMessage[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
            const text = extractUserText(entry);
            if (text.trim()) newMessages.push({ role: "human", text, timestamp: entry.timestamp as string | undefined });
          }
          if (entry.type === "assistant") {
            const text = extractAssistantText(entry);
            if (text) newMessages.push({ role: "assistant", text, timestamp: entry.timestamp as string | undefined });
          }
        } catch {
          // skip
        }
      }

      if (newMessages.length > 0) {
        const existing = supervisorMessagesMap.get(pid) ?? [];
        const merged = [...existing, ...newMessages].slice(-100);
        supervisorMessagesMap.set(pid, merged);
        broadcast({ type: "supervisor:messages", seq: nextSeq(), pid, messages: newMessages });
        log.debug({ pid, count: newMessages.length }, "supervisor:messages");
      }
    } catch {
      // skip
    }
  }
}

// --- Pane watcher (tmux capture for live status) ---

function watchPanes(): void {
  for (const session of currentSessions) {
    if (!session.managed || !session.tmuxSession) continue;
    const pid = session.pid;
    const tmux = session.tmuxSession;
    try {
      const paneRaw = execSync(`tmux capture-pane -t ${tmux} -p -S -50 2>/dev/null`, { encoding: "utf-8" });
      const lines = paneRaw.split("\n");

      // Detect interactive prompts
      interface PromptLine { number: string; text: string; isTextInput?: boolean }
      const promptLines: PromptLine[] = [];
      let inPrompt = false;
      for (const line of lines) {
        if (line.match(/^\s*❯\s+\d+\.\s/) || (inPrompt && line.match(/^\s+\d+\.\s/))) {
          inPrompt = true;
          const match = line.match(/(\d+)\.\s+(.+)/);
          if (match?.[1] && match[2]) {
            const isTextInput = /Type here/i.test(match[2]);
            promptLines.push({ number: match[1], text: match[2].trim(), isTextInput });
          }
        }
        if (inPrompt && line.trim() === "" && promptLines.length > 0) inPrompt = false;
      }

      let interactivePrompt: PaneStateData["interactivePrompt"] = null;
      if (promptLines.length >= 2) {
        let promptContext = "";
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.match(/❯\s+\d+\./)) {
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              const ctx = lines[j]?.trim();
              if (ctx && !ctx.match(/^[─━]+$/) && !ctx.match(/^⏺/)) {
                promptContext = ctx;
                break;
              }
            }
            break;
          }
        }
        interactivePrompt = { context: promptContext, options: promptLines };
      }

      const hasPrompt = lines.some((l) => l.trim() === "❯" || (l.includes("❯") && !l.match(/❯\s+\d+\./)));
      const status: PaneStateData["status"] = interactivePrompt ? "interactive" : hasPrompt ? "waiting" : "working";

      let workingText = "";
      let spinnerVerb = "";

      if (status === "working") {
        let startIdx = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i]?.includes("⏺")) { startIdx = i; break; }
        }
        const outputLines: string[] = [];
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (line.includes("bypass permissions") || line.includes("Auto-update failed")) continue;
          if (line.match(/^[─━]+$/)) continue;
          outputLines.push(line);
        }
        workingText = outputLines.join("\n").trim();

        for (let i = lines.length - 1; i >= 0; i--) {
          const line = (lines[i] ?? "").trim();
          if (line.startsWith("⏵") || line.startsWith("✻") || line.match(/^[A-Z][a-z]+ing\s/)) {
            spinnerVerb = line;
            break;
          }
        }
      }

      const paneState: PaneStateData = {
        status,
        workingText: workingText.slice(-2000),
        spinnerVerb,
        interactivePrompt,
      };

      const contentKey = status + "|" + workingText.slice(-200) + "|" + spinnerVerb + "|" + JSON.stringify(interactivePrompt);
      if (contentKey !== lastPaneKeys.get(pid)) {
        lastPaneKeys.set(pid, contentKey);
        paneMap.set(pid, paneState);
        broadcast({ type: "pane:update", seq: nextSeq(), pid, pane: paneState });
      }
    } catch {
      // skip
    }
  }
}

// --- Cleanup stale PIDs ---

function cleanupStalePids(): void {
  const activePids = new Set(currentSessions.map(s => s.pid));

  for (const pid of jsonlPaths.keys()) {
    if (!activePids.has(pid)) {
      jsonlPaths.delete(pid);
      jsonlSizes.delete(pid);
      messagesMap.delete(pid);
      actionsMap.delete(pid);
      contextMap.delete(pid);
      lastPaneKeys.delete(pid);
      paneMap.delete(pid);
      lastReviewMtimes.delete(pid);
      supJsonlPaths.delete(pid);
      supJsonlSizes.delete(pid);
      supervisorMessagesMap.delete(pid);
      supervisorStatusMap.delete(pid);
      reviewsMap.delete(pid);
    }
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const intervals: ReturnType<typeof setInterval>[] = [];

export function initRealtime(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
    },
    // Increase buffer for large snapshots
    maxHttpBufferSize: 5e6,
  });

  log.info("Socket.IO server initialised");

  io.on("connection", (socket) => {
    log.info({ id: socket.id }, "client connected");

    // Send full snapshot on connect
    const snapshot = buildSnapshot();
    socket.emit("event", snapshot);
    log.debug({ id: socket.id, seq: snapshot.seq }, "snapshot sent");

    // Handle replay requests
    socket.on("request:replay", (data: { since: number }) => {
      const since = data.since;
      log.info({ id: socket.id, since }, "replay requested");

      // Check if we can replay from ring buffer
      const oldest = ringBuffer.length > 0 ? ringBuffer[0]?.seq ?? 0 : 0;
      if (since < oldest || ringBuffer.length === 0) {
        // Gap too large -- send full snapshot
        const snap = buildSnapshot();
        socket.emit("event", snap);
        log.info({ id: socket.id, reason: "gap too large" }, "full snapshot sent instead of replay");
        return;
      }

      // Replay events since the given sequence number
      const events = ringBuffer.filter(e => e.seq > since);
      for (const event of events) {
        socket.emit("event", event);
      }
      log.info({ id: socket.id, replayed: events.length }, "replay complete");
    });

    socket.on("disconnect", (reason) => {
      log.info({ id: socket.id, reason }, "client disconnected");
    });
  });

  // Start watchers
  intervals.push(setInterval(() => { void watchSessions(); }, 2000));
  intervals.push(setInterval(() => { void watchJsonl(); }, 1000));
  intervals.push(setInterval(() => { void watchContext(); }, 5000));
  intervals.push(setInterval(() => { void watchReviews(); }, 10000));
  intervals.push(setInterval(() => { void watchSupervisors(); }, 2000));
  intervals.push(setInterval(() => { watchPanes(); }, 500));
  intervals.push(setInterval(() => { cleanupStalePids(); }, 10000));

  // Initial load
  void watchSessions();

  return io;
}
