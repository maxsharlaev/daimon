import { useMemo, useState } from "react";
import type { DashboardSession, Profile } from "../types";
import { demoLayout, type DashboardLayout } from "../demo/layout";
import { PromoDashboardPanel } from "./PromoDashboardPanel";

type Props = {
  profiles: Profile[];
  sessions: DashboardSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export function PromoDashboardTabs({ profiles, sessions, activeSessionId, onActivate, onClose }: Props) {
  const byProfile = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const active = sessions.find((s) => s.sessionId === activeSessionId) ?? sessions[0] ?? null;
  const prof = active ? byProfile.get(active.profileId) : null;

  const [layout] = useState<DashboardLayout>(() => demoLayout);
  const [activeTabId, setActiveTabId] = useState<string>(demoLayout.activeTabId);

  if (sessions.length === 0) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Dashboard</div>
          <div className="panel-meta">no active dashboards</div>
        </div>
        <div className="empty">Click Dashboard on a profile to open monitoring demo.</div>
      </div>
    );
  }

  const tabs = layout.tabs ?? [];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  return (
    <div className="dashboardtabs">
      <div className="dashboardtabs-bar">
        {tabs.map((t) => {
          const isActive = t.id === (activeTab?.id ?? "");
          return (
            <button key={t.id} className={`tab ${isActive ? "active" : ""}`} type="button" onClick={() => setActiveTabId(t.id)} title={t.name}>
              <span className="tab-label">
                {t.icon || "📊"} {t.name}
              </span>
            </button>
          );
        })}
        <div className="dashboardtabs-actions">
          <button className="btn btn-ghost" type="button" disabled>
            Demo mode
          </button>
        </div>
      </div>
      <div className="dashboardtabs-panels">
        <div className="dashboardtabs-panel active">
          {active ? (
            <PromoDashboardPanel
              sessionId={active.sessionId}
              profileName={prof?.name}
              layout={layout}
              activeTabId={activeTabId}
              onRefresh={() => {
                // no-op
              }}
            />
          ) : null}
        </div>
      </div>

      {active ? (
        <div className="dashboardtabs-bar" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost" type="button" onClick={() => onActivate(active.sessionId)}>
            Focus
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => onClose(active.sessionId)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
