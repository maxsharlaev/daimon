import { useMemo } from "react";
import type { FilesSession, Profile } from "../types";
import { PromoFilesPanel } from "./PromoFilesPanel";

type Props = {
  profiles: Profile[];
  sessions: FilesSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRemotePathChange: (sessionId: string, next: string) => void;
};

export function PromoFilesTabs({ profiles, sessions, activeSessionId, onActivate, onClose, onRemotePathChange }: Props) {
  const byProfile = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  if (sessions.length === 0) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Files</div>
          <div className="panel-meta">no active file sessions</div>
        </div>
        <div className="empty">Click Files on a profile to open SFTP demo.</div>
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
          const label = `${s.icon} ${tailPath(s.remotePath ?? "/")}`;
          return (
            <button key={s.sessionId} className={`tab ${isActive ? "active" : ""}`} type="button" onClick={() => onActivate(s.sessionId)} title={prof?.name}>
              <span className={`dot ${s.marker === "red" ? "dot-red" : "dot-files"}`} />
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
            <PromoFilesPanel
              sessionId={s.sessionId}
              remotePath={s.remotePath}
              onRemotePathChange={(next) => onRemotePathChange(s.sessionId, next)}
            />
          </div>
        ))}
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
