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
  remotePath?: string;
  marker: "files" | "gray";
  lastError?: string | null;
};

type Props = {
  profiles: ProfileDTO[];
  sessions: FilesSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onSessionDisconnected?: (sessionId: string, error: string) => void;
  initialPathsByProfile: Record<string, { localPath: string; remotePath: string }>;
  onPathsChanged: (profileId: string, next: { localPath: string; remotePath: string }) => void;
  onOpenTerminalAtPath: (profileId: string, remotePath: string) => void;
  onSessionPathsChanged?: (sessionId: string, next: { localPath: string; remotePath: string }) => void;
  onOpenPlaces?: (profileId: string) => void;
  onAddLocation?: (profileId: string, remotePath: string) => void;
  navToRemoteBySessionId?: Record<string, { path: string; token: number }>;
};

export function FilesTabs({
  profiles,
  sessions,
  activeSessionId,
  onActivate,
  onClose,
  onSessionDisconnected,
  initialPathsByProfile,
  onPathsChanged,
  onOpenTerminalAtPath,
  onSessionPathsChanged,
  onOpenPlaces,
  onAddLocation,
  navToRemoteBySessionId,
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

  // Use a conservative limit so the tail is meaningful in narrow tab widths.
  const tailPath = (p: string, max = 24) => {
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
  };

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
          const fullPath = s.remotePath ?? initialPathsByProfile[s.profileId]?.remotePath ?? ".";
          const shortPath = tailPath(fullPath);
          return (
            <button
              key={s.sessionId}
              className={`tab ${isActive ? "active" : ""}`}
              type="button"
              onClick={() => onActivate(s.sessionId)}
              title={fullPath}
            >
              <span className={`dot ${s.marker === "gray" ? "dot-gray" : "dot-files"}`} />
              <span className="tab-label">{`${s.icon} ${shortPath}`}</span>
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
            <FilesManager
              sessionId={s.sessionId}
              profileId={s.profileId}
              initialLocalPath={initialPathsByProfile[s.profileId]?.localPath}
              initialRemotePath={s.remotePath ?? initialPathsByProfile[s.profileId]?.remotePath}
              onPathsChanged={(next) => onPathsChanged(s.profileId, next)}
              onOpenTerminalAtPath={(rp) => onOpenTerminalAtPath(s.profileId, rp)}
              onSessionPathsChanged={(next) => onSessionPathsChanged?.(s.sessionId, next)}
              onSessionDisconnected={(sid, err) => onSessionDisconnected?.(sid, err)}
              onOpenPlaces={onOpenPlaces}
              onAddLocation={onAddLocation}
              navToRemote={navToRemoteBySessionId?.[s.sessionId]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

