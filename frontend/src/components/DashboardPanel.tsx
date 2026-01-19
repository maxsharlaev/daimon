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

  const [addRowDropdownOpen, setAddRowDropdownOpen] = useState(false);
  const addRowDropdownRef = useRef<HTMLDivElement | null>(null);

  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<HTMLElement | null>(null);
  const [editRowColsOpen, setEditRowColsOpen] = useState<string | null>(null);
  const [editRowColsAnchor, setEditRowColsAnchor] = useState<HTMLElement | null>(null);
  const rowMenuDropdownRef = useRef<HTMLDivElement | null>(null);
  const editColsDropdownRef = useRef<HTMLDivElement | null>(null);
  const [confirmDeleteRowOpen, setConfirmDeleteRowOpen] = useState(false);
  const [pendingDeleteRowId, setPendingDeleteRowId] = useState<string | null>(null);

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

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (addRowDropdownRef.current?.contains(target)) return;
      if (rowMenuDropdownRef.current?.contains(target)) return;
      if (editColsDropdownRef.current?.contains(target)) return;

      if (addRowDropdownRef.current && !addRowDropdownRef.current.contains(target)) {
        setAddRowDropdownOpen(false);
      }
      if (rowMenuOpen && rowMenuAnchor && !rowMenuAnchor.contains(target)) {
        setRowMenuOpen(null);
        setRowMenuAnchor(null);
      }
      if (editRowColsOpen && editRowColsAnchor && !editRowColsAnchor.contains(target)) {
        setEditRowColsOpen(null);
        setEditRowColsAnchor(null);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [addRowDropdownOpen, rowMenuOpen, rowMenuAnchor, editRowColsOpen, editRowColsAnchor]);

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
    setAddRowDropdownOpen(false);
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

  const openRowMenu = (rowId: string, anchor: HTMLElement) => {
    setRowMenuOpen(rowId);
    setRowMenuAnchor(anchor);
  };

  const moveRowUp = async (rowId: string) => {
    const currentTab = layout.tabs.find((t) => t.id === activeTabId);
    if (!currentTab) return;
    const idx = currentTab.rows.findIndex((r) => r.id === rowId);
    if (idx <= 0) return;
    
    const rows = currentTab.rows.slice(); // Create new array
    const prevRow = rows[idx - 1];
    rows[idx - 1] = rows[idx];
    rows[idx] = prevRow;
    
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => (t.id === activeTabId ? { ...t, rows } : t)),
    };
    setRowMenuOpen(null);
    setRowMenuAnchor(null);
    await persistLayout(next, activeTabId);
  };

  const moveRowDown = async (rowId: string) => {
    const currentTab = layout.tabs.find((t) => t.id === activeTabId);
    if (!currentTab) return;
    const idx = currentTab.rows.findIndex((r) => r.id === rowId);
    if (idx < 0 || idx >= currentTab.rows.length - 1) return;
    
    const rows = currentTab.rows.slice(); // Create new array
    const nextRow = rows[idx + 1];
    rows[idx + 1] = rows[idx];
    rows[idx] = nextRow;
    
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => (t.id === activeTabId ? { ...t, rows } : t)),
    };
    setRowMenuOpen(null);
    setRowMenuAnchor(null);
    await persistLayout(next, activeTabId);
  };

  const openEditRowCols = (rowId: string, anchor: HTMLElement) => {
    setEditRowColsOpen(rowId);
    setEditRowColsAnchor(anchor);
    setRowMenuOpen(null);
    setRowMenuAnchor(null);
  };

  const applyEditRowCols = async (rowId: string, newCols: 1 | 2 | 3) => {
    if (!activeTab) return;
    const row = activeTab.rows.find((r) => r.id === rowId);
    if (!row) return;
    const oldCols = row.cols;
    const slots = row.slots.slice();
    if (newCols > oldCols) {
      while (slots.length < newCols) slots.push(null);
    } else if (newCols < oldCols) {
      slots.splice(newCols);
    }
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => {
        if (t.id !== activeTab.id) return t;
        return {
          ...t,
          rows: t.rows.map((r) => (r.id === rowId ? { ...r, cols: newCols, slots } : r)),
        };
      }),
    };
    setEditRowColsOpen(null);
    setEditRowColsAnchor(null);
    await persistLayout(next, activeTab.id);
  };

  const openDeleteRowConfirm = (rowId: string) => {
    setPendingDeleteRowId(rowId);
    setConfirmDeleteRowOpen(true);
    setRowMenuOpen(null);
    setRowMenuAnchor(null);
  };

  const confirmDeleteRow = async () => {
    if (!activeTab || !pendingDeleteRowId) return;
    const next: StoredLayoutV2 = {
      ...layout,
      tabs: layout.tabs.map((t) => (t.id === activeTab.id ? { ...t, rows: t.rows.filter((r) => r.id !== pendingDeleteRowId) } : t)),
    };
    setConfirmDeleteRowOpen(false);
    setPendingDeleteRowId(null);
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
          {activeTab ? (
            <div className="add-row-wrapper" ref={addRowDropdownRef}>
              <button
                className="btn"
                type="button"
                onClick={() => setAddRowDropdownOpen((p) => !p)}
                onBlur={(e) => {
                  if (!addRowDropdownRef.current?.contains(e.relatedTarget as Node)) {
                    setTimeout(() => setAddRowDropdownOpen(false), 150);
                  }
                }}
              >
                + Row
              </button>
              {addRowDropdownOpen ? (
                <div className="add-row-dropdown">
                  <button
                    className="add-row-option"
                    type="button"
                    onClick={() => void addRow(1)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="row-preview cols-1">
                      <div className="preview-slot" />
                    </div>
                    <span>1 column</span>
                  </button>
                  <button
                    className="add-row-option"
                    type="button"
                    onClick={() => void addRow(2)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="row-preview cols-2">
                      <div className="preview-slot" />
                      <div className="preview-slot" />
                    </div>
                    <span>2 columns</span>
                  </button>
                  <button
                    className="add-row-option"
                    type="button"
                    onClick={() => void addRow(3)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="row-preview cols-3">
                      <div className="preview-slot" />
                      <div className="preview-slot" />
                      <div className="preview-slot" />
                    </div>
                    <span>3 columns</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      <div className="dashboard-body">
        {activeTab ? (
          <>
            <div className="dash-rows">
              {activeTab.rows.map((r, rowIdx) => {
                const isFirst = rowIdx === 0;
                const isLast = rowIdx === activeTab.rows.length - 1;
                return (
                  <div key={r.id} className="dash-row-wrapper">
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
                    <div className="dash-row-menu-wrapper">
                      <button
                        className="btn btn-ghost row-menu-btn"
                        type="button"
                        onClick={(e) => openRowMenu(r.id, e.currentTarget)}
                        title="Row menu"
                      >
                        ⋯
                      </button>
                      {rowMenuOpen === r.id && rowMenuAnchor ? (
                        <div
                          className="row-menu-dropdown"
                          ref={rowMenuDropdownRef}
                          style={{ top: rowMenuAnchor.offsetTop + rowMenuAnchor.offsetHeight + 4, right: 0 }}
                        >
                          <div className="row-menu-item-wrapper">
                            <button
                              className="row-menu-item"
                              type="button"
                              onClick={(e) => openEditRowCols(r.id, e.currentTarget)}
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              Edit row
                            </button>
                            {editRowColsOpen === r.id && editRowColsAnchor ? (
                              <div
                                className="edit-cols-dropdown"
                                ref={editColsDropdownRef}
                                style={{ top: editRowColsAnchor.offsetTop, left: editRowColsAnchor.offsetWidth + 4 }}
                              >
                                <button
                                  className="edit-cols-option"
                                  type="button"
                                  onClick={() => void applyEditRowCols(r.id, 1)}
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  <div className="row-preview cols-1">
                                    <div className="preview-slot" />
                                  </div>
                                  <span>1 column</span>
                                </button>
                                <button
                                  className="edit-cols-option"
                                  type="button"
                                  onClick={() => void applyEditRowCols(r.id, 2)}
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  <div className="row-preview cols-2">
                                    <div className="preview-slot" />
                                    <div className="preview-slot" />
                                  </div>
                                  <span>2 columns</span>
                                </button>
                                <button
                                  className="edit-cols-option"
                                  type="button"
                                  onClick={() => void applyEditRowCols(r.id, 3)}
                                  onMouseDown={(e) => e.preventDefault()}
                                >
                                  <div className="row-preview cols-3">
                                    <div className="preview-slot" />
                                    <div className="preview-slot" />
                                    <div className="preview-slot" />
                                  </div>
                                  <span>3 columns</span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <div className="row-menu-sep" />
                          <button
                            className="row-menu-item"
                            type="button"
                            disabled={isFirst}
                            onClick={(e) => {
                              e.stopPropagation();
                              void moveRowUp(r.id);
                            }}
                          >
                            Move up
                          </button>
                          <button
                            className="row-menu-item"
                            type="button"
                            disabled={isLast}
                            onClick={(e) => {
                              e.stopPropagation();
                              void moveRowDown(r.id);
                            }}
                          >
                            Move down
                          </button>
                          <div className="row-menu-sep" />
                          <button
                            className="row-menu-item row-menu-item-danger"
                            type="button"
                            onClick={() => openDeleteRowConfirm(r.id)}
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
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

      {confirmDeleteRowOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Delete row?</div>
            <div className="modal-body">
              <div>Are you sure you want to delete this row and all widgets on it?</div>
              <div className="muted">This cannot be undone.</div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setConfirmDeleteRowOpen(false);
                  setPendingDeleteRowId(null);
                }}
              >
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void confirmDeleteRow()}>
                Delete
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
    const overall = Number(snap.cpu?.busyPct ?? 0);
    const cores = Math.max(1, Number(snap.load?.cores ?? 1));
    const topStyle = overall * cores;
    return (
      <div className="kpi">
        <div className="kpi-header">
          <div className="kpi-main">
            <div className="kpi-value">{topStyle.toFixed(1)}%</div>
            <div className="kpi-sub">busy (top-style)</div>
          </div>
          <div className="kpi-side">
            <div className="kpi-side-line">overall {overall.toFixed(1)}%</div>
            <div className="kpi-side-line">cores {cores}</div>
          </div>
        </div>
        <div className="progress" style={{ marginTop: 10 }}>
          <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, overall))}%` }} />
        </div>
      </div>
    );
  }
  if (w.metric === "mem_available") {
    const total = Number(snap.mem?.totalBytes ?? 0);
    const avail = Number(snap.mem?.availableBytes ?? 0);
    const used = Math.max(0, total - avail);
    const usedPct = total > 0 ? (used / total) * 100 : 0;
    return (
      <div className="kpi">
        <div className="kpi-header">
          <div className="kpi-main">
            <div className="kpi-value">{usedPct.toFixed(1)}%</div>
            <div className="kpi-sub">memory used</div>
          </div>
          <div className="kpi-side">
            <div className="kpi-side-line">total {fmtBytes(total)}</div>
            <div className="kpi-side-line">used {fmtBytes(used)}</div>
          </div>
        </div>
        <div className="progress" style={{ marginTop: 10 }}>
          <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, usedPct))}%` }} />
        </div>
      </div>
    );
  }
  if (w.metric === "load1") {
    const v = Number(snap.load?.load1 ?? 0);
    const cores = Number(snap.load?.cores ?? 0);
    const pctOfCores = cores > 0 ? (v / cores) * 100 : 0;
    return (
      <div className="kpi">
        <div className="kpi-value">{v.toFixed(2)}</div>
        <div className="kpi-sub">avg runnable tasks (1 min)</div>
        <div className="kpi-sub">
          ~{v.toFixed(2)} cores ({pctOfCores.toFixed(1)}% of {cores || "—"})
        </div>
      </div>
    );
  }
  if (w.metric === "disk_root") {
    const d = diskRoot;
    if (!d) return <div className="kpi-sub" style={{ padding: 10 }}>No disk data.</div>;
    const usedPct =
      Number.isFinite(d.usedPct) && d.usedPct > 0
        ? Number(d.usedPct)
        : d.sizeBytes > 0
          ? (Number(d.usedBytes) / Number(d.sizeBytes)) * 100
          : 0;
    return (
      <div className="kpi">
        <div className="kpi-header">
          <div className="kpi-main">
            <div className="kpi-value">{usedPct.toFixed(1)}%</div>
            <div className="kpi-sub">{d.mount} used</div>
          </div>
          <div className="kpi-side">
            <div className="kpi-side-line">total {fmtBytes(Number(d.sizeBytes))}</div>
            <div className="kpi-side-line">used {fmtBytes(Number(d.usedBytes))}</div>
          </div>
        </div>
        <div className="progress" style={{ marginTop: 10 }}>
          <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, usedPct))}%` }} />
        </div>
      </div>
    );
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
