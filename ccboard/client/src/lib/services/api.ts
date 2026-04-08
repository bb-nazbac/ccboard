import type { Session } from "../types/session";
import type { ContextInfo } from "../types/session";
import type { ReviewCategory } from "../types/reports";
import type { ChatMessage, ActionTurn, ResumableSession, SupervisorStatus } from "../types/api";

const BASE = "";  // Vite proxy handles /api in dev; same origin in prod

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// --- Sessions ---
export const getSessions = () => get<Session[]>("/api/sessions");
export const getContext = (pid: number) => get<ContextInfo>(`/api/sessions/${pid}/context`);
export const getMessages = (pid: number) => get<ChatMessage[]>(`/api/sessions/${pid}/messages`);
export const getActions = (pid: number) => get<ActionTurn[]>(`/api/sessions/${pid}/actions`);
export const getFiles = (pid: number) => get<string[]>(`/api/sessions/${pid}/files`);
export const getDiff = (pid: number) => get<{ diff: string; staged: string }>(`/api/sessions/${pid}/diff`);
export const sendMessage = (pid: number, message: string) =>
  post<{ ok: boolean; error?: string }>(`/api/sessions/${pid}/send`, { message });

// --- Supervisor ---
export const getSupervisorStatus = (pid: number) =>
  get<SupervisorStatus>(`/api/sessions/${pid}/supervisor`);
export const getSupervisorMessages = (pid: number, limit?: number) =>
  get<ChatMessage[]>(`/api/sessions/${pid}/supervisor/messages${limit ? `?limit=${limit}` : ""}`);
export const sendSupervisorMessage = (pid: number, message: string) =>
  post<{ ok: boolean; error?: string }>(`/api/sessions/${pid}/supervisor/send`, { message });
export const startSupervisor = (pid: number) =>
  post<{ ok: boolean; tmuxSession?: string }>(`/api/sessions/${pid}/supervisor/start`, {});
export const stopSupervisor = (pid: number) =>
  post<{ ok: boolean }>(`/api/sessions/${pid}/supervisor/stop`, {});

// --- Reviews ---
export const getReviews = (pid: number) =>
  get<{ categories: ReviewCategory[] }>(`/api/sessions/${pid}/supervisor/reviews`);

// --- Launch ---
export const getResumable = () => get<ResumableSession[]>("/api/resumable");
export const launchSession = (cwd: string, opts?: { resume?: boolean; sessionId?: string; name?: string }) =>
  post<{ ok: boolean; agentTmux?: string; supTmux?: string; error?: string }>("/api/launch", { cwd, ...opts });
