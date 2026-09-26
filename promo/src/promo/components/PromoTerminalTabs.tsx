import { useMemo, useState, type ReactNode } from "react";
import type { Profile, TerminalSession } from "../types";
import { PromoTerminalPanel } from "./PromoTerminalPanel";

export type AgentOutputTab = {
  visible: boolean;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  children: ReactNode;
};

type Props = {
  profiles: Profile[];
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onShowFiles: (sessionId: string) => void;
  onOpenPlaces?: (profileId: string) => void;
  onOpenMacros?: (profileId: string) => void;
  agentOutputTab?: AgentOutputTab | null;
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
  agentOutputTab,
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

  const [secretsProfileId, setSecretsProfileId] = useState<string | null>(null);
  const agentOut = agentOutputTab?.visible ? agentOutputTab : null;

  if (sessions.length === 0 && !agentOut) {
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

  const active = sessions.find((s) => s.sessionId === activeSessionId) ?? sessions[0] ?? null;

  return (
    <div className="terminaltabs">
      <div className="terminaltabs-bar">
        {sessions.map((s) => {
          const isActive = !agentOut?.active && active != null && s.sessionId === active.sessionId;
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
        {agentOut ? (
          <button type="button" className={`tab tab-agent-output ${agentOut.active ? "active" : ""}`} title="Agent command output" onClick={() => agentOut.onSelect()}>
            <span className="tab-agent-output-icon" aria-hidden="true">🤖</span>
            <span className="tab-label">Agent output</span>
            <span className="tab-close" title="Close" onClick={(e) => { e.stopPropagation(); agentOut.onClose(); }}>×</span>
          </button>
        ) : null}
      </div>
      <div className="terminaltabs-panels">
        {sessions.map((s) => {
          const isActive = !agentOut?.active && active != null && s.sessionId === active.sessionId;
          const prof = byProfile.get(s.profileId);
          return (
            <div key={s.sessionId} className={`terminaltabs-panel ${isActive ? "active" : ""}`}>
              <PromoTerminalPanel
                sessionId={s.sessionId}
                meta={{ user: prof?.username ?? "demo", host: prof?.name ?? "host" }}
                onShowFiles={() => onShowFiles(s.sessionId)}
                onOpenPlaces={onOpenPlaces ? () => onOpenPlaces(s.profileId) : undefined}
                onOpenMacros={onOpenMacros ? () => onOpenMacros(s.profileId) : undefined}
                onAddPlace={() => undefined}
                onOpenSecrets={() => setSecretsProfileId(s.profileId)}
              />
            </div>
          );
        })}
        {agentOut ? <div className={`terminaltabs-panel terminaltabs-panel-agent-output ${agentOut.active ? "active" : ""}`}>{agentOut.children}</div> : null}
      </div>
      {secretsProfileId ? <PromoSecretsModal profileName={byProfile.get(secretsProfileId)?.name ?? "profile"} onClose={() => setSecretsProfileId(null)} /> : null}
    </div>
  );
}

function PromoSecretsModal({ profileName, onClose }: { profileName: string; onClose: () => void }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal secretsmodal">
        <div className="modal-title">Secrets • {profileName}</div>
        <div className="modal-body form">
          <div className="secrets-list">
            <div className="secrets-row">
              <div className="secrets-main">
                <div className="secrets-key">SSH_PASSWORD</div>
                <div className="secrets-meta"><span className="secrets-storage">keyring</span><span className="secrets-updated">updated today</span></div>
              </div>
              <div className="secrets-actions"><button className="btn btn-ghost" type="button">Copy</button></div>
            </div>
          </div>
          <div className="secrets-vault">
            <div className="secrets-vault-title">Vault</div>
            <div className="muted">Locked in this preview. The desktop app unlocks the local vault.</div>
          </div>
          <div className="muted secrets-note">Clipboard will be cleared after ~20 seconds (best-effort).</div>
        </div>
        <div className="modal-actions secrets-actions-footer">
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
