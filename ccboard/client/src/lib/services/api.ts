import type { Session } from "../types/session";
import type { ContextInfo } from "../types/session";
import type { ReviewCategory } from "../types/reports";
import type { ChatMessage, ActionTurn, ResumableSession, SupervisorStatus } from "../types/api";
import { apiLog } from "../utils/logger";

async function get<T>(path: string): Promise<T> {
  apiLog.debug("GET", path);
  const res = await fetch(path);
  if (!res.ok) { apiLog.error("GET failed", path, res.status); throw new Error(`GET ${path}: ${res.status}`); }
  const data = await res.json() as T;
  apiLog.debug("GET done", path);
  return data;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  apiLog.debug("POST", path, body);
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { apiLog.error("POST failed", path, res.status); throw new Error(`POST ${path}: ${res.status}`); }
  return res.json() as Promise<T>;
}

export const getSessions = () => get<Session[]>("/api/sessions");
export const getContext = (pid: number) => get<ContextInfo>(`/api/sessions/${pid}/context`);
export const getMessages = (pid: number, limit = 100) => get<ChatMessage[]>(`/api/sessions/${pid}/messages?limit=${limit}`);
export const getActions = (pid: number, limit = 20) => get<ActionTurn[]>(`/api/sessions/${pid}/actions?limit=${limit}`);
export const getDiff = (pid: number) => get<{ diff: string; staged: string }>(`/api/sessions/${pid}/diff`);
export const sendMessage = (pid: number, message: string) =>
  post<{ ok: boolean; error?: string }>(`/api/sessions/${pid}/send`, { message });
export const killSession = (pid: number) =>
  post<{ ok: boolean; error?: string }>(`/api/sessions/${pid}/kill`, {});

export const getSupervisorStatus = (pid: number) => get<SupervisorStatus>(`/api/sessions/${pid}/supervisor`);
export const getSupervisorMessages = (pid: number, limit?: number) =>
  get<ChatMessage[]>(`/api/sessions/${pid}/supervisor/messages${limit ? `?limit=${limit}` : ""}`);
export const sendSupervisorMessage = (pid: number, message: string) =>
  post<{ ok: boolean; error?: string }>(`/api/sessions/${pid}/supervisor/send`, { message });
export const startSupervisor = (pid: number) =>
  post<{ ok: boolean; tmuxSession?: string }>(`/api/sessions/${pid}/supervisor/start`, {});

export const getReviews = (pid: number) =>
  get<{ categories: ReviewCategory[] }>(`/api/sessions/${pid}/supervisor/reviews`);

export const getResumable = () => get<ResumableSession[]>("/api/resumable");
export const launchSession = (cwd: string, opts?: { resume?: boolean; sessionId?: string }) =>
  post<{ ok: boolean; error?: string }>("/api/launch", { cwd, ...opts });
