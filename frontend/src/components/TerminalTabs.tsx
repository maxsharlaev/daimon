import type { ReactNode } from "react";
import { useMemo } from "react";
import type { ProfileDTO } from "../types/models";
import { TerminalPanel } from "./TerminalPanel";
import "./terminaltabs.css";

export type SessionMarker = "green" | "gray" | "yellow" | "none";

export type TerminalSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  marker: SessionMarker;
  taskRunning?: boolean;
  lastError?: string | null;
};

export type TerminalAgentOutputTab = {
  visible: boolean;
  active: boolean;
  onSelect: () => void;
  /** Close the Agent output tab (stay on terminal). */
  onClose?: () => void;
  children: ReactNode;
};

type Props = {
  profiles: ProfileDTO[];
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onShowPwd: (sessionId: string) => void;
  onAddLocation?: (sessionId: string, profileId: string) => void;
  onOpenPlaces?: (profileId: string) => void;
  onOpenMacros?: (profileId: string) => void;
  onOpenSecrets?: (profileId: string) => void;
  /** Journal of agent shell runs — tab next to terminal sessions in the main content area. */
  agentOutputTab?: TerminalAgentOutputTab | null;
};

export function TerminalTabs({
  profiles,
  sessions,
  activeSessionId,
  onActivate,
  onClose,
  onShowPwd,
  onAddLocation,
  onOpenPlaces,
  onOpenMacros,
  onOpenSecrets,
  agentOutputTab,
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

  const active =
    sessions.length > 0 ? (sessions.find((s) => s.sessionId === activeSessionId) ?? sessions[0]) : null;
  const agentOut = agentOutputTab?.visible ? agentOutputTab : null;

  if (sessions.length === 0 && !agentOut) {
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

  return (
    <div className="terminaltabs">
      <div className="terminaltabs-bar">
        {sessions.map((s) => {
          const isActive = !agentOut?.active && active != null && s.sessionId === active.sessionId;
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
        {agentOut ? (
          <button
            type="button"
            className={`tab tab-agent-output ${agentOut.active ? "active" : ""}`}
            title="Agent command output"
            onClick={() => agentOut.onSelect()}
          >
            <span className="tab-agent-output-icon" aria-hidden="true">
              🤖
            </span>
            <span className="tab-label">Agent output</span>
            {agentOut.onClose ? (
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  agentOut.onClose?.();
                }}
                title="Close"
              >
                ×
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
      <div className="terminaltabs-panels">
        {sessions.map((s) => {
          const isActive = !agentOut?.active && active != null && s.sessionId === active.sessionId;
          return (
            <div key={s.sessionId} className={`terminaltabs-panel ${isActive ? "active" : ""}`}>
              <TerminalPanel
                connectionId={s.sessionId}
                onShowPwd={() => onShowPwd(s.sessionId)}
                onAddLocation={onAddLocation ? () => onAddLocation(s.sessionId, s.profileId) : undefined}
                onOpenPlaces={onOpenPlaces ? () => onOpenPlaces(s.profileId) : undefined}
                onOpenMacros={onOpenMacros ? () => onOpenMacros(s.profileId) : undefined}
                onOpenSecrets={onOpenSecrets ? () => onOpenSecrets(s.profileId) : undefined}
                onDisconnected={() => {
                  // marker updates happen in parent via events; nothing needed here
                }}
              />
            </div>
          );
        })}
        {agentOut ? (
          <div className={`terminaltabs-panel terminaltabs-panel-agent-output ${agentOut.active ? "active" : ""}`}>{agentOut.children}</div>
        ) : null}
      </div>
    </div>
  );
}
