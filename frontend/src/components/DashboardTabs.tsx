import { useEffect, useMemo, useState } from "react";
import type { ProfileDTO } from "../types/models";
import type { DashboardSession } from "../App";
import { LoadUILayout, SaveUILayout } from "../../wailsjs/go/main/App";
import { DashboardPanel } from "./DashboardPanel";
import "./dashboardtabs.css";
import type { DashboardTab, StoredLayoutV2 } from "./dashboardLayout";
import { defaultLayoutV2, uid } from "./dashboardLayout";
import { DropdownSelect } from "./ui";

const TAB_ICON_OPTIONS = ["📊", "🧠", "🧰", "🌐", "🧪", "📡", "💾", "🧾"].map((x) => ({
  value: x,
  label: x,
}));

type Props = {
  profiles: ProfileDTO[];
  sessions: DashboardSession[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export function DashboardTabs({ profiles, sessions, activeSessionId, onActivate, onClose }: Props) {
  const byProfile = useMemo(() => {
    const m = new Map<string, ProfileDTO>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const active = sessions.find((s) => s.sessionId === activeSessionId) ?? sessions[0] ?? null;
  const prof = active ? byProfile.get(active.profileId) : null;
  const scope = active ? `dashboard:${active.profileId}` : "";

  const [layout, setLayout] = useState<StoredLayoutV2>(() => defaultLayoutV2());
  const [activeTabId, setActiveTabId] = useState<string>("tab-general");

  const [addTabOpen, setAddTabOpen] = useState(false);
  const [tabName, setTabName] = useState("New tab");
  const [tabIcon, setTabIcon] = useState("📊");

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const tabs = layout.tabs ?? [];

  const persistLayout = async (next: StoredLayoutV2, nextActiveTabId?: string) => {
    const out: StoredLayoutV2 = {
      ...next,
      activeTabId: nextActiveTabId ?? next.activeTabId,
    };
    setLayout(out);
    if (out.activeTabId) setActiveTabId(out.activeTabId);
    if (!scope) return;
    try {
      await SaveUILayout(scope, JSON.stringify(out));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!scope || !active) return;
    const load = async () => {
      try {
        const raw = await LoadUILayout(scope);
        const v = JSON.parse(raw || "{}") as any;
        if (v && Number(v.version) === 2 && Array.isArray(v.tabs) && v.tabs.length > 0) {
          setLayout(v as StoredLayoutV2);
          setActiveTabId(String(v.activeTabId || v.tabs[0]?.id || "tab-general"));
          return;
        }
      } catch {
        // ignore
      }

      const def = defaultLayoutV2();
      setLayout(def);
      setActiveTabId(def.activeTabId || def.tabs[0]?.id || "tab-general");
      try {
        await SaveUILayout(scope, JSON.stringify(def));
      } catch {
        // ignore
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, active?.profileId]);

  if (sessions.length === 0) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Dashboard</div>
          <div className="panel-meta">no active dashboards</div>
        </div>
        <div className="empty">Click Dashboard on a profile to open monitoring.</div>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  const openDeleteConfirm = (tabId: string) => {
    const t = tabs.find((x) => x.id === tabId);
    if (!t || t.locked) return;
    setPendingDeleteId(tabId);
    setConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    const t = tabs.find((x) => x.id === id);
    if (!t || t.locked) {
      setConfirmDeleteOpen(false);
      setPendingDeleteId(null);
      return;
    }
    const nextTabs = tabs.filter((x) => x.id !== id);
    const fallback = nextTabs[0]?.id || "tab-general";
    const next: StoredLayoutV2 = { ...layout, tabs: nextTabs };
    setConfirmDeleteOpen(false);
    setPendingDeleteId(null);
    await persistLayout(next, activeTabId === id ? fallback : activeTabId);
  };

  const addTab = async () => {
    const id = uid("tab");
    const t: DashboardTab = { id, name: tabName.trim() || "New tab", icon: tabIcon || "📊", rows: [] };
    const next: StoredLayoutV2 = { ...layout, tabs: [...tabs, t] };
    setAddTabOpen(false);
    await persistLayout(next, id);
  };

  return (
    <div className="dashboardtabs">
      <div className="dashboardtabs-bar">
        {tabs.map((t) => {
          const isActive = t.id === (activeTab?.id ?? "");
          return (
            <button
              key={t.id}
              className={`tab ${isActive ? "active" : ""}`}
              type="button"
              onClick={() => void persistLayout({ ...layout, activeTabId: t.id }, t.id)}
              title={t.name}
            >
              <span className="tab-label">
                {t.icon || "📊"} {t.name}
              </span>
              {!t.locked ? (
                <span
                  className="tab-close"
                  title="Delete tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDeleteConfirm(t.id);
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>
          );
        })}

        <div className="dashboardtabs-actions">
          <button className="btn btn-ghost" type="button" onClick={() => setAddTabOpen(true)}>
            + Tab
          </button>
        </div>
      </div>
      <div className="dashboardtabs-panels">
        <div className="dashboardtabs-panel active">
          {active ? (
            <DashboardPanel
              sessionId={active.sessionId}
              profileId={active.profileId}
              profileName={prof?.name}
              layout={layout}
              activeTabId={activeTabId}
              persistLayout={persistLayout}
            />
          ) : null}
        </div>
      </div>

      {addTabOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">New dashboard tab</div>
            <div className="modal-body">
              <label>Name</label>
              <input value={tabName} onChange={(e) => setTabName(e.target.value)} />
              <label>Icon</label>
              <DropdownSelect value={tabIcon} onChange={setTabIcon} options={TAB_ICON_OPTIONS} aria-label="Tab icon" />
              <div className="muted">Tabs are saved per profile. General cannot be deleted.</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setAddTabOpen(false)}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void addTab()}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Delete tab?</div>
            <div className="modal-body">
              <div>Are you sure you want to delete this tab and all widgets on it?</div>
              <div className="muted">This cannot be undone.</div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  setPendingDeleteId(null);
                }}
              >
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

