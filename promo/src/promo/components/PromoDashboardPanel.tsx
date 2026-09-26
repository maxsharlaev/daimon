import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardLayout, DashboardRow, DashboardTab, WidgetConfig, WidgetMetric, WidgetView } from "../demo/layout";
import { getDashboardSnapshot, type DashboardSnapshot } from "../demo/dashboard";

type Props = {
  sessionId: string;
  profileName?: string;
  layout: DashboardLayout;
  activeTabId: string;
  onRefresh?: () => void;
};

export function PromoDashboardPanel({ sessionId, profileName, layout, activeTabId, onRefresh }: Props) {
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const inFlightRef = useRef(false);
  const sessionIdRef = useRef<string>(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    inFlightRef.current = false;
    setSnap(null);
    setBusy(false);
  }, [sessionId]);

  const refresh = () => {
    const id = sessionIdRef.current;
    if (!id || inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setTimeout(() => {
      if (sessionIdRef.current !== id) return;
      setSnap(getDashboardSnapshot(id));
      inFlightRef.current = false;
      setBusy(false);
      onRefresh?.();
    }, 150);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
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

  return (
    <div className="panel">
      <div className="panel-titlebar">
        <div className="panel-title">{title}</div>
        <div className="panel-meta">
          <span className={`badge badge-${busy ? "idle" : "connected"}`}>{busy ? "updating…" : "live"}</span>
          <span className="muted">last: {ts}</span>
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={refresh} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      <div className="dashboard-body">
        {activeTab ? (
          <div className="dash-rows">
            {activeTab.rows.map((r) => (
              <PromoRow key={r.id} row={r} snap={snap} diskRoot={diskRoot} />
            ))}
            {activeTab.rows.length === 0 ? <div className="muted">No rows in this demo tab.</div> : null}
          </div>
        ) : (
          <div className="muted">No tab selected.</div>
        )}
      </div>
    </div>
  );
}

function PromoRow({ row, snap, diskRoot }: { row: DashboardRow; snap: DashboardSnapshot | null; diskRoot: DashboardSnapshot["disks"][0] | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  return (
    <div className="dash-row-wrapper">
      <div className={`dash-row cols-${row.cols}`}>
        {row.slots.map((slot, idx) => (
          <div key={idx} className={`slot ${slot ? "filled" : ""}`}>
            {slot ? <Widget w={slot} snap={snap} diskRoot={diskRoot} /> : (
              <div className="slot-empty"><button className="btn" type="button">+ Add widget</button></div>
            )}
          </div>
        ))}
      </div>
      <div className="dash-row-menu-wrapper">
        <button className="btn btn-ghost row-menu-btn" type="button" title="Row menu" onClick={() => { setMenuOpen((open) => !open); setColsOpen(false); }}>⋯</button>
        {menuOpen ? (
          <div className="row-menu-dropdown">
            <div className="row-menu-item-wrapper">
              <button className="row-menu-item" type="button" onClick={() => setColsOpen((open) => !open)}>Edit row</button>
              {colsOpen ? (
                <div className="edit-cols-dropdown">
                  {[1, 2, 3].map((cols) => (
                    <button key={cols} className="edit-cols-option" type="button" onClick={() => { setColsOpen(false); setMenuOpen(false); }}>
                      <div className={`row-preview cols-${cols}`}>{Array.from({ length: cols }, (_, i) => <div key={i} className="preview-slot" />)}</div>
                      <span>{cols} column{cols > 1 ? "s" : ""}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="row-menu-sep" />
            <button className="row-menu-item row-menu-item-danger" type="button" onClick={() => setMenuOpen(false)}>Delete row</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Widget({ w, snap, diskRoot }: { w: WidgetConfig; snap: DashboardSnapshot | null; diskRoot: DashboardSnapshot["disks"][0] | null }) {
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
  snap: DashboardSnapshot | null;
  diskRoot: DashboardSnapshot["disks"][0] | null;
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
      Number.isFinite(d.usedPct) && d.usedPct && d.usedPct > 0
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
            <span className="muted mono">cpu {Number(p.cpu).toFixed(1)}%</span>
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
              mem {Number(p.mem).toFixed(1)}% • {fmtBytes(Number(p.rssBytes ?? 0))}
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

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.floor(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
