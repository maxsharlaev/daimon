import { useMemo } from "react";
import type { ProfileDTO } from "../types/models";
import { TerminalPanel } from "./TerminalPanel";
import "./terminaltabs.css";

export type SessionMarker = "green" | "red" | "yellow" | "none";

export type TerminalSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  marker: SessionMarker;
  taskRunning?: boolean;
  lastError?: string | null;
};

type Props = {
  profiles: ProfileDTO[];
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export function TerminalTabs({
  profiles,
  sessions,
  activeSessionId,
  onActivate,
  onClose,
}: Props) {
  const byProfile = useMemo(() => {
    const m = new Map<string, ProfileDTO>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const countsByProfile = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => m.set(s.profileId, (m.get(s.profileId) ?? 0) + 1));
    return m;
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Terminal</div>
          <div className="panel-meta">no active sessions</div>
        </div>
        <div className="empty">
          Create or select a profile on the left and click Connect.
        </div>
      </div>
    );
  }

  const active = sessions.find((s) => s.sessionId === activeSessionId) ?? sessions[0];

  return (
    <div className="terminaltabs">
      <div className="terminaltabs-bar">
        {sessions.map((s) => {
          const isActive = s.sessionId === active.sessionId;
          const prof = byProfile.get(s.profileId);
          const multi = (countsByProfile.get(s.profileId) ?? 0) > 1;
          const label = prof
            ? `${s.icon} ${prof.name}${multi ? ` ${s.ordinal}` : ""}`
            : `${s.icon} ${multi ? s.ordinal : ""}`.trim();
          return (
            <button
              key={s.sessionId}
              className={`tab ${isActive ? "active" : ""}`}
              type="button"
              onClick={() => onActivate(s.sessionId)}
              title={label}
            >
              <span className={`dot dot-${s.marker}`} />
              <span className="tab-label">{label}</span>
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(s.sessionId);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
      <div className="terminaltabs-panels">
        {sessions.map((s) => {
          const isActive = s.sessionId === active.sessionId;
          return (
            <div key={s.sessionId} className={`terminaltabs-panel ${isActive ? "active" : ""}`}>
              <TerminalPanel
                connectionId={s.sessionId}
                onDisconnected={() => {
                  // marker updates happen in parent via events; nothing needed here
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

