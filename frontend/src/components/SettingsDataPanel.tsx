import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProfileDTO } from "../types/models";
import type { DockerContainerDTO } from "../types/docker";
import {
  ListDataSources,
  UpsertDataSource,
  DeleteDataSource,
  DockerLocalListContainers,
  TestDataSourceConnection,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import "./dataworkspace.css";
import { DropdownSelect } from "./ui";

type DataOwnerMode = "ssh" | "docker_local" | "docker_remote";

type ParsedScope = {
  mode: DataOwnerMode | "";
  sshProfileId?: string;
  containerId?: string;
  containerName?: string;
};

function parseDataScope(scopeJson: string): ParsedScope | null {
  try {
    const o = JSON.parse(scopeJson) as Record<string, unknown>;
    const mode = String(o.mode || "").toLowerCase();
    return {
      mode: (mode === "ssh" || mode === "docker_local" || mode === "docker_remote" ? mode : "") as ParsedScope["mode"],
      sshProfileId: typeof o.sshProfileId === "string" ? o.sshProfileId : undefined,
      containerId: typeof o.containerId === "string" ? o.containerId : undefined,
      containerName: typeof o.containerName === "string" ? o.containerName : undefined,
    };
  } catch {
    return null;
  }
}

function profileLabel(p: ProfileDTO): string {
  return (p.name?.trim() ? p.name : `${p.username}@${p.host}`) as string;
}

type GroupBucket = {
  key: string;
  label: string;
  sources: main.DataSourceDTO[];
};

export function SettingsDataPanel({ profiles }: { profiles: ProfileDTO[] }) {
  const [ownerMode, setOwnerMode] = useState<DataOwnerMode>("ssh");
  const [allSources, setAllSources] = useState<main.DataSourceDTO[]>([]);
  const [localContainers, setLocalContainers] = useState<DockerContainerDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  const [editScopeJson, setEditScopeJson] = useState("");
  const [editName, setEditName] = useState("");
  const [editEngine, setEditEngine] = useState<"postgres" | "mysql">("postgres");
  const [editHost, setEditHost] = useState("127.0.0.1");
  const [editPort, setEditPort] = useState(5432);
  const [editUser, setEditUser] = useState("");
  const [editDatabase, setEditDatabase] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editStorage, setEditStorage] = useState<"keyring" | "internal">("keyring");
  const [dataSourceTestState, setDataSourceTestState] = useState<{
    status: "idle" | "running" | "success" | "error";
    message?: string;
  }>({ status: "idle" });

  const [deletePending, setDeletePending] = useState<main.DataSourceDTO | null>(null);

  const loadSources = useCallback(async () => {
    setLoadErr(null);
    try {
      const raw = (await ListDataSources("", "", "")) as main.DataSourceDTO[];
      setAllSources(raw ?? []);
    } catch (e: any) {
      setLoadErr(e?.message ?? String(e));
      setAllSources([]);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    void DockerLocalListContainers()
      .then((c) => setLocalContainers((c as DockerContainerDTO[]) ?? []))
      .catch(() => setLocalContainers([]));
  }, []);

  const profilesById = useMemo(() => {
    const m = new Map<string, ProfileDTO>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const localContainerLabel = useCallback(
    (id: string) => localContainers.find((c) => c.id === id)?.name || id,
    [localContainers]
  );

  const filtered = useMemo(() => {
    return allSources.filter((src) => {
      const sc = parseDataScope(src.scopeJson);
      return sc?.mode === ownerMode;
    });
  }, [allSources, ownerMode]);

  const grouped = useMemo((): GroupBucket[] => {
    const map = new Map<string, main.DataSourceDTO[]>();
    const keyLabel = new Map<string, string>();

    for (const src of filtered) {
      const sc = parseDataScope(src.scopeJson);
      if (!sc || sc.mode !== ownerMode) continue;

      let gk: string;
      let gl: string;

      if (ownerMode === "ssh") {
        const pid = sc.sshProfileId || "";
        gk = `ssh:${pid}`;
        const p = profilesById.get(pid);
        gl = p ? profileLabel(p) : pid ? `Profile ${pid.slice(0, 8)}…` : "Unknown SSH profile";
      } else if (ownerMode === "docker_local") {
        const cid = sc.containerId || sc.containerName || "";
        gk = `dl:${cid}`;
        gl = cid ? `Docker local · ${localContainerLabel(cid)}` : "Unknown container";
      } else {
        const pid = sc.sshProfileId || "";
        const cid = sc.containerId || sc.containerName || "";
        gk = `dr:${pid}:${cid}`;
        const p = profilesById.get(pid);
        const ph = p ? profileLabel(p) : pid ? `Profile ${pid.slice(0, 8)}…` : "Unknown host";
        gl = `${ph} · ${cid || "?"}`;
      }

      if (!map.has(gk)) {
        map.set(gk, []);
        keyLabel.set(gk, gl);
      }
      map.get(gk)!.push(src);
    }

    const keys = [...map.keys()].sort((a, b) =>
      (keyLabel.get(a) || a).localeCompare(keyLabel.get(b) || b, undefined, { sensitivity: "base" })
    );
    return keys.map((key) => ({
      key,
      label: keyLabel.get(key) || key,
      sources: (map.get(key) ?? []).slice().sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
      ),
    }));
  }, [filtered, ownerMode, profilesById, localContainerLabel]);

  const openEdit = (src: main.DataSourceDTO) => {
    setDataSourceTestState({ status: "idle" });
    setEditSourceId(src.id);
    setEditScopeJson(src.scopeJson || "{}");
    setEditName(src.name);
    setEditEngine(src.engine === "mysql" ? "mysql" : "postgres");
    setEditHost(src.host);
    setEditPort(src.port);
    setEditUser(src.username);
    setEditDatabase(src.database);
    setEditPassword("");
    setEditStorage("keyring");
    setModalOpen(true);
  };

  const scopeModeForTest = useMemo(() => parseDataScope(editScopeJson)?.mode ?? "", [editScopeJson]);

  const canTestDataSource = useMemo(() => {
    if (busy) return false;
    if (!editHost.trim()) return false;
    if (!editPort || editPort <= 0) return false;
    if (!editUser.trim()) return false;
    if (scopeModeForTest === "docker_remote") return false;
    if (scopeModeForTest === "docker_local") {
      const sc = parseDataScope(editScopeJson);
      const cid = sc?.containerId || sc?.containerName;
      if (!cid?.trim()) return false;
    }
    return true;
  }, [busy, editHost, editPort, editUser, editScopeJson, scopeModeForTest]);

  const dataSourceTestDisabledReason = useMemo(() => {
    if (busy) return "Busy";
    if (!editHost.trim()) return "Host is required";
    if (!editPort || editPort <= 0) return "Port is required";
    if (!editUser.trim()) return "User is required";
    if (scopeModeForTest === "docker_remote") return "Test from Settings is not available for Docker remote (use Data tab with a live remote Docker session)";
    if (scopeModeForTest === "docker_local") {
      const sc = parseDataScope(editScopeJson);
      if (!(sc?.containerId || sc?.containerName)?.trim()) return "Scope has no container id";
    }
    return null;
  }, [busy, editHost, editPort, editUser, editScopeJson, scopeModeForTest]);

  const testConnection = async () => {
    setBusy(true);
    setDataSourceTestState({ status: "running" });
    try {
      await TestDataSourceConnection(
        new main.TestDataSourceConnectionRequest({
          engine: editEngine,
          host: editHost,
          port: editPort,
          username: editUser,
          database: editDatabase,
          password: editPassword,
          scopeJson: editScopeJson,
          remoteDockerSessionId: "",
        })
      );
      setDataSourceTestState({ status: "success", message: "Connection OK" });
    } catch (e: any) {
      setDataSourceTestState({ status: "error", message: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editName.trim() || !editSourceId) return;
    setBusy(true);
    try {
      await UpsertDataSource(
        new main.UpsertDataSourceRequest({
          id: editSourceId,
          name: editName.trim(),
          engine: editEngine,
          host: editHost,
          port: editPort,
          username: editUser,
          database: editDatabase,
          scopeJson: editScopeJson,
          password: editPassword,
          passwordStorage: editStorage,
        })
      );
      setModalOpen(false);
      setEditSourceId(null);
      setEditPassword("");
      void loadSources();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletePending) return;
    setBusy(true);
    try {
      await DeleteDataSource(deletePending.id);
      setDeletePending(null);
      void loadSources();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!modalOpen) return;
    setDataSourceTestState({ status: "idle" });
  }, [modalOpen, editEngine, editHost, editPort, editUser, editDatabase, editPassword, editScopeJson]);

  return (
    <div className="settings-data-panel">
      <div className="settings-section-title">Data sources</div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Saved database connections for the Data workspace, grouped by SSH profile or Docker scope. Scope is fixed per
        source; edit host, credentials, and labels here.
      </p>

      {loadErr ? <div className="error-text">{loadErr}</div> : null}

      <div className="settings-places-topbar" style={{ marginBottom: 16 }}>
        <div className="settings-places-segments" role="tablist" aria-label="Data source transport">
          {(["ssh", "docker_local", "docker_remote"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              className={`settings-segment ${ownerMode === m ? "active" : ""}`}
              aria-selected={ownerMode === m}
              onClick={() => setOwnerMode(m)}
            >
              {m === "ssh" ? "SSH" : m === "docker_local" ? "Docker local" : "Docker remote"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void loadSources()}>
          Refresh
        </button>
      </div>

      {grouped.length === 0 ? (
        <div className="muted">No saved data sources for this transport type.</div>
      ) : (
        <div className="settings-data-groups">
          {grouped.map((g) => (
            <div key={g.key} className="settings-data-group">
              <h4 className="settings-data-group-title">{g.label}</h4>
              <ul className="settings-data-source-list">
                {g.sources.map((src) => (
                  <li key={src.id} className="settings-data-source-row">
                    <div className="settings-data-source-main">
                      <div className="settings-data-source-name">{src.name}</div>
                      <div className="settings-data-source-sub mono">
                        {src.engine} · {src.username}@{src.host}:{src.port}
                        {src.hasSecret ? " · password stored" : ""}
                      </div>
                    </div>
                    <div className="settings-data-source-actions">
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => openEdit(src)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => setDeletePending(src)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {modalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal data-modal">
            <div className="modal-title">Edit Data Source</div>
            <div className="modal-body form data-new-source-body">
              <div className="data-new-source-scope" role="status">
                <div className="data-new-source-scope-label">Connection scope (read-only)</div>
                <div className="data-new-source-scope-value mono">{editScopeJson}</div>
              </div>
              <div className="row two">
                <div className="row">
                  <label>Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                </div>
                <div className="row">
                  <label>Engine</label>
                  <DropdownSelect
                    className="docker-select"
                    value={editEngine}
                    onChange={(v) => {
                      const eng = v as "postgres" | "mysql";
                      setEditEngine(eng);
                      setEditPort(eng === "postgres" ? 5432 : 3306);
                    }}
                    options={[
                      { value: "postgres", label: "PostgreSQL" },
                      { value: "mysql", label: "MySQL / MariaDB" },
                    ]}
                    aria-label="Database engine"
                  />
                </div>
              </div>
              <div className="row two">
                <div className="row">
                  <label>Host</label>
                  <input className="mono" value={editHost} onChange={(e) => setEditHost(e.target.value)} />
                </div>
                <div className="row">
                  <label>Port</label>
                  <input
                    type="number"
                    value={editPort}
                    onChange={(e) => setEditPort(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>
              <div className="row two">
                <div className="row">
                  <label>User</label>
                  <input value={editUser} onChange={(e) => setEditUser(e.target.value)} />
                </div>
                <div className="row">
                  <label>Database</label>
                  <input className="mono" value={editDatabase} onChange={(e) => setEditDatabase(e.target.value)} placeholder="optional" />
                </div>
              </div>
              <div className="row two">
                <div className="row">
                  <label>Password</label>
                  <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
                </div>
                <div className="row">
                  <label>Password storage</label>
                  <DropdownSelect
                    className="docker-select"
                    value={editStorage}
                    onChange={(v) => setEditStorage(v as "keyring" | "internal")}
                    options={[
                      { value: "keyring", label: "OS keyring" },
                      { value: "internal", label: "Internal vault" },
                    ]}
                    aria-label="Password storage"
                  />
                </div>
              </div>
              <p className="data-hint">Leave password empty to keep the saved password.</p>
            </div>
            <div className="data-modal-footer">
              <div className="data-modal-footer-left">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!canTestDataSource}
                  title={dataSourceTestDisabledReason ?? "Test database connection"}
                  onClick={() => void testConnection()}
                >
                  Test
                </button>
                <div className="data-test-status">
                  {!canTestDataSource && dataSourceTestDisabledReason ? (
                    <span className="data-test-hint">{dataSourceTestDisabledReason}</span>
                  ) : dataSourceTestState.status !== "idle" ? (
                    <>
                      <span
                        className={`data-test-indicator data-test-${dataSourceTestState.status}`}
                        title={dataSourceTestState.message ?? ""}
                      >
                        {dataSourceTestState.status === "running" ? "…" : dataSourceTestState.status === "success" ? "✓" : "✕"}
                      </span>
                      <span className={`data-test-text data-test-text-${dataSourceTestState.status}`}>
                        {dataSourceTestState.status === "running"
                          ? "Testing…"
                          : dataSourceTestState.status === "success"
                            ? "Connection successful"
                            : "Connection failed"}
                      </span>
                    </>
                  ) : (
                    <span className="data-test-hint">Ready to test</span>
                  )}
                </div>
              </div>
              <div className="data-modal-footer-right">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setModalOpen(false);
                    setEditSourceId(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void saveEdit()}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deletePending ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Delete data source?</div>
            <div className="modal-body">
              <div>
                Delete <strong>{deletePending.name}</strong> ({deletePending.engine} · {deletePending.username}@
                {deletePending.host}:{deletePending.port})?
              </div>
              <div className="muted">Stored credentials for this source will be removed. This cannot be undone.</div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDeletePending(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
