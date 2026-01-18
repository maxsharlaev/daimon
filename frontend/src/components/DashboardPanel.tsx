import { useEffect, useMemo, useRef, useState } from "react";
import { SSHDashboardSnapshot } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import "./dashboardpanel.css";
import type { DashboardRow, DashboardTab, StoredLayoutV2, WidgetConfig, WidgetMetric, WidgetView } from "./dashboardLayout";
import { uid } from "./dashboardLayout";

type Props = {
  sessionId: string;
  profileId: string;
  profileName?: string;
  layout: StoredLayoutV2;
  activeTabId: string;
  persistLayout: (next: StoredLayoutV2, nextActiveTabId?: string) => Promise<void>;
};

export function DashboardPanel({ sessionId, profileId, profileName, layout, activeTabId, persistLayout }: Props) {
  const [snap, setSnap] = useState<main.DashboardSnapshotDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [slotTarget, setSlotTarget] = useState<{ tabId: string; rowId: string; slotIdx: number } | null>(null);
  const [addMetric, setAddMetric] = useState<WidgetMetric>("cpu_busy");
  const [addView, setAddView] = useState<WidgetView>("progress");

  const inFlightRef = useRef(false);

  const refresh = async () => {
    if (!sessionId) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await SSHDashboardSnapshot(sessionId);
      setSnap(next as any);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const title = profileName ? `Dashboard — ${profileName}` : "Dashboard";
  const ts = snap?.tsUnixMs ? new Date(snap.tsUnixMs).toLocaleTimeString() : "—";

  const diskRoot = useMemo(() => {
    const d = (snap?.disks ?? []).find((x) => x.mount === "/") ?? null;
    if (d) return d;
    return (snap?.disks ?? [])[0] ?? null;
  }, [snap]);

  const tabs = layout.tabs ?? [];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  const openAddWidgetForSlot = (tabId: string, rowId: string, slotIdx: number) => {
    setSlotTarget({ tabId, rowId, slotIdx });
    setAddWidgetOpen(true);
  };

  const applyAddWidget = async () => {
    if (!slotTarget) return;
    const w: WidgetConfig = { id: uid("w"), metric: addMetric, view: addView };
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => {
        if (t.id !== slotTarget.tabId) return t;
        return {
          ...t,
          rows: t.rows.map((r) => {
            if (r.id !== slotTarget.rowId) return r;
            const slots = r.slots.slice();
            slots[slotTarget.slotIdx] = w;
            return { ...r, slots };
          }),
        };
      }),
    };
    setAddWidgetOpen(false);
    setSlotTarget(null);
    await persistLayout(next, activeTabId);
  };

  const removeWidgetFromSlot = async (tabId: string, rowId: string, slotIdx: number) => {
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          rows: t.rows.map((r) => {
            if (r.id !== rowId) return r;
            const slots = r.slots.slice();
            slots[slotIdx] = null;
            return { ...r, slots };
          }),
        };
      }),
    };
    await persistLayout(next, activeTabId);
  };

  const addRow = async (cols: 1 | 2 | 3) => {
    if (!activeTab) return;
    const row: DashboardRow = {
      id: uid("row"),
      cols,
      slots: new Array(cols).fill(null),
    };
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => (t.id === activeTab.id ? { ...t, rows: [...t.rows, row] } : t)),
    };
    await persistLayout(next, activeTab.id);
  };

  const deleteRow = async (rowId: string) => {
    if (!activeTab) return;
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => (t.id === activeTab.id ? { ...t, rows: t.rows.filter((r) => r.id !== rowId) } : t)),
    };
    await persistLayout(next, activeTab.id);
  };

  const metricOptions: Array<{ id: WidgetMetric; label: string; allowed: WidgetView[] }> = [
    { id: "cpu_busy", label: "CPU busy %", allowed: ["progress", "kpi"] },
    { id: "mem_available", label: "Memory available %", allowed: ["progress", "kpi"] },
    { id: "load1", label: "Load1", allowed: ["kpi"] },
    { id: "disk_root", label: "Disk / free", allowed: ["progress", "kpi"] },
    { id: "top_cpu", label: "Top CPU processes", allowed: ["list"] },
    { id: "top_mem", label: "Top MEM processes", allowed: ["list"] },
    { id: "net_ifaces", label: "Network interfaces (rx/tx bytes)", allowed: ["list"] },
    { id: "alerts", label: "Alerts", allowed: ["list"] },
  ];

  const allowedViews = metricOptions.find((m) => m.id === addMetric)?.allowed ?? ["kpi"];

  useEffect(() => {
    if (!allowedViews.includes(addView)) setAddView(allowedViews[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMetric]);

  return (
    <div className="panel">
      <div className="panel-titlebar">
        <div className="panel-title">{title}</div>
        <div className="panel-meta">
          <span className={`badge badge-${busy ? "idle" : "connected"}`}>{busy ? "updating…" : "live"}</span>
          <span className="muted">last: {ts}</span>
          {error ? <span className="error-text">{error}</span> : null}
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      <div className="dashboard-body">
        {activeTab ? (
          <>
            <div className="dash-row-head">
              <div className="left">
                <span className="muted">Rows</span>
              </div>
              <div className="right">
                <button className="btn btn-ghost" type="button" onClick={() => void addRow(1)}>
                  + Row (1)
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => void addRow(2)}>
                  + Row (2)
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => void addRow(3)}>
                  + Row (3)
                </button>
              </div>
            </div>
            <div className="dash-rows">
              {activeTab.rows.map((r) => (
                <div key={r.id}>
                  <div className="dash-row-head">
                    <div className="left">
                      <span className="muted">Row</span>
                      <span className="muted">{r.cols} slots</span>
                    </div>
                    <div className="right">
                      <button className="btn btn-ghost" type="button" onClick={() => void deleteRow(r.id)}>
                        Delete row
                      </button>
                    </div>
                  </div>
                  <div className={`dash-row cols-${r.cols}`}>
                    {r.slots.map((slot, idx) => (
                      <div key={idx} className={`slot ${slot ? "filled" : ""}`}>
                        {slot ? (
                          <Widget
                            w={slot}
                            snap={snap}
                            diskRoot={diskRoot}
                            onRemove={() => void removeWidgetFromSlot(activeTab.id, r.id, idx)}
                          />
                        ) : (
                          <div className="slot-empty">
                            <button
                              className="btn"
                              type="button"
                              onClick={() => openAddWidgetForSlot(activeTab.id, r.id, idx)}
                            >
                              + Add widget
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {activeTab.rows.length === 0 ? <div className="muted">No rows yet. Add a row to start.</div> : null}
            </div>
          </>
        ) : (
          <div className="muted">No tab selected.</div>
        )}
      </div>

      {addWidgetOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Add widget</div>
            <div className="modal-body">
              <label>Metric</label>
              <select value={addMetric} onChange={(e) => setAddMetric(e.target.value as WidgetMetric)}>
                {metricOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <label>View</label>
              <select value={addView} onChange={(e) => setAddView(e.target.value as WidgetView)}>
                {allowedViews.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <div className="muted">Widgets are saved per profile.</div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setAddWidgetOpen(false);
                  setSlotTarget(null);
                }}
              >
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void applyAddWidget()}>
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Widget({
  w,
  snap,
  diskRoot,
  onRemove,
}: {
  w: WidgetConfig;
  snap: main.DashboardSnapshotDTO | null;
  diskRoot: main.DashboardDiskDTO | null;
  onRemove: () => void;
}) {
  const title =
    w.metric === "cpu_busy"
      ? "CPU"
      : w.metric === "mem_available"
        ? "Memory"
        : w.metric === "load1"
          ? "Load"
          : w.metric === "disk_root"
            ? "Disk"
            : w.metric === "top_cpu"
              ? "Top CPU"
              : w.metric === "top_mem"
                ? "Top MEM"
                : w.metric === "net_ifaces"
                  ? "Network"
                  : "Alerts";

  return (
    <div className="widget">
      <div className="widget-head">
        <div className="widget-title">{title}</div>
        <div className="widget-actions">
          <button className="btn btn-ghost" type="button" onClick={onRemove} title="Remove widget">
            ×
          </button>
        </div>
      </div>
      <WidgetBody w={w} snap={snap} diskRoot={diskRoot} />
    </div>
  );
}

function WidgetBody({
  w,
  snap,
  diskRoot,
}: {
  w: WidgetConfig;
  snap: main.DashboardSnapshotDTO | null;
  diskRoot: main.DashboardDiskDTO | null;
}) {
  if (!snap) {
    return <div className="kpi-sub" style={{ padding: 10 }}>No data yet…</div>;
  }

  if (w.metric === "alerts") {
    const alerts = (snap.alerts ?? []) as any[];
    if (!alerts.length) return <div className="kpi-sub" style={{ padding: 10 }}>No alerts.</div>;
    return (
      <div className="alerts">
        {alerts.map((a: any) => (
          <div key={a.id} className={`alert ${a.severity}`}>
            <div className="alert-title">{a.title}</div>
            <div className="alert-msg">{a.message}</div>
          </div>
        ))}
      </div>
    );
  }

  if (w.metric === "cpu_busy") {
    const v = Number(snap.cpu?.busyPct ?? 0);
    return <ProgressKPI label={`${v.toFixed(1)}%`} pct={v} sub="busy" />;
  }
  if (w.metric === "mem_available") {
    const v = Number(snap.mem?.availablePct ?? 0);
    return <ProgressKPI label={`${v.toFixed(1)}%`} pct={v} sub="available" />;
  }
  if (w.metric === "load1") {
    const v = Number(snap.load?.load1 ?? 0);
    const cores = Number(snap.load?.cores ?? 0);
    return (
      <div className="kpi">
        <div className="kpi-value">{v.toFixed(2)}</div>
        <div className="kpi-sub">cores: {cores || "—"}</div>
      </div>
    );
  }
  if (w.metric === "disk_root") {
    const d = diskRoot;
    if (!d) return <div className="kpi-sub" style={{ padding: 10 }}>No disk data.</div>;
    const freePct = d.sizeBytes > 0 ? (Number(d.availBytes) / Number(d.sizeBytes)) * 100 : 0;
    const usedPct = 100 - freePct;
    return <ProgressKPI label={`${freePct.toFixed(1)}%`} pct={usedPct} sub={`${d.mount} used`} invert />;
  }
  if (w.metric === "top_cpu") {
    return (
      <div className="list">
        {(snap.topCpu ?? []).slice(0, 10).map((p: any) => (
          <div key={p.pid} className="list-row">
            <span className="mono">{p.comm}</span>
            <span className="muted mono">
              {Number(p.cpu).toFixed(1)}% • {Number(p.mem).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (w.metric === "top_mem") {
    return (
      <div className="list">
        {(snap.topMem ?? []).slice(0, 10).map((p: any) => (
          <div key={p.pid} className="list-row">
            <span className="mono">{p.comm}</span>
            <span className="muted mono">
              {Number(p.mem).toFixed(1)}% • {Number(p.cpu).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (w.metric === "net_ifaces") {
    return (
      <div className="list">
        {(snap.netDevices ?? []).map((n: any) => (
          <div key={n.iface} className="list-row">
            <span className="mono">{n.iface}</span>
            <span className="muted mono">
              rx {fmtBytes(Number(n.rxBytes))} • tx {fmtBytes(Number(n.txBytes))}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return <div className="kpi-sub" style={{ padding: 10 }}>Unsupported widget.</div>;
}

function ProgressKPI({ label, pct, sub, invert }: { label: string; pct: number; sub: string; invert?: boolean }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const fill = invert ? 100 - clamped : clamped;
  return (
    <div className="kpi">
      <div className="kpi-value">{label}</div>
      <div className="kpi-sub">{sub}</div>
      <div className="progress" style={{ marginTop: 10 }}>
        <div className="progress-fill" style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.floor(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

