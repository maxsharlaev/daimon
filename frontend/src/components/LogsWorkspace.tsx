import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  DockerLocalListContainers,
  ListDockerRemoteLogTargets,
  ListLogFormats,
  ListLogSources,
  LogsQuery,
  LogsSyncSource,
  UpsertLogSource,
  DeleteLogSource,
} from "../../wailsjs/go/main/App";
import type { ProfileDTO } from "../types/models";
import { withHostKey } from "../ssh/hostKey";
import type { DockerContainerDTO } from "../types/docker";
import type { LogEntryDTO, LogFormatDTO, LogSourceDTO, LogsQueryResultDTO, LogsSyncResultDTO } from "../types/logs";
import { onLogsSync, startLogsEventBridge } from "../logs/events";
import { LogSourceEditorModal, type LogSourceEditorState } from "./LogSourceEditorModal";
import "./settingspage.css";
import "./logsworkspace.css";
import { DropdownSelect } from "./ui";

type Props = {
  profiles: ProfileDTO[];
};

type OwnerKind = "profile" | "docker_local" | "docker_remote";

const emptyEditor: LogSourceEditorState = {
  open: false,
  path: "",
  formatId: "builtin:generic_plain",
  displayName: "",
};

export function LogsWorkspace({ profiles }: Props) {
  const [ownerKind, setOwnerKind] = useState<OwnerKind>("profile");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedLocalContainer, setSelectedLocalContainer] = useState<string>("");
  const [selectedRemoteProfileId, setSelectedRemoteProfileId] = useState<string>("");
  const [selectedRemoteContainer, setSelectedRemoteContainer] = useState<string>("");

  const [localContainers, setLocalContainers] = useState<DockerContainerDTO[]>([]);
  const [remoteContainers, setRemoteContainers] = useState<DockerContainerDTO[]>([]);

  const [formats, setFormats] = useState<LogFormatDTO[]>([]);
  const [sources, setSources] = useState<LogSourceDTO[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [queryResult, setQueryResult] = useState<LogsQueryResultDTO>({ entries: [], total: 0, levels: [], sourcePaths: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [editor, setEditor] = useState<LogSourceEditorState>(emptyEditor);
  const [syncConfirm, setSyncConfirm] = useState<LogsSyncResultDTO | null>(null);

  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  /** Log viewer: merged entries from all configured files, or one source */
  const [viewerSourceFilterId, setViewerSourceFilterId] = useState<"all" | string>("all");
  const [ascending, setAscending] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [rightPaneTab, setRightPaneTab] = useState<"viewer" | "sources">("viewer");
  const [viewerFiltersOpen, setViewerFiltersOpen] = useState(true);
  const [messageSearch, setMessageSearch] = useState("");
  const [debouncedMessageSearch, setDebouncedMessageSearch] = useState("");

  const activeProfileId = selectedProfileId || profiles[0]?.id || "";
  useEffect(() => {
    if (!selectedProfileId && profiles[0]?.id) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    startLogsEventBridge();
    const unsub = onLogsSync((ev) => {
      if (!selectedSourceId || ev.sourceId !== selectedSourceId) return;
      if (ev.state === "running") {
        setSyncBusy(true);
        setSyncState("Syncing...");
      } else if (ev.state === "success") {
        setSyncBusy(false);
        setSyncState(`Imported ${ev.importedCount ?? 0}, skipped ${ev.skippedCount ?? 0}`);
      } else if (ev.state === "warning") {
        setSyncBusy(false);
        setSyncState(ev.message ?? "Warning");
      } else {
        setSyncBusy(false);
        setSyncState(ev.message ?? "Sync failed");
      }
    });
    return () => {
      unsub();
    };
  }, [selectedSourceId]);

  const loadFormats = useCallback(async () => {
    setFormats((await ListLogFormats()) as any);
  }, []);

  const loadLocalContainers = useCallback(async () => {
    setLocalContainers((await DockerLocalListContainers()) as any);
  }, []);

  const loadRemoteContainers = useCallback(async () => {
    if (!selectedRemoteProfileId) {
      setRemoteContainers([]);
      return;
    }
    setRemoteContainers((await withHostKey(() => ListDockerRemoteLogTargets(selectedRemoteProfileId))) as any);
  }, [selectedRemoteProfileId]);

  const sourceFilter = useMemo(() => {
    if (ownerKind === "profile") {
      return { kind: "profile", profileId: activeProfileId, containerName: "" };
    }
    if (ownerKind === "docker_local") {
      return { kind: "docker_local", profileId: "", containerName: selectedLocalContainer };
    }
    return { kind: "docker_remote", profileId: selectedRemoteProfileId, containerName: selectedRemoteContainer };
  }, [activeProfileId, ownerKind, selectedLocalContainer, selectedRemoteContainer, selectedRemoteProfileId]);

  const logsRemoteProfileOptions = useMemo(
    () => [
      { value: "", label: "Select connection" },
      ...profiles.map((p) => ({ value: p.id, label: p.name?.trim() ? p.name : p.id })),
    ],
    [profiles]
  );

  const viewerSourceFilterOptions = useMemo(
    () => [
      { value: "all", label: "All sources" },
      ...sources.map((s) => ({
        value: s.id,
        label: s.displayName?.trim() ? s.displayName : s.path,
      })),
    ],
    [sources]
  );

  const levelFilterOptions = useMemo(
    () => [
      { value: "all", label: "All" },
      ...(queryResult.levels ?? []).map((level) => ({ value: level, label: level })),
    ],
    [queryResult.levels]
  );

  const loadSources = useCallback(async () => {
    if (sourceFilter.kind === "profile" && !sourceFilter.profileId) {
      setSources([]);
      return;
    }
    if ((sourceFilter.kind === "docker_local" || sourceFilter.kind === "docker_remote") && !sourceFilter.containerName) {
      setSources([]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rows = (await ListLogSources(sourceFilter as any)) as any as LogSourceDTO[];
      setSources(rows);
      setSelectedSourceId((prev) => (rows.some((x) => x.id === prev) ? prev : rows[0]?.id ?? ""));
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSources([]);
      setSelectedSourceId("");
    } finally {
      setBusy(false);
    }
  }, [sourceFilter]);

  const loadEntries = useCallback(async () => {
    const targetReady =
      sourceFilter.kind === "profile"
        ? !!sourceFilter.profileId
        : !!sourceFilter.containerName && (sourceFilter.kind === "docker_local" || !!sourceFilter.profileId);

    if (viewerSourceFilterId === "all") {
      if (!targetReady) {
        setQueryResult({ entries: [], total: 0, levels: [], sourcePaths: [] });
        return;
      }
    } else if (!viewerSourceFilterId) {
      setQueryResult({ entries: [], total: 0, levels: [], sourcePaths: [] });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const base = {
        fromUnixMs: fromValue ? new Date(fromValue).getTime() : 0,
        toUnixMs: toValue ? new Date(toValue).getTime() : 0,
        levels: levelFilter === "all" ? [] : [levelFilter],
        ascending,
        limit: 500,
        offset: 0,
        search: debouncedMessageSearch,
      };
      const rows = (await LogsQuery(
        viewerSourceFilterId === "all"
          ? ({
              kind: sourceFilter.kind,
              profileId: sourceFilter.profileId,
              containerName: sourceFilter.containerName,
              sourceId: "",
              ...base,
            } as any)
          : ({ sourceId: viewerSourceFilterId, ...base } as any),
      )) as any as LogsQueryResultDTO;
      setQueryResult(rows);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setQueryResult({ entries: [], total: 0, levels: [], sourcePaths: [] });
    } finally {
      setBusy(false);
    }
  }, [ascending, debouncedMessageSearch, fromValue, levelFilter, sourceFilter, toValue, viewerSourceFilterId]);

  useEffect(() => {
    if (viewerSourceFilterId !== "all" && !sources.some((s) => s.id === viewerSourceFilterId)) {
      setViewerSourceFilterId("all");
    }
  }, [sources, viewerSourceFilterId]);

  useEffect(() => {
    void loadFormats();
    void loadLocalContainers();
  }, [loadFormats, loadLocalContainers]);

  useEffect(() => {
    if (ownerKind === "docker_remote") {
      void loadRemoteContainers();
    }
  }, [loadRemoteContainers, ownerKind]);

  useEffect(() => {
    if (ownerKind === "docker_local" && !selectedLocalContainer && localContainers[0]?.name) {
      setSelectedLocalContainer(localContainers[0].name);
    }
  }, [localContainers, ownerKind, selectedLocalContainer]);

  useEffect(() => {
    if (ownerKind === "docker_remote" && !selectedRemoteContainer && remoteContainers[0]?.name) {
      setSelectedRemoteContainer(remoteContainers[0].name);
    }
  }, [ownerKind, remoteContainers, selectedRemoteContainer]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedMessageSearch(messageSearch.trim()), 280);
    return () => window.clearTimeout(t);
  }, [messageSearch]);

  useEffect(() => {
    if (!editor.open) return;
    setEditor(emptyEditor);
  }, [ownerKind, activeProfileId, selectedLocalContainer, selectedRemoteProfileId, selectedRemoteContainer]);

  const saveSource = async () => {
    await UpsertLogSource({
      id: editor.id,
      kind: sourceFilter.kind,
      profileId: sourceFilter.profileId,
      containerName: sourceFilter.containerName,
      path: editor.path,
      formatId: editor.formatId,
      displayName: editor.displayName,
      optionsJson: "{}",
      enabled: true,
      order: sources.length,
    } as any);
    setEditor(emptyEditor);
    await loadSources();
  };

  const syncNow = async (forceLarge = false) => {
    if (!selectedSourceId) return;
    setSyncBusy(true);
    setSyncState("Syncing...");
    try {
      const result = (await withHostKey(() => LogsSyncSource({ sourceId: selectedSourceId, forceLarge } as any))) as any as LogsSyncResultDTO;
      if (result.needsConfirm) {
        setSyncConfirm(result);
        setSyncBusy(false);
        setSyncState(null);
        return;
      }
      await loadSources();
      await loadEntries();
    } catch (e: any) {
      setSyncBusy(false);
      setSyncState(e?.message ?? String(e));
    }
  };

  const ownerLabel =
    ownerKind === "profile"
      ? profiles.find((p) => p.id === activeProfileId)?.name ?? "Connection"
      : ownerKind === "docker_local"
        ? selectedLocalContainer || "Container"
        : `${profiles.find((p) => p.id === selectedRemoteProfileId)?.name ?? "Remote"} / ${selectedRemoteContainer || "Container"}`;

  return (
    <div className="logs-workspace panel">
      <div className="panel-titlebar">
        <div className="panel-title">Logs</div>
        <div className="panel-meta">
          <span className="muted">{ownerLabel}</span>
          {error ? <span className="error-text">{error}</span> : null}
          {syncState ? <span className="muted">{syncState}</span> : null}
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void loadSources()} disabled={busy}>
            Refresh Sources
          </button>
        </div>
      </div>

      <div className="logs-body">
        <div className="logs-toolbar-bar">
          <div className="logs-toolbar-left">
            <div className="settings-places-segments" role="tablist" aria-label="Connection type">
              <button
                type="button"
                role="tab"
                className={`settings-segment ${ownerKind === "profile" ? "active" : ""}`}
                aria-selected={ownerKind === "profile"}
                onClick={() => setOwnerKind("profile")}
              >
                SSH
              </button>
              <button
                type="button"
                role="tab"
                className={`settings-segment ${ownerKind === "docker_local" ? "active" : ""}`}
                aria-selected={ownerKind === "docker_local"}
                onClick={() => setOwnerKind("docker_local")}
              >
                Docker local
              </button>
              <button
                type="button"
                role="tab"
                className={`settings-segment ${ownerKind === "docker_remote" ? "active" : ""}`}
                aria-selected={ownerKind === "docker_remote"}
                onClick={() => setOwnerKind("docker_remote")}
              >
                Docker remote
              </button>
            </div>
          </div>
          <div className="logs-toolbar-right">
            <div className="settings-places-segments" role="tablist" aria-label="Logs panel">
              <button
                type="button"
                role="tab"
                className={`settings-segment ${rightPaneTab === "viewer" ? "active" : ""}`}
                aria-selected={rightPaneTab === "viewer"}
                onClick={() => setRightPaneTab("viewer")}
              >
                Log viewer
              </button>
              <button
                type="button"
                role="tab"
                className={`settings-segment ${rightPaneTab === "sources" ? "active" : ""}`}
                aria-selected={rightPaneTab === "sources"}
                onClick={() => setRightPaneTab("sources")}
              >
                Sources
              </button>
            </div>
            <div className="logs-toolbar-right-actions">
              {rightPaneTab === "viewer" ? (
                <button
                  type="button"
                  className={`btn btn-ghost logs-toolbar-filters-btn`}
                  aria-pressed={viewerFiltersOpen}
                  aria-label={viewerFiltersOpen ? "Hide date and level filters" : "Show date and level filters"}
                  title={viewerFiltersOpen ? "Hide filters" : "Show filters"}
                  onClick={() => setViewerFiltersOpen((v) => !v)}
                >
                  <svg className="logs-toolbar-filters-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M4 6h16v2H4V6zm3 5h10v2H7v-2zm3 5h4v2h-4v-2z"
                    />
                  </svg>
                </button>
              ) : null}
              <button
                className="btn logs-sync-btn"
                type="button"
                onClick={() => void syncNow()}
                disabled={!selectedSourceId || syncBusy}
              >
                {syncBusy ? (
                  <svg className="logs-sync-spinner" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      d="M12 3c4.97 0 9 4.03 9 9"
                    />
                  </svg>
                ) : null}
                <span>Sync</span>
              </button>
            </div>
          </div>
        </div>

        <div className="logs-main-split">
        <aside className="logs-column logs-column--connections" aria-label="Connections">
          <h2 className="logs-column-head">Connections</h2>

          <div className="logs-column-scroll">
            {ownerKind === "docker_remote" ? (
              <div className="logs-connections-field settings-logs-general">
                <DropdownSelect
                  className="settings-field-input"
                  value={selectedRemoteProfileId}
                  onChange={setSelectedRemoteProfileId}
                  options={logsRemoteProfileOptions}
                  aria-label="Connection"
                />
              </div>
            ) : null}

            <nav className="settings-master logs-connections-master" aria-label="Connection targets">
              {ownerKind === "profile" ? (
                <ul className="settings-master-list">
                  {profiles.length === 0 ? (
                    <li className="settings-master-empty muted">No SSH connections.</li>
                  ) : null}
                  {profiles.map((p) => (
                    <li key={p.id}>
                      <button
                        className={`settings-master-item logs-conn-item ${activeProfileId === p.id ? "active" : ""}`}
                        type="button"
                        onClick={() => setSelectedProfileId(p.id)}
                      >
                        <span className="logs-conn-item-title">{p.name?.trim() ? p.name : `${p.username}@${p.host}`}</span>
                        <span className="logs-conn-item-sub mono">{p.host}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {ownerKind === "docker_local" ? (
                <ul className="settings-master-list">
                  {localContainers.length === 0 ? (
                    <li className="settings-master-empty muted">No local containers.</li>
                  ) : null}
                  {localContainers.map((c) => (
                    <li key={c.id}>
                      <button
                        className={`settings-master-item logs-conn-item ${selectedLocalContainer === c.name ? "active" : ""}`}
                        type="button"
                        onClick={() => setSelectedLocalContainer(c.name)}
                      >
                        <span className="logs-conn-item-title">{c.name || c.id.slice(0, 12)}</span>
                        <span className="logs-conn-item-sub mono">{c.image}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {ownerKind === "docker_remote" ? (
                <ul className="settings-master-list">
                  {remoteContainers.length === 0 ? (
                    <li className="settings-master-empty muted">
                      {selectedRemoteProfileId ? "No containers on host." : "Pick a connection first."}
                    </li>
                  ) : null}
                  {remoteContainers.map((c) => (
                    <li key={c.id}>
                      <button
                        className={`settings-master-item logs-conn-item ${selectedRemoteContainer === c.name ? "active" : ""}`}
                        type="button"
                        onClick={() => setSelectedRemoteContainer(c.name)}
                      >
                        <span className="logs-conn-item-title">{c.name || c.id.slice(0, 12)}</span>
                        <span className="logs-conn-item-sub mono">{c.image}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </nav>
          </div>
        </aside>

        <section className="logs-column logs-column--right" aria-label="Logs workspace">
          <div className="logs-right-tab-panels">
            {rightPaneTab === "viewer" ? (
              <div className="logs-right-tab-panel logs-right-tab-panel--viewer" role="tabpanel">
                <div className={`logs-viewer-filters-anim ${viewerFiltersOpen ? "is-open" : ""}`}>
                  <div className="logs-viewer-filters-anim-inner">
                    <div className="logs-viewer-filters settings-logs-general">
                      <div className="logs-filter-grid">
                        <label className="settings-field">
                          <span className="settings-field-label" id="logs-filter-from-label">
                            From
                          </span>
                          <input
                            id="logs-filter-from"
                            className="settings-field-input"
                            type="datetime-local"
                            value={fromValue}
                            onChange={(e) => setFromValue(e.target.value)}
                            aria-labelledby="logs-filter-from-label"
                          />
                        </label>
                        <label className="settings-field">
                          <span className="settings-field-label" id="logs-filter-to-label">
                            To
                          </span>
                          <input
                            id="logs-filter-to"
                            className="settings-field-input"
                            type="datetime-local"
                            value={toValue}
                            onChange={(e) => setToValue(e.target.value)}
                            aria-labelledby="logs-filter-to-label"
                          />
                        </label>
                        <label className="settings-field">
                          <span className="settings-field-label" id="logs-filter-source-label">
                            Source
                          </span>
                          <DropdownSelect
                            id="logs-filter-source"
                            className="settings-field-input"
                            value={viewerSourceFilterId}
                            onChange={(v) => setViewerSourceFilterId(v === "all" ? "all" : v)}
                            options={viewerSourceFilterOptions}
                            searchable
                            searchPlaceholder="Filter sources…"
                            aria-labelledby="logs-filter-source-label"
                          />
                        </label>
                        <label className="settings-field">
                          <span className="settings-field-label" id="logs-filter-level-label">
                            Level
                          </span>
                          <DropdownSelect
                            id="logs-filter-level"
                            className="settings-field-input"
                            value={levelFilter}
                            onChange={setLevelFilter}
                            options={levelFilterOptions}
                            aria-labelledby="logs-filter-level-label"
                          />
                        </label>
                        <label className="settings-field">
                          <span className="settings-field-label" id="logs-filter-search-label">
                            Search in message
                          </span>
                          <input
                            id="logs-filter-search"
                            className="settings-field-input mono"
                            type="search"
                            value={messageSearch}
                            onChange={(e) => setMessageSearch(e.target.value)}
                            placeholder="Message…"
                            aria-labelledby="logs-filter-search-label"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="logs-table-wrap">
                  <table className="logs-table">
                    <colgroup>
                      <col className="logs-col-ts" />
                      <col className="logs-col-type" />
                      <col className="logs-col-source" />
                      <col className="logs-col-msg" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="logs-th-timestamp">
                          <span className="logs-th-timestamp-label">Timestamp</span>
                          <button
                            type="button"
                            className="logs-sort-dir-btn"
                            title={ascending ? "Oldest first — click for newest first" : "Newest first — click for oldest first"}
                            aria-label={ascending ? "Sort oldest first, switch to newest first" : "Sort newest first, switch to oldest first"}
                            onClick={() => setAscending((v) => !v)}
                          >
                            <span className="logs-sort-dir-icon" aria-hidden="true">
                              {ascending ? "↑" : "↓"}
                            </span>
                          </button>
                        </th>
                        <th className="logs-th-type">Type</th>
                        <th className="logs-th-source">Source</th>
                        <th className="logs-th-msg">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.entries.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="muted">
                            No log entries.
                          </td>
                        </tr>
                      ) : null}
                      {queryResult.entries.map((entry) => (
                        <Fragment key={entry.id}>
                          <tr
                            className={`log-level-${entry.level}`}
                            onClick={() => setExpandedRowId((prev) => (prev === entry.id ? null : entry.id))}
                          >
                            <td>{fmtTs(entry.timestampUnixMs, entry.timestampSource)}</td>
                            <td className="logs-td-type">
                              <span className={`log-pill log-pill-${entry.level}`}>{entry.level}</span>
                              {entry.levelSource === "guessed" ? <span className="muted"> guessed</span> : null}
                            </td>
                            <td className="mono logs-td-source">{entry.sourcePath}</td>
                            <td className="logs-td-msg">{entry.message}</td>
                          </tr>
                          {expandedRowId === entry.id ? (
                            <tr className="logs-expanded">
                              <td colSpan={4}>
                                <pre className="logs-raw">{entry.rawText}</pre>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="logs-right-tab-panel logs-right-tab-panel--sources" role="tabpanel">
                <p className="logs-sources-intro">Log files for the selected target.</p>
                <div className="logs-sources-toolbar">
                  <span className="logs-sources-toolbar-title">Files</span>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setEditor({ ...emptyEditor, open: true, formatId: formats[0]?.id ?? "builtin:generic_plain" })}
                  >
                    + File
                  </button>
                </div>
                <div className="settings-master logs-sources-master">
                  <ul className="settings-master-list">
                    {sources.length === 0 ? (
                      <li className="settings-master-empty muted">No log files for this target.</li>
                    ) : null}
                    {sources.map((s) => (
                      <li key={s.id} className="logs-source-master-row">
                        <button
                          className={`settings-master-item logs-source-master-select ${selectedSourceId === s.id ? "active" : ""}`}
                          type="button"
                          onClick={() => setSelectedSourceId(s.id)}
                        >
                          <span className="mono logs-source-master-path">{s.path}</span>
                          <span className="settings-master-sub">{formats.find((f) => f.id === s.formatId)?.name ?? s.formatId}</span>
                        </button>
                        <div className="logs-source-master-actions">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() =>
                              setEditor({
                                open: true,
                                id: s.id,
                                path: s.path,
                                formatId: s.formatId,
                                displayName: s.displayName,
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={async () => {
                              await DeleteLogSource(s.id);
                              await loadSources();
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>
        </div>
      </div>

      <LogSourceEditorModal
        open={editor.open}
        editor={editor}
        setEditor={setEditor}
        formats={formats}
        ownerKind={ownerKind}
        activeProfileId={activeProfileId}
        selectedLocalContainer={selectedLocalContainer}
        localContainers={localContainers}
        selectedRemoteProfileId={selectedRemoteProfileId}
        selectedRemoteContainer={selectedRemoteContainer}
        remoteContainers={remoteContainers}
        onSave={saveSource}
        onClose={() => setEditor(emptyEditor)}
      />

      {syncConfirm ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Large log file</div>
            <div className="modal-body">
              <div>{syncConfirm.warning}</div>
              <div className="muted" style={{ marginTop: 8 }}>
                Continue importing this file anyway?
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setSyncConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  setSyncConfirm(null);
                  await syncNow(true);
                }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fmtTs(ts: number, source: string) {
  if (!ts) return "—";
  const base = new Date(ts).toLocaleString();
  return source === "ingest_time" ? `${base} (ingest)` : base;
}
