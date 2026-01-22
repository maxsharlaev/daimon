import { useMemo } from "react";
import type { Profile, TerminalSession } from "../types";
import { PromoTerminalPanel } from "./PromoTerminalPanel";

type Props = {
  profiles: Profile[];
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onShowFiles: (sessionId: string) => void;
  onOpenPlaces?: (profileId: string) => void;
  onOpenMacros?: (profileId: string) => void;
};

export function PromoTerminalTabs({
  profiles,
  sessions,
  activeSessionId,
  onActivate,
  onClose,
  onShowFiles,
  onOpenPlaces,
  onOpenMacros,
}: Props) {
  const byProfile = useMemo(() => {
    const m = new Map<string, Profile>();
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
        <div className="empty">Click Connect on the left to open a demo session.</div>
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
          const label = prof ? `${s.icon} ${prof.name}${multi ? ` ${s.ordinal}` : ""}` : `${s.icon} ${multi ? s.ordinal : ""}`.trim();
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
          const prof = byProfile.get(s.profileId);
          return (
            <div key={s.sessionId} className={`terminaltabs-panel ${isActive ? "active" : ""}`}>
              <PromoTerminalPanel
                sessionId={s.sessionId}
                meta={{ user: prof?.username ?? "demo", host: prof?.name ?? "host" }}
                onShowFiles={() => onShowFiles(s.sessionId)}
                onOpenPlaces={onOpenPlaces ? () => onOpenPlaces(s.profileId) : undefined}
                onOpenMacros={onOpenMacros ? () => onOpenMacros(s.profileId) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
