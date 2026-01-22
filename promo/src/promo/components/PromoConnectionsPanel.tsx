import { useMemo } from "react";
import type { DashboardSession, FilesSession, Profile, ProfileGroup, TerminalSession } from "../types";

type Props = {
  groups: ProfileGroup[];
  profiles: Profile[];
  expandedGroupIds: string[];
  onToggleGroup: (groupId: string) => void;

  sessions: TerminalSession[];
  fileSessions: FilesSession[];
  dashboardSessions: DashboardSession[];

  activeSessionId: string | null;
  activeFileSessionId: string | null;
  activeDashboardSessionId: string | null;
  rightMode: "terminal" | "files" | "dashboard";

  onOpenTerminal: (profileId: string) => void;
  onOpenFiles: (profileId: string) => void;
  onOpenDashboard: (profileId: string) => void;

  onActivateTerminal: (sessionId: string) => void;
  onActivateFiles: (sessionId: string) => void;
  onActivateDashboard: (sessionId: string) => void;

  onCloseTerminal: (sessionId: string) => void;
  onCloseFiles: (sessionId: string) => void;
  onCloseDashboard: (sessionId: string) => void;
};

export function PromoConnectionsPanel({
  groups,
  profiles,
  expandedGroupIds,
  onToggleGroup,
  sessions,
  fileSessions,
  dashboardSessions,
  activeSessionId,
  activeFileSessionId,
  activeDashboardSessionId,
  rightMode,
  onOpenTerminal,
  onOpenFiles,
  onOpenDashboard,
  onActivateTerminal,
  onActivateFiles,
  onActivateDashboard,
  onCloseTerminal,
  onCloseFiles,
  onCloseDashboard,
}: Props) {
  const profilesByGroup = useMemo(() => {
    const m = new Map<string, Profile[]>();
    profiles.forEach((p) => {
      const arr = m.get(p.groupId) ?? [];
      arr.push(p);
      m.set(p.groupId, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [profiles]);

  const sessionsByProfile = useMemo(() => {
    const m = new Map<string, TerminalSession[]>();
    sessions.forEach((s) => {
      const arr = m.get(s.profileId) ?? [];
      arr.push(s);
      m.set(s.profileId, arr);
    });
    return m;
  }, [sessions]);

  const dashboardsByProfile = useMemo(() => {
    const m = new Map<string, DashboardSession>();
    dashboardSessions.forEach((s) => m.set(s.profileId, s));
    return m;
  }, [dashboardSessions]);

  return (
    <div className="connections panel">
      <div className="panel-titlebar">
        <div className="panel-title">Connections</div>
        <div className="panel-meta">demo mode</div>
      </div>

      <div className="connections-list">
        {groups.length === 0 ? (
          <div className="connections-empty">No groups yet.</div>
        ) : (
          groups
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((g) => {
              const expanded = expandedGroupIds.includes(g.id);
              const groupProfiles = profilesByGroup.get(g.id) ?? [];
              return (
                <div key={g.id} className="group">
                  <div className="group-header">
                    <button className="group-toggle" type="button" onClick={() => onToggleGroup(g.id)}>
                      {expanded ? "▾" : "▸"} {g.name}
                    </button>
                    <div className="group-actions">
                      <button className="btn btn-ghost" type="button" disabled>
                        Demo data
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="group-body">
                      {groupProfiles.length === 0 ? (
                        <div className="connections-empty">No profiles in this group.</div>
                      ) : (
                        groupProfiles.map((p) => {
                          const profSessions = sessionsByProfile.get(p.id) ?? [];
                          const profFileSessions = fileSessions.filter((s) => s.profileId === p.id);
                          const profDashboard = dashboardsByProfile.get(p.id) ?? null;

                          const hasActiveTerminal = rightMode === "terminal" && profSessions.some((s) => s.sessionId === activeSessionId);
                          const hasActiveFiles = rightMode === "files" && profFileSessions.some((s) => s.sessionId === activeFileSessionId);
                          const hasActiveDashboard =
                            rightMode === "dashboard" && profDashboard?.sessionId === activeDashboardSessionId;

                          const topMarker =
                            profSessions.find((s) => s.marker === "yellow")?.marker ??
                            profSessions.find((s) => s.marker === "green")?.marker ??
                            profSessions.find((s) => s.marker === "red")?.marker ??
                            (hasActiveFiles ? "blue" : hasActiveDashboard ? "purple" : "none");

                          return (
                            <div
                              key={p.id}
                              className={`profile ${hasActiveTerminal ? "active-terminal" : ""} ${hasActiveFiles ? "active-files" : ""} ${
                                hasActiveDashboard ? "active-dashboard" : ""
                              }`}
                            >
                              <div className="profile-row">
                                <div className="profile-main">
                                  <div className="profile-name">{p.name}</div>
                                  <div className="profile-sub">
                                    {p.username}@{p.host}:{p.port}
                                  </div>
                                </div>
                                <div className="profile-actions">
                                  <button className="btn" type="button" onClick={() => onOpenTerminal(p.id)}>
                                    Connect
                                  </button>
                                  <button className="btn" type="button" onClick={() => onOpenFiles(p.id)}>
                                    Files
                                  </button>
                                  <button className="btn" type="button" onClick={() => onOpenDashboard(p.id)}>
                                    Dashboard
                                  </button>
                                  <button className="btn btn-ghost" type="button" disabled>
                                    ⋯
                                  </button>
                                </div>
                                <span className={`marker marker-${topMarker} profile-marker`} title={topMarker} />
                              </div>

                              {profDashboard ? (
                                <div className="sessions">
                                  <div className="session">
                                    <button
                                      type="button"
                                      className={`session-btn dashboard ${
                                        rightMode === "dashboard" && profDashboard.sessionId === activeDashboardSessionId ? "active" : ""
                                      }`}
                                      onClick={() => onActivateDashboard(profDashboard.sessionId)}
                                    >
                                      <span className={`dot dot-${profDashboard.marker}`} />
                                      <span>
                                        {(profDashboard.icon ?? "📊") +
                                          " " +
                                          "Dashboard" +
                                          (profDashboard.ordinal > 1 ? ` ${profDashboard.ordinal}` : "")}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      className="session-close neutral"
                                      onClick={() => onCloseDashboard(profDashboard.sessionId)}
                                      title="Close dashboard session"
                                    >
                                      Close
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {profSessions.length > 0 ? (
                                <div className="sessions">
                                  {profSessions.map((s) => (
                                    <div key={s.sessionId} className="session">
                                      <button
                                        type="button"
                                        className={`session-btn ${rightMode === "terminal" && s.sessionId === activeSessionId ? "active" : ""}`}
                                        onClick={() => onActivateTerminal(s.sessionId)}
                                      >
                                        <span className={`dot dot-${s.marker}`} />
                                        <span>
                                          {(s.icon ?? "•") + " " + p.name + (profSessions.length > 1 ? ` ${s.ordinal ?? 1}` : "")}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="session-close neutral"
                                        onClick={() => onCloseTerminal(s.sessionId)}
                                        title="Close session"
                                      >
                                        Close
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {profFileSessions.length > 0 ? (
                                <div className="sessions">
                                  {profFileSessions.map((s) => (
                                    <div key={s.sessionId} className="session">
                                      <button
                                        type="button"
                                        className={`session-btn files ${rightMode === "files" && s.sessionId === activeFileSessionId ? "active" : ""}`}
                                        onClick={() => onActivateFiles(s.sessionId)}
                                      >
                                        <span className={`dot ${s.marker === "red" ? "dot-red" : "dot-files"}`} />
                                        <span className="session-files-label" title={s.remotePath ?? "."}>
                                          <span className="session-files-full">{(s.icon ?? "•") + " " + `Files: ${s.remotePath ?? "."}`}</span>
                                          <span className="session-files-tail">{(s.icon ?? "•") + " " + `Files: ${tailPath(s.remotePath ?? ".")}`}</span>
                                          <span className="session-files-tail-short">
                                            {(s.icon ?? "•") + " " + `Files: ${tailPath(s.remotePath ?? ".")}`}
                                          </span>
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="session-close neutral"
                                        onClick={() => onCloseFiles(s.sessionId)}
                                        title="Close files session"
                                      >
                                        Close
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}

function tailPath(p: string, max = 24) {
  const raw = String(p ?? "");
  if (!raw) return ".";
  if (raw.length <= max) return raw;
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0) return `…${raw.slice(-max)}`;
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length > max) break;
    out = next;
  }
  return `…/${out}`;
}
