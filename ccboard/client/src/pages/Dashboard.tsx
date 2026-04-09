import { useState, useEffect, useMemo, useCallback } from "react";
import type { Session as SessionType } from "../lib/types/session";
import type { ResumableSession } from "../lib/types/api";
import { getSessions, killSession, getResumable, launchSession } from "../lib/services/api";
import { apiLog, navLog } from "../lib/utils/logger";
import { timeAgo } from "../lib/utils/time";
import { Modal } from "../components/shared/Modal";

const STATUS_COLORS: Record<string, string> = {
  waiting: "var(--orange)",
  working: "var(--blue)",
  idle: "var(--text-dim)",
  dead: "var(--red-dim)",
};

export function Dashboard() {
  const [sessions, setSessions] = useState<SessionType[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumable, setResumable] = useState<ResumableSession[]>([]);
  const [newCwd, setNewCwd] = useState("");
  const [launching, setLaunching] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setSessions(await getSessions());
    } catch (err) { apiLog.warn("sessions fetch failed", err); }
  }, []);

  useEffect(() => {
    fetchSessions();
    const iv = setInterval(fetchSessions, 3000);
    return () => clearInterval(iv);
  }, [fetchSessions]);

  const summary = useMemo(() => ({
    waiting: sessions.filter((s) => s.status === "waiting").length,
    working: sessions.filter((s) => s.status === "working").length,
    idle: sessions.filter((s) => s.status === "idle").length,
  }), [sessions]);

  const handleKill = useCallback(async (e: React.MouseEvent, pid: number) => {
    e.stopPropagation();
    try { await killSession(pid); setSessions((p) => p.filter((s) => s.pid !== pid)); } catch (err) { apiLog.error("kill failed", err); }
  }, []);

  const openResumeModal = useCallback(async () => {
    try { setResumable(await getResumable()); } catch (err) { apiLog.error("resumable fetch failed", err); }
    setShowResumeModal(true);
  }, []);

  // Group resumable by project name
  const resumableGroups = useMemo(() => {
    const groups = new Map<string, { cwd: string; sessions: ResumableSession[] }>();
    for (const s of resumable) {
      const existing = groups.get(s.shortName);
      if (existing) { existing.sessions.push(s); }
      else { groups.set(s.shortName, { cwd: s.cwd, sessions: [s] }); }
    }
    return groups;
  }, [resumable]);

  const handleLaunchNew = useCallback(async () => {
    if (!newCwd.trim() || launching) return;
    setLaunching(true);
    try {
      const res = await launchSession(newCwd.trim());
      if (res.ok) { setShowNewModal(false); setNewCwd(""); fetchSessions(); }
      else { apiLog.error("launch failed", res.error); }
    } catch (err) { apiLog.error("launch error", err); }
    finally { setLaunching(false); }
  }, [newCwd, launching, fetchSessions]);

  const handleResume = useCallback(async (s: ResumableSession) => {
    setLaunching(true);
    try {
      const res = await launchSession(s.cwd, { resume: true, sessionId: s.sessionId });
      if (res.ok) { setShowResumeModal(false); fetchSessions(); }
      else { apiLog.error("resume failed", res.error); }
    } catch (err) { apiLog.error("resume error", err); }
    finally { setLaunching(false); }
  }, [fetchSessions]);

  const S: Record<string, React.CSSProperties> = {
    root: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
    header: { padding: "12px 24px", background: "var(--bg-header)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "12px" },
    logo: { fontFamily: "var(--font-heading)", fontSize: 20, letterSpacing: "0.15em", color: "var(--orange)", fontWeight: 700 },
    dot: { width: 8, height: 8, borderRadius: "50%", background: "var(--orange)", boxShadow: "0 0 8px var(--orange-glow)", animation: "pulse 2s infinite" },
    count: { fontFamily: "var(--font-data)", fontSize: 12, color: "var(--orange)", letterSpacing: "0.08em" },
    summaryWrap: { display: "flex", gap: 16, fontFamily: "var(--font-heading)", fontSize: 12, letterSpacing: "0.08em" },
    divider: { height: 1, margin: "0 24px", background: "linear-gradient(90deg, transparent, var(--border) 20%, var(--border) 80%, transparent)" },
    launchBar: { display: "flex", gap: 8, padding: "10px 24px" },
    btn: { fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase" as const, color: "var(--text-bright)", background: "var(--orange-faint)", border: "1px solid var(--border)", padding: "8px 20px", cursor: "pointer", transition: "all 0.15s" },
    list: { flex: 1, overflowY: "auto" as const, padding: "8px 24px", display: "flex", flexDirection: "column" as const, gap: 4 },
    card: { display: "flex", alignItems: "stretch", background: "var(--bg-panel)", border: "1px solid var(--border-neutral)", cursor: "pointer", transition: "all 0.15s" },
    cardBody: { flex: 1, padding: "14px 16px", minWidth: 0 },
    name: { fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 600, letterSpacing: "0.06em", color: "var(--text-bright)" },
    status: { fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" as const },
    cwd: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginBottom: 4 },
    snippet: { fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
    meta: { display: "flex", gap: 16, fontFamily: "var(--font-data)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.04em" },
    closeBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px", color: "var(--text-dim)", cursor: "pointer", transition: "all 0.15s", borderLeft: "1px solid var(--border-neutral)", fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.10em", fontWeight: 600 },
    empty: { textAlign: "center" as const, padding: 60, fontFamily: "var(--font-heading)", fontSize: 14, letterSpacing: "0.10em", color: "var(--text-dim)" },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.logo}>&#x2B22; CCBOARD</span>
        <div style={S.dot} />
        <span style={S.count}>{sessions.length} ACTIVE</span>
        <div style={{ flex: 1 }} />
        <div style={S.summaryWrap}>
          {summary.waiting > 0 && <span style={{ color: "var(--orange)" }}>{summary.waiting} WAITING</span>}
          {summary.working > 0 && <span style={{ color: "var(--blue)" }}>{summary.working} WORKING</span>}
          {summary.idle > 0 && <span style={{ color: "var(--text-dim)" }}>{summary.idle} IDLE</span>}
        </div>
      </div>

      {/* Launch bar */}
      <div style={S.launchBar}>
        <button style={S.btn} onClick={() => setShowNewModal(true)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--orange)"; e.currentTarget.style.boxShadow = "0 0 15px var(--orange-glow)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
        >+ NEW SESSION</button>
        <button style={S.btn} onClick={openResumeModal}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--orange)"; e.currentTarget.style.boxShadow = "0 0 15px var(--orange-glow)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
        >RESUME SESSION</button>
      </div>

      <div style={S.divider} />

      {/* Session cards */}
      <div style={S.list}>
        {sessions.length === 0 && <div style={S.empty}>NO ACTIVE SESSIONS DETECTED</div>}
        {sessions.map((s) => (
          <div key={s.pid} style={{ ...S.card, borderLeftWidth: 3, borderLeftColor: STATUS_COLORS[s.status] ?? "var(--text-dim)" }}
            onClick={() => { navLog.info("navigate", s.pid); window.location.href = `/session/${s.pid}`; }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-panel-hover)"; e.currentTarget.style.borderLeftColor = "var(--orange)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderLeftColor = STATUS_COLORS[s.status] ?? "var(--text-dim)"; }}
          >
            <div style={S.cardBody}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                <span style={S.name}>{s.shortName}</span>
                <span style={{ ...S.status, color: STATUS_COLORS[s.status] }}>{s.status}</span>
              </div>
              <div style={S.cwd}>{s.cwd}</div>
              {s.snippet && <div style={S.snippet}>{s.snippet}</div>}
              <div style={S.meta}>
                <span>PID {s.pid}</span>
                <span>TTY {s.tty}</span>
                <span>{timeAgo(s.lastActivity)}</span>
                {s.managed && <span style={{ color: "var(--orange-dim)", border: "1px solid var(--border)", padding: "0 4px", fontSize: 9, letterSpacing: "0.10em" }}>MANAGED</span>}
              </div>
            </div>
            <div style={S.closeBtn}
              onClick={(e) => handleKill(e, s.pid)}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--red-faint)"; e.currentTarget.style.color = "var(--red)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >CLOSE</div>
          </div>
        ))}
      </div>

      {/* New session modal */}
      <Modal open={showNewModal} onClose={() => setShowNewModal(false)} title="NEW SESSION">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontFamily: "var(--font-heading)", fontSize: 11, letterSpacing: "0.10em", color: "var(--text-dim)" }}>WORKING DIRECTORY</label>
          <input
            type="text" value={newCwd} onChange={e => setNewCwd(e.target.value)}
            placeholder="/Users/you/project"
            onKeyDown={e => { if (e.key === "Enter") handleLaunchNew(); }}
            style={{
              fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-bright)",
              background: "rgba(10,10,10,0.8)", border: "1px solid var(--border-neutral)",
              padding: "10px 12px", outline: "none",
            }}
          />
          <button onClick={handleLaunchNew} disabled={launching || !newCwd.trim()}
            style={{ ...S.btn, opacity: launching || !newCwd.trim() ? 0.4 : 1, alignSelf: "flex-end" }}
          >{launching ? "LAUNCHING..." : "LAUNCH"}</button>
        </div>
      </Modal>

      {/* Resume session modal */}
      <Modal open={showResumeModal} onClose={() => setShowResumeModal(false)} title="RESUME SESSION">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {resumableGroups.size === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "var(--font-heading)", fontSize: 12, color: "var(--text-dim)", letterSpacing: "0.08em" }}>
              NO RESUMABLE SESSIONS FOUND
            </div>
          )}
          {[...resumableGroups.entries()].map(([name, group]) => (
            <div key={name}>
              {/* Project header */}
              <div
                onClick={() => setExpandedProject(expandedProject === name ? null : name)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  background: "var(--bg-panel)", borderLeft: "3px solid var(--border-neutral)",
                  cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderLeftColor = "var(--orange-dim)"; e.currentTarget.style.background = "var(--bg-panel-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderLeftColor = "var(--border-neutral)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
              >
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", color: "var(--text-bright)" }}>{name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", flex: 1 }}>{group.cwd}</span>
                <span style={{ fontFamily: "var(--font-data)", fontSize: 10, color: "var(--text-dim)" }}>
                  {group.sessions.length} session{group.sessions.length > 1 ? "s" : ""}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{expandedProject === name ? "▾" : "▸"}</span>
              </div>

              {/* Expanded sessions */}
              {expandedProject === name && group.sessions.map((s) => (
                <div key={s.sessionId} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px 8px 24px",
                  background: "rgba(10,10,10,0.4)", borderLeft: "3px solid transparent",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--text)", marginBottom: 2 }}>
                      {s.slug ?? s.sessionId.slice(0, 8)}
                    </div>
                    {s.lastSnippet && (
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.lastSnippet}
                      </div>
                    )}
                    <div style={{ fontFamily: "var(--font-data)", fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>
                      {timeAgo(s.lastModified)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleResume(s)}
                    disabled={launching}
                    style={{ ...S.btn, fontSize: 10, padding: "5px 14px", opacity: launching ? 0.4 : 1 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--orange)"; e.currentTarget.style.boxShadow = "0 0 12px var(--orange-glow)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                  >RESUME</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Modal>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
