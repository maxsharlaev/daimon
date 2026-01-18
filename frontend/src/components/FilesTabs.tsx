import { useMemo } from "react";
import type { ProfileDTO } from "../types/models";
import "./filestabs.css";
import { FilesManager } from "./FilesManager";
import "./terminaltabs.css";

export type FilesSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
};

type Props = {
  profiles: ProfileDTO[];
  sessions: FilesSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export function FilesTabs({ profiles, sessions, activeSessionId, onActivate, onClose }: Props) {
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
          <div className="panel-title">Files</div>
          <div className="panel-meta">no active file sessions</div>
        </div>
        <div className="empty">Click Files on a profile to open SFTP.</div>
      </div>
    );
  }

  const active = sessions.find((s) => s.sessionId === activeSessionId) ?? sessions[0];

  return (
    <div className="filestabs">
      <div className="filestabs-bar">
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
              <span className="dot dot-files" />
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
      <div className="filestabs-panels">
        {sessions.map((s) => (
          <div key={s.sessionId} className={`filestabs-panel ${s.sessionId === active.sessionId ? "active" : ""}`}>
            <FilesManager sessionId={s.sessionId} />
          </div>
        ))}
      </div>
    </div>
  );
}

