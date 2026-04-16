import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SplitView } from "./SplitView";
import type { ProfileDTO, ProfileGroupDTO } from "../types/models";
import type { DockerContainerDTO } from "../types/docker";
import {
  ListDataSources,
  UpsertDataSource,
  DeleteDataSource,
  DataConnect,
  DataDisconnect,
  DataListDatabases,
  DataListSchemas,
  DataListTables,
  DataListTableColumns,
  DataTablePreview,
  DataExecSQL,
  DataPrimaryKeyColumns,
  DataUpdateRow,
  DataDeleteRow,
  DockerLocalListContainers,
  DockerRemoteConnectProfile,
  DockerRemoteDisconnect,
  DockerRemoteListContainers,
  TestDataSourceConnection,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import "./dataworkspace.css";
import "./connections.css";
import "./terminaltabs.css";

type OwnerMode = "ssh" | "docker_local" | "docker_remote";

const PREVIEW_PAGE_SIZE = 100;

function profileLabelSortKey(p: ProfileDTO): string {
  return (p.name?.trim() ? p.name : `${p.username}@${p.host}`).toLowerCase();
}

function dataEngineIcon(engine: string): string {
  return engine === "mysql" ? "🐬" : "🐘";
}

function dataEngineDisplay(engine: string): string {
  return engine === "mysql" ? "MySQL" : "PostgreSQL";
}

type DataSess = {
  sessionId: string;
  dataSourceId: string;
  name: string;
  engine: string;
  /** Transport label for tabs (SSH profile, container, …) — like Connections “connection”. */
  scopeSummary: string;
};

type DataTabSnapshot = {
  selectedDb: string;
  selectedTable: string;
  sqlText: string;
  innerTab: "table" | "sql";
  /** Not persisted; refetched on session switch. */
  preview?: main.DataQueryResultDTO | null;
  sqlResult: main.DataQueryResultDTO | null;
  /** SQL tab: textarea + Run visible (default true). */
  sqlEditorExpanded?: boolean;
  /** SQL tab: right rail with table + column list. */
  sqlSchemaBrowserOpen?: boolean;
  /** Table view: current page (1-based). */
  previewPage?: number;
  /** Table preview ORDER BY (last applied). */
  previewSortColumn?: string;
  previewSortDir?: string;
};

type PreviewSort = { column: string | null; dir: "asc" | "desc" | null };

function previewSortToApi(s: PreviewSort): [string, string] {
  if (!s.column || !s.dir) return ["", ""];
  return [s.column, s.dir];
}

function previewSortEqual(a: PreviewSort, b: PreviewSort): boolean {
  return a.column === b.column && a.dir === b.dir;
}

function scopeForMode(
  mode: OwnerMode,
  sshProfileId: string,
  localContainer: string,
  remoteProfileId: string,
  remoteContainer: string
): string {
  if (mode === "ssh") {
    return JSON.stringify({ mode: "ssh", sshProfileId });
  }
  if (mode === "docker_local") {
    return JSON.stringify({ mode: "docker_local", containerId: localContainer });
  }
  return JSON.stringify({
    mode: "docker_remote",
    sshProfileId: remoteProfileId,
    containerId: remoteContainer,
  });
}

export function DataWorkspace({ profiles, groups }: { profiles: ProfileDTO[]; groups: ProfileGroupDTO[] }) {
  const [ownerMode, setOwnerMode] = useState<OwnerMode>("ssh");
  const [sshGroupFilter, setSshGroupFilter] = useState<string>("all");
  const [sshProfileId, setSshProfileId] = useState("");
  const [localContainers, setLocalContainers] = useState<DockerContainerDTO[]>([]);
  const [localContainer, setLocalContainer] = useState("");
  const [remoteGroupFilter, setRemoteGroupFilter] = useState<string>("all");
  const [remoteProfileId, setRemoteProfileId] = useState("");
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteContainers, setRemoteContainers] = useState<DockerContainerDTO[]>([]);
  const [remoteContainer, setRemoteContainer] = useState("");

  const [sources, setSources] = useState<main.DataSourceDTO[]>([]);
  const [sourcesErr, setSourcesErr] = useState<string | null>(null);

  const [sessions, setSessions] = useState<DataSess[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [innerTab, setInnerTab] = useState<"table" | "sql">("table");

  const [databases, setDatabases] = useState<string[]>([]);
  /** PostgreSQL: cluster database names (read-only in header). Selectable namespaces live in `databases`. */
  const [postgresClusterDBs, setPostgresClusterDBs] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableListFilter, setTableListFilter] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");
  const [previewSort, setPreviewSort] = useState<PreviewSort>({ column: null, dir: null });
  const [previewSortQuery, setPreviewSortQuery] = useState<PreviewSort>({ column: null, dir: null });
  const [preview, setPreview] = useState<main.DataQueryResultDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sqlText, setSqlText] = useState("SELECT 1");
  const [sqlResult, setSqlResult] = useState<main.DataQueryResultDTO | null>(null);
  /** SQL workspace: show script + Run above results (default on). */
  const [sqlEditorExpanded, setSqlEditorExpanded] = useState(true);
  /** SQL tab: sidebar with table picker + column types. */
  const [sqlSchemaBrowserOpen, setSqlSchemaBrowserOpen] = useState(false);
  const [sqlRailColumns, setSqlRailColumns] = useState<main.DataColumnMetaDTO[]>([]);
  const [busy, setBusy] = useState(false);
  /** Data source currently in DataConnect — card marker shows orange until success or error. */
  const [connectingDataSourceId, setConnectingDataSourceId] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
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

  /** null = creating new source; set when editing existing */
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  /** Scope JSON sent on save (from current filters for new, from source for edit). */
  const [editScopeJson, setEditScopeJson] = useState("");

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuItems, setMenuItems] = useState<ContextMenuItem[]>([]);

  const [deleteSourcePending, setDeleteSourcePending] = useState<main.DataSourceDTO | null>(null);

  const [rowModal, setRowModal] = useState<{
    open: boolean;
    row: Record<string, string>;
    pkCols: string[];
    pkVals: string[];
  } | null>(null);

  const dataTabSnapshotsRef = useRef<Record<string, DataTabSnapshot>>({});
  const tablePreviewScrollRef = useRef<HTMLDivElement | null>(null);
  /** Skip one sort reset when `selectedTable`/`activeSessionId` updates after session restore from snapshot. */
  const skipPreviewSortResetRef = useRef(false);

  const hasSqlResultTable = useMemo(() => {
    return (
      sqlResult != null &&
      Array.isArray(sqlResult.columns) &&
      sqlResult.columns.length > 0 &&
      Array.isArray(sqlResult.rows)
    );
  }, [sqlResult]);

  /** Allow hiding the SQL editor only after non-empty query and a tabular result. */
  const canHideSqlEditor = useMemo(() => sqlText.trim() !== "" && hasSqlResultTable, [sqlText, hasSqlResultTable]);

  useEffect(() => {
    if (!canHideSqlEditor) setSqlEditorExpanded(true);
  }, [canHideSqlEditor]);

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [groups]
  );

  const filteredSSHProfiles = useMemo(() => {
    return profiles
      .filter((p) => sshGroupFilter === "all" || p.groupId === sshGroupFilter)
      .sort((a, b) =>
        profileLabelSortKey(a).localeCompare(profileLabelSortKey(b), undefined, { sensitivity: "base" })
      );
  }, [profiles, sshGroupFilter]);

  const filteredRemoteProfiles = useMemo(() => {
    return profiles
      .filter((p) => remoteGroupFilter === "all" || p.groupId === remoteGroupFilter)
      .sort((a, b) =>
        profileLabelSortKey(a).localeCompare(profileLabelSortKey(b), undefined, { sensitivity: "base" })
      );
  }, [profiles, remoteGroupFilter]);

  useEffect(() => {
    if (ownerMode !== "ssh") return;
    if (filteredSSHProfiles.length === 0) {
      setSshProfileId("");
      return;
    }
    if (!filteredSSHProfiles.some((p) => p.id === sshProfileId)) {
      setSshProfileId(filteredSSHProfiles[0].id);
    }
  }, [ownerMode, filteredSSHProfiles, sshProfileId]);

  const activeProfileId = sshProfileId || filteredSSHProfiles[0]?.id || "";

  const buildDataScopeSummary = useCallback((): string => {
    if (ownerMode === "ssh") {
      const p = profiles.find((x) => x.id === activeProfileId);
      return p?.name?.trim() || (p ? `${p.username}@${p.host}` : "SSH");
    }
    if (ownerMode === "docker_local") {
      const c = localContainers.find((x) => x.id === localContainer);
      return c?.name || localContainer || "Docker local";
    }
    const p = profiles.find((x) => x.id === remoteProfileId);
    const c = remoteContainers.find((x) => x.id === remoteContainer);
    const host = p?.name?.trim() || (p ? `${p.username}@${p.host}` : "Remote");
    const cn = c?.name || remoteContainer || "container";
    return `${host} · ${cn}`;
  }, [
    ownerMode,
    profiles,
    activeProfileId,
    localContainers,
    localContainer,
    remoteProfileId,
    remoteContainers,
    remoteContainer,
  ]);

  const filterParams = useMemo(() => {
    if (ownerMode === "ssh") return { mode: "ssh", a: activeProfileId, b: "" };
    if (ownerMode === "docker_local") return { mode: "docker_local", a: "", b: localContainer };
    return { mode: "docker_remote", a: remoteProfileId, b: remoteContainer };
  }, [ownerMode, activeProfileId, localContainer, remoteProfileId, remoteContainer]);

  const loadSources = useCallback(async () => {
    setSourcesErr(null);
    try {
      const list = (await ListDataSources(filterParams.mode, filterParams.a, filterParams.b)) as main.DataSourceDTO[];
      setSources(list ?? []);
    } catch (e: any) {
      setSourcesErr(e?.message ?? String(e));
    }
  }, [filterParams]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const openMenu = useCallback((anchor: HTMLElement, items: ContextMenuItem[]) => {
    setMenuAnchor(anchor);
    setMenuItems(items);
    setMenuOpen(true);
  }, []);

  const openNewSourceModal = useCallback(() => {
    setDataSourceTestState({ status: "idle" });
    setEditSourceId(null);
    setEditScopeJson(
      scopeForMode(ownerMode, activeProfileId, localContainer, remoteProfileId, remoteContainer)
    );
    setEditName("");
    setEditEngine("postgres");
    setEditHost("127.0.0.1");
    setEditPort(5432);
    setEditUser("");
    setEditDatabase("");
    setEditPassword("");
    setEditStorage("keyring");
    setNewOpen(true);
  }, [ownerMode, activeProfileId, localContainer, remoteProfileId, remoteContainer]);

  const openEditSource = useCallback((src: main.DataSourceDTO) => {
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
    setNewOpen(true);
  }, []);

  useEffect(() => {
    void DockerLocalListContainers()
      .then((c) => setLocalContainers((c as DockerContainerDTO[]) ?? []))
      .catch(() => setLocalContainers([]));
  }, [ownerMode]);

  const connectRemoteDocker = async () => {
    if (!remoteProfileId) return;
    setRemoteBusy(true);
    try {
      const sid = await DockerRemoteConnectProfile(remoteProfileId);
      setRemoteSessionId(sid as string);
      const list = (await DockerRemoteListContainers(sid as string)) as DockerContainerDTO[];
      setRemoteContainers(list ?? []);
      if (list?.[0]?.id) setRemoteContainer(list[0].id);
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const disconnectRemoteDocker = useCallback(async () => {
    const sid = remoteSessionId;
    if (!sid) return;
    setRemoteBusy(true);
    try {
      await DockerRemoteDisconnect(sid);
      setRemoteSessionId(null);
      setRemoteContainers([]);
    } finally {
      setRemoteBusy(false);
    }
  }, [remoteSessionId]);

  useEffect(() => {
    if (ownerMode !== "docker_remote") return;
    if (filteredRemoteProfiles.length === 0) {
      if (remoteSessionId) void disconnectRemoteDocker();
      setRemoteProfileId("");
      return;
    }
    if (!filteredRemoteProfiles.some((p) => p.id === remoteProfileId)) {
      if (remoteSessionId) void disconnectRemoteDocker();
      setRemoteProfileId(filteredRemoteProfiles[0].id);
    }
  }, [ownerMode, filteredRemoteProfiles, remoteProfileId, remoteSessionId, disconnectRemoteDocker]);

  const activateDataSession = useCallback(
    (sessionId: string | null) => {
      if (activeSessionId) {
        const [psc, psd] = previewSortToApi(previewSortQuery);
        dataTabSnapshotsRef.current[activeSessionId] = {
          selectedDb,
          selectedTable,
          sqlText,
          innerTab,
          preview: null,
          sqlResult,
          sqlEditorExpanded,
          sqlSchemaBrowserOpen,
          previewPage,
          previewSortColumn: psc,
          previewSortDir: psd,
        };
      }
      setRowModal(null);
      if (!sessionId) {
        setSelectedDb("");
        setSelectedTable("");
        setPreview(null);
        setSqlResult(null);
        setSqlText("SELECT 1");
        setInnerTab("table");
        setSqlEditorExpanded(true);
        setSqlSchemaBrowserOpen(false);
        setPreviewPage(1);
        setPreviewSort({ column: null, dir: null });
        setPreviewSortQuery({ column: null, dir: null });
        setPreviewLoading(false);
        setPreviewError(null);
        setActiveSessionId(null);
        return;
      }
      const snap = dataTabSnapshotsRef.current[sessionId];
      setSelectedDb(snap?.selectedDb ?? "");
      setSelectedTable(snap?.selectedTable ?? "");
      setSqlText(snap?.sqlText ?? "SELECT 1");
      setInnerTab(snap?.innerTab ?? "table");
      setPreview(null);
      setSqlResult(snap?.sqlResult ?? null);
      setSqlEditorExpanded(snap?.sqlEditorExpanded ?? true);
      setSqlSchemaBrowserOpen(snap?.sqlSchemaBrowserOpen ?? false);
      setPreviewPage(snap?.previewPage ?? 1);
      const rs = snap?.previewSortDir;
      const rc = (snap?.previewSortColumn ?? "").trim();
      const rdir = rs === "asc" || rs === "desc" ? rs : null;
      const rsort: PreviewSort =
        rc && rdir ? { column: rc, dir: rdir } : { column: null, dir: null };
      skipPreviewSortResetRef.current = true;
      setPreviewSort(rsort);
      setPreviewSortQuery(rsort);
      setActiveSessionId(sessionId);
    },
    [
      activeSessionId,
      selectedDb,
      selectedTable,
      sqlText,
      innerTab,
      sqlResult,
      sqlEditorExpanded,
      sqlSchemaBrowserOpen,
      previewPage,
      previewSortQuery,
    ]
  );

  const handleConnectSource = async (src: main.DataSourceDTO) => {
    setBusy(true);
    setConnectingDataSourceId(src.id);
    try {
      const req = new main.DataConnectRequest({
        dataSourceId: src.id,
        remoteDockerSessionId: ownerMode === "docker_remote" ? remoteSessionId ?? "" : "",
      });
      const res = (await DataConnect(req)) as main.DataSessionDTO;
      if (!res.sessionId) throw new Error("no session");
      const scopeSummary = buildDataScopeSummary();
      setSessions((prev) => {
        if (prev.some((s) => s.sessionId === res.sessionId)) return prev;
        return [
          ...prev,
          {
            sessionId: res.sessionId,
            dataSourceId: src.id,
            name: src.name,
            engine: src.engine,
            scopeSummary,
          },
        ];
      });
      activateDataSession(res.sessionId);
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setConnectingDataSourceId(null);
      setBusy(false);
    }
  };

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId) ?? null;

  const activeEngine = useMemo(() => (activeSession?.engine ?? "").toLowerCase(), [activeSession?.engine]);

  const filteredTableNames = useMemo(() => {
    const q = tableListFilter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.toLowerCase().includes(q));
  }, [tables, tableListFilter]);

  const visibleTableNames = useMemo(() => {
    if (selectedTable && !filteredTableNames.includes(selectedTable)) {
      return [selectedTable, ...filteredTableNames];
    }
    return filteredTableNames;
  }, [filteredTableNames, selectedTable]);

  const previewTotalRows = Number(preview?.totalRows ?? 0);
  const previewTotalPages = Math.max(1, Math.ceil(previewTotalRows / PREVIEW_PAGE_SIZE) || 1);

  const commitPageJump = useCallback(() => {
    const maxPage = preview && selectedTable ? previewTotalPages : 1;
    let n = parseInt(pageJumpInput.trim(), 10);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > maxPage) n = maxPage;
    setPreviewPage(n);
    setPageJumpInput(String(n));
  }, [pageJumpInput, preview, selectedTable, previewTotalPages]);

  useEffect(() => {
    setPageJumpInput(String(previewPage));
  }, [previewPage]);

  useEffect(() => {
    setTableListFilter("");
  }, [activeSessionId, selectedDb]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPreviewSortQuery((q) => (previewSortEqual(q, previewSort) ? q : previewSort));
    }, 500);
    return () => window.clearTimeout(t);
  }, [previewSort]);

  useEffect(() => {
    if (skipPreviewSortResetRef.current) {
      skipPreviewSortResetRef.current = false;
      return;
    }
    const cleared: PreviewSort = { column: null, dir: null };
    setPreviewSort((prev) => (previewSortEqual(prev, cleared) ? prev : cleared));
    setPreviewSortQuery((prev) => (previewSortEqual(prev, cleared) ? prev : cleared));
  }, [selectedTable, activeSessionId]);

  useEffect(() => {
    const el = tablePreviewScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [selectedTable, previewSortQuery]);

  useEffect(() => {
    if (!preview || !selectedTable) return;
    if (previewPage > previewTotalPages) setPreviewPage(previewTotalPages);
  }, [preview, previewPage, previewTotalPages, selectedTable]);

  useEffect(() => {
    if (activeSessionId && !sessions.some((s) => s.sessionId === activeSessionId)) {
      activateDataSession(sessions[0]?.sessionId ?? null);
      return;
    }
    if (!activeSessionId && sessions.length > 0) {
      activateDataSession(sessions[0].sessionId);
    }
  }, [sessions, activeSessionId, activateDataSession]);

  useEffect(() => {
    if (!activeSessionId) {
      setDatabases([]);
      setPostgresClusterDBs([]);
      setTables([]);
      setPreview(null);
      setSqlResult(null);
      setSelectedDb("");
      setSelectedTable("");
      setPreviewPage(1);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    setDatabases([]);
    setPostgresClusterDBs([]);
    setTables([]);
    const sid = activeSessionId;
    let cancelled = false;
    void (async () => {
      try {
        if (activeEngine === "postgres") {
          const [rawSchemas, rawCluster] = await Promise.all([DataListSchemas(sid), DataListDatabases(sid)]);
          if (cancelled) return;
          const schemas = Array.isArray(rawSchemas) ? rawSchemas : [];
          const cluster = Array.isArray(rawCluster) ? rawCluster : [];
          setDatabases(schemas);
          setPostgresClusterDBs(cluster.filter((d) => !schemas.includes(d)));
          setSelectedDb((prev) => {
            if (prev && schemas.includes(prev)) return prev;
            return schemas[0] ?? "";
          });
        } else {
          const raw = await DataListDatabases(sid);
          if (cancelled) return;
          const list = Array.isArray(raw) ? raw : [];
          setDatabases(list);
          setPostgresClusterDBs([]);
          setSelectedDb((prev) => {
            if (prev && list.includes(prev)) return prev;
            return list[0] ?? "";
          });
        }
      } catch {
        if (!cancelled) {
          setDatabases([]);
          setPostgresClusterDBs([]);
          setSelectedDb("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeEngine]);

  useEffect(() => {
    if (!activeSessionId || !selectedTable || !sqlSchemaBrowserOpen || innerTab !== "sql") {
      setSqlRailColumns([]);
      return;
    }
    const sid = activeSessionId;
    const db = selectedDb;
    const tbl = selectedTable;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await DataListTableColumns(sid, db, tbl);
        if (cancelled) return;
        const list = Array.isArray(raw) ? raw : [];
        setSqlRailColumns(list.map((row) => new main.DataColumnMetaDTO(row as any)));
      } catch {
        if (!cancelled) setSqlRailColumns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb, selectedTable, sqlSchemaBrowserOpen, innerTab]);

  useEffect(() => {
    if (!activeSessionId || !selectedDb) {
      setTables([]);
      return;
    }
    const sid = activeSessionId;
    const db = selectedDb;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await DataListTables(sid, db);
        if (cancelled) return;
        const t = Array.isArray(raw) ? raw : [];
        setTables(t);
        setSelectedTable((prev) => (prev && t.includes(prev) ? prev : ""));
      } catch {
        if (!cancelled) {
          setTables([]);
          setSelectedTable("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb]);

  useEffect(() => {
    if (!activeSessionId || !selectedTable) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    const sid = activeSessionId;
    const db = selectedDb;
    const tbl = selectedTable;
    const offset = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    let cancelled = false;
    const [sc, sd] = previewSortToApi(previewSortQuery);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    void (async () => {
      try {
        const r = (await DataTablePreview(sid, db, tbl, PREVIEW_PAGE_SIZE, offset, sc, sd)) as main.DataQueryResultDTO;
        if (cancelled) return;
        if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) {
          setPreview(r);
        } else {
          setPreview(null);
          setPreviewError("Unexpected preview response.");
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb, selectedTable, previewPage, previewSortQuery]);

  const handlePreviewSortClick = useCallback((col: string) => {
    setPreviewSort((prev) => {
      if (prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return { column: null, dir: null };
    });
  }, []);

  const runSql = async () => {
    if (!activeSessionId) return;
    setBusy(true);
    try {
      const r = (await DataExecSQL(activeSessionId, selectedDb, sqlText)) as main.DataQueryResultDTO;
      if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) setSqlResult(r);
      else setSqlResult(null);
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectSession = async (sid: string) => {
    setBusy(true);
    try {
      await DataDisconnect(sid);
      delete dataTabSnapshotsRef.current[sid];
      setSessions((p) => p.filter((x) => x.sessionId !== sid));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteDataSource = async () => {
    if (!deleteSourcePending) return;
    const src = deleteSourcePending;
    const toClose = sessions.filter((s) => s.dataSourceId === src.id);
    setBusy(true);
    try {
      for (const s of toClose) {
        try {
          await DataDisconnect(s.sessionId);
        } catch {
          /* ignore */
        }
        delete dataTabSnapshotsRef.current[s.sessionId];
      }
      const nextSessions = sessions.filter((x) => x.dataSourceId !== src.id);
      setSessions(nextSessions);
      if (toClose.some((t) => t.sessionId === activeSessionId)) {
        activateDataSession(nextSessions[0]?.sessionId ?? null);
      }
      await DeleteDataSource(src.id);
      setDeleteSourcePending(null);
      void loadSources();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const openRow = async (row: string[]) => {
    if (!activeSessionId || !selectedTable || !preview || !Array.isArray(preview.columns)) return;
    const obj: Record<string, string> = {};
    preview.columns.forEach((c, i) => {
      obj[c] = row[i] ?? "";
    });
    try {
      const pk = (await DataPrimaryKeyColumns(activeSessionId, selectedDb, selectedTable)) as string[];
      const pkVals = pk.map((c) => obj[c] ?? "");
      setRowModal({ open: true, row: { ...obj }, pkCols: pk, pkVals });
    } catch {
      alert("Could not resolve primary key for this table.");
    }
  };

  const saveRowModal = async () => {
    if (!rowModal || !activeSessionId || !selectedTable) return;
    setBusy(true);
    try {
      const cols = Object.keys(rowModal.row).filter((k) => !rowModal.pkCols.includes(k));
      const vals = cols.map((c) => rowModal.row[c] ?? "");
      await DataUpdateRow(
        new main.DataRowMutationRequest({
          sessionId: activeSessionId,
          database: selectedDb,
          table: selectedTable,
          columns: cols,
          values: vals,
          pkColumns: rowModal.pkCols,
          pkValues: rowModal.pkVals,
        })
      );
      setRowModal(null);
      if (selectedTable) {
        const off = (previewPage - 1) * PREVIEW_PAGE_SIZE;
        const [sc, sd] = previewSortToApi(previewSortQuery);
        const r = (await DataTablePreview(
          activeSessionId,
          selectedDb,
          selectedTable,
          PREVIEW_PAGE_SIZE,
          off,
          sc,
          sd
        )) as main.DataQueryResultDTO;
        setPreview(r);
      }
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteRowModal = async () => {
    if (!rowModal || !activeSessionId || !selectedTable) return;
    if (!confirm("Delete this row?")) return;
    setBusy(true);
    try {
      await DataDeleteRow(
        new main.DataRowMutationRequest({
          sessionId: activeSessionId,
          database: selectedDb,
          table: selectedTable,
          columns: [],
          values: [],
          pkColumns: rowModal.pkCols,
          pkValues: rowModal.pkVals,
        })
      );
      setRowModal(null);
      if (selectedTable) {
        const off = (previewPage - 1) * PREVIEW_PAGE_SIZE;
        const [sc, sd] = previewSortToApi(previewSortQuery);
        const r = (await DataTablePreview(
          activeSessionId,
          selectedDb,
          selectedTable,
          PREVIEW_PAGE_SIZE,
          off,
          sc,
          sd
        )) as main.DataQueryResultDTO;
        setPreview(r);
      }
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNewSource = async () => {
    if (!editName.trim()) return;
    const scope =
      editScopeJson ||
      scopeForMode(ownerMode, activeProfileId, localContainer, remoteProfileId, remoteContainer);
    setBusy(true);
    try {
      await UpsertDataSource(
        new main.UpsertDataSourceRequest({
          ...(editSourceId ? { id: editSourceId } : {}),
          name: editName.trim(),
          engine: editEngine,
          host: editHost,
          port: editPort,
          username: editUser,
          database: editDatabase,
          scopeJson: scope,
          password: editPassword,
          passwordStorage: editStorage,
        })
      );
      setNewOpen(false);
      setEditSourceId(null);
      setEditPassword("");
      void loadSources();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const noSources = sources.length === 0;

  const newSourceContextLine = useMemo(() => {
    if (ownerMode === "ssh") {
      const p = profiles.find((x) => x.id === activeProfileId);
      if (!p) return "SSH — pick a connection in the left panel.";
      const label = p.name?.trim() ? p.name : `${p.username}@${p.host}`;
      return `SSH · ${label} — ${p.username}@${p.host}:${p.port}`;
    }
    if (ownerMode === "docker_local") {
      const c = localContainers.find((x) => x.id === localContainer);
      const nm = c?.name || localContainer || "—";
      return `Docker local · container: ${nm}`;
    }
    const p = profiles.find((x) => x.id === remoteProfileId);
    const c = remoteContainers.find((x) => x.id === remoteContainer);
    const hostPart = p
      ? `${p.name?.trim() ? p.name : `${p.username}@${p.host}`} (${p.username}@${p.host}:${p.port})`
      : "—";
    const cont = c?.name || remoteContainer || "—";
    return `Docker remote · ${hostPart} · container: ${cont}`;
  }, [
    ownerMode,
    profiles,
    activeProfileId,
    localContainers,
    localContainer,
    remoteProfileId,
    remoteContainers,
    remoteContainer,
  ]);

  const canTestDataSource = useMemo(() => {
    if (busy) return false;
    if (!editHost.trim()) return false;
    if (!editPort || editPort <= 0) return false;
    if (!editUser.trim()) return false;
    if (ownerMode === "docker_local" && !localContainer.trim()) return false;
    if (ownerMode === "docker_remote") {
      if (!remoteSessionId) return false;
      if (!remoteContainer.trim()) return false;
    }
    return true;
  }, [busy, editHost, editPort, editUser, ownerMode, localContainer, remoteSessionId, remoteContainer]);

  const dataSourceTestDisabledReason = useMemo(() => {
    if (busy) return "Busy";
    if (!editHost.trim()) return "Host is required";
    if (!editPort || editPort <= 0) return "Port is required";
    if (!editUser.trim()) return "User is required";
    if (ownerMode === "docker_local" && !localContainer.trim()) return "Pick a container in the left panel";
    if (ownerMode === "docker_remote" && !remoteSessionId) return "Connect to remote Docker in the left panel first";
    if (ownerMode === "docker_remote" && !remoteContainer.trim()) return "Pick a container in the left panel";
    return null;
  }, [busy, editHost, editPort, editUser, ownerMode, localContainer, remoteSessionId, remoteContainer]);

  useEffect(() => {
    if (!newOpen) return;
    setDataSourceTestState({ status: "idle" });
  }, [
    newOpen,
    editEngine,
    editHost,
    editPort,
    editUser,
    editDatabase,
    editPassword,
    editScopeJson,
    ownerMode,
    activeProfileId,
    localContainer,
    remoteProfileId,
    remoteContainer,
    remoteSessionId,
  ]);

  const testNewSourceConnection = async () => {
    setBusy(true);
    setDataSourceTestState({ status: "running" });
    try {
      const scope =
        editScopeJson ||
        scopeForMode(ownerMode, activeProfileId, localContainer, remoteProfileId, remoteContainer);
      await TestDataSourceConnection(
        new main.TestDataSourceConnectionRequest({
          engine: editEngine,
          host: editHost,
          port: editPort,
          username: editUser,
          database: editDatabase,
          password: editPassword,
          scopeJson: scope,
          remoteDockerSessionId: ownerMode === "docker_remote" ? remoteSessionId ?? "" : "",
        })
      );
      setDataSourceTestState({ status: "success", message: "Connection OK" });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setDataSourceTestState({ status: "error", message: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="data-workspace">
      <ContextMenu open={menuOpen} anchorEl={menuAnchor} items={menuItems} onClose={() => setMenuOpen(false)} />
      <SplitView
        left={
          <div className="panel data-panel data-panel--sources">
            <div className="panel-titlebar">
              <div className="panel-title">Data sources</div>
              <div className="panel-meta">Light SQL</div>
              <div className="panel-actions">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void loadSources()}>
                  Refresh
                </button>
              </div>
            </div>
            <div className="data-panel-body">
            <div className="data-owner-mode-row" role="tablist" aria-label="Data connection scope">
              <button
                type="button"
                className={`settings-segment ${ownerMode === "ssh" ? "active" : ""}`}
                onClick={() => setOwnerMode("ssh")}
              >
                <span className="data-owner-mode-icon" aria-hidden="true">
                  🔐
                </span>
                SSH
              </button>
              <button
                type="button"
                className={`settings-segment ${ownerMode === "docker_local" ? "active" : ""}`}
                onClick={() => setOwnerMode("docker_local")}
              >
                <span className="data-owner-mode-icon" aria-hidden="true">
                  🖥
                </span>
                Docker local
              </button>
              <button
                type="button"
                className={`settings-segment ${ownerMode === "docker_remote" ? "active" : ""}`}
                onClick={() => setOwnerMode("docker_remote")}
              >
                <span className="data-owner-mode-icon" aria-hidden="true">
                  🌐
                </span>
                Docker remote
              </button>
            </div>

            {ownerMode === "ssh" ? (
              <div className="data-conn-filters" role="group" aria-label="SSH connection">
                <label className="data-field">
                  <span>Group</span>
                  <select
                    className="docker-select"
                    value={sshGroupFilter}
                    onChange={(e) => setSshGroupFilter(e.target.value)}
                    aria-label="Group filter"
                  >
                    <option value="all">All groups</option>
                    {sortedGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="data-field">
                  <span>Connection</span>
                  <select
                    className="docker-select"
                    value={sshProfileId}
                    onChange={(e) => setSshProfileId(e.target.value)}
                    aria-label="SSH profile"
                  >
                    {filteredSSHProfiles.length === 0 ? (
                      <option value="">No connections in this group</option>
                    ) : (
                      filteredSSHProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name?.trim() ? p.name : `${p.username}@${p.host}`}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
            ) : null}

            {ownerMode === "docker_local" ? (
              <label className="data-field">
                <span>Container</span>
                <select value={localContainer} onChange={(e) => setLocalContainer(e.target.value)}>
                  <option value="">—</option>
                  {localContainers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id.slice(0, 12)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {ownerMode === "docker_remote" ? (
              <div className="data-remote-block">
                <div className="data-conn-filters" role="group" aria-label="Remote Docker host">
                  <label className="data-field">
                    <span>Group</span>
                    <select
                      className="docker-select"
                      value={remoteGroupFilter}
                      onChange={(e) => setRemoteGroupFilter(e.target.value)}
                      aria-label="Group filter"
                    >
                      <option value="all">All groups</option>
                      {sortedGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="data-field">
                    <span>Connection</span>
                    <select
                      className="docker-select"
                      value={remoteProfileId}
                      onChange={(e) => setRemoteProfileId(e.target.value)}
                      aria-label="SSH profile for Docker"
                    >
                      {filteredRemoteProfiles.length === 0 ? (
                        <option value="">No connections in this group</option>
                      ) : (
                        filteredRemoteProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name?.trim() ? p.name : `${p.username}@${p.host}`}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>
                {!remoteSessionId ? (
                  <button type="button" className="btn" disabled={!remoteProfileId || remoteBusy} onClick={() => void connectRemoteDocker()}>
                    {remoteBusy ? "…" : "Connect"}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-ghost" disabled={remoteBusy} onClick={() => void disconnectRemoteDocker()}>
                      Disconnect
                    </button>
                    <label className="data-field">
                      <span>Container</span>
                      <select value={remoteContainer} onChange={(e) => setRemoteContainer(e.target.value)}>
                        {remoteContainers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || c.id.slice(0, 12)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
            ) : null}

            {sourcesErr ? <div className="connections-error">{sourcesErr}</div> : null}

            <div className="connections-list data-card-list">
              {noSources ? (
                <div className="data-empty">No Data Sources created</div>
              ) : (
                sources.map((src) => {
                  const sessOpen = sessions.filter((s) => s.dataSourceId === src.id);
                  const isConnecting = connectingDataSourceId === src.id;
                  const topMarker = isConnecting ? "orange" : sessOpen.length > 0 ? "green" : "none";
                  const markerTitle = isConnecting
                    ? "Connecting…"
                    : sessOpen.length > 0
                      ? "Connected"
                      : "Not connected";
                  return (
                    <div key={src.id} className="profile data-source-card">
                      <div className="profile-row">
                        <div className="profile-main">
                          <div className="profile-name">{src.name}</div>
                          <div className="profile-sub mono">
                            {src.engine} · {src.username}@{src.host}:{src.port}
                          </div>
                        </div>
                        <div className="profile-actions">
                          <button type="button" className="btn" disabled={busy} onClick={() => void handleConnectSource(src)}>
                            Connect
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            title="Menu"
                            onClick={(e) =>
                              openMenu(e.currentTarget, [
                                { id: "edit", label: "Edit", onClick: () => openEditSource(src) },
                                {
                                  id: "delete",
                                  label: "Delete",
                                  danger: true,
                                  onClick: () => setDeleteSourcePending(src),
                                },
                              ])
                            }
                          >
                            ⋯
                          </button>
                        </div>
                        <span className={`marker marker-${topMarker} profile-marker`} title={markerTitle} />
                      </div>
                      <div className="sessions">
                        {sessOpen.map((s) => (
                          <div key={s.sessionId} className="session">
                            <button
                              type="button"
                              className={`session-btn ${activeSessionId === s.sessionId ? "active" : ""}`}
                              onClick={() => activateDataSession(s.sessionId)}
                              title={`${s.name} · ${dataEngineDisplay(s.engine)} · ${s.scopeSummary}`}
                            >
                              <span className="dot dot-green" />
                              <span>
                                {dataEngineIcon(s.engine)} {dataEngineDisplay(s.engine)}: {s.scopeSummary}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="session-close"
                              onClick={() => void disconnectSession(s.sessionId)}
                              title="Disconnect"
                            >
                              Disconnect
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="data-footer-actions">
              <button type="button" className="btn" onClick={() => openNewSourceModal()}>
                New Data Source
              </button>
            </div>
            </div>
          </div>
        }
        right={
          <div className="terminaltabs data-workspace-tabs">
            {sessions.length > 0 ? (
              <div className="terminaltabs-bar">
                {sessions.map((s) => {
                  const isActive = s.sessionId === activeSessionId;
                  const label = `${dataEngineIcon(s.engine)} ${dataEngineDisplay(s.engine)}: ${s.scopeSummary}`;
                  return (
                    <button
                      key={s.sessionId}
                      type="button"
                      className={`tab ${isActive ? "active" : ""}`}
                      title={`${s.name} · ${label}`}
                      onClick={() => activateDataSession(s.sessionId)}
                    >
                      <span className="dot dot-green" />
                      <span className="tab-label">{label}</span>
                      <span
                        className="tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          void disconnectSession(s.sessionId);
                        }}
                        title="Disconnect"
                      >
                        ×
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="panel data-panel data-panel--workspace">
            <div className="panel-titlebar data-workspace-titlebar">
              <div className="data-workspace-titlebar-left">
                <div className="panel-title">Workspace</div>
                <div className="panel-meta data-workspace-meta">
                  {activeSession
                    ? `${activeSession.name} · ${activeSession.scopeSummary}`
                    : "No active session"}
                </div>
              </div>
              {activeSession ? (
                <div className="data-workspace-titlebar-right">
                  <label className="data-header-namespace">
                    <span className="data-header-namespace-caption">
                      {activeSession.engine === "postgres" ? "Database / schema" : "Database"}
                    </span>
                    <select
                      className="docker-select data-header-namespace-select"
                      value={selectedDb}
                      onChange={(e) => {
                        setSelectedDb(e.target.value);
                        setPreviewPage(1);
                      }}
                      disabled={busy || databases.length === 0}
                      title={
                        activeSession.engine === "postgres"
                          ? "Schema for tables and SQL. Cluster databases are shown for reference only."
                          : "Active database"
                      }
                    >
                      {activeSession.engine === "postgres" ? (
                        <>
                          <optgroup label="Schemas">
                            {databases.map((d) => (
                              <option key={`sch:${d}`} value={d}>
                                {d}
                              </option>
                            ))}
                          </optgroup>
                          {postgresClusterDBs.length > 0 ? (
                            <optgroup label="Cluster databases">
                              {postgresClusterDBs.map((d) => (
                                <option key={`db:${d}`} value={d} disabled>
                                  {d}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </>
                      ) : (
                        databases.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
            <div className="data-panel-body data-workspace-main">
            {!activeSession ? (
              <div className="data-placeholder">Connect a data source to browse tables and run SQL.</div>
            ) : (
              <>
                <div className="data-inner-tabs-row">
                  <div className="data-inner-tabs">
                    <button type="button" className={innerTab === "table" ? "active" : ""} onClick={() => setInnerTab("table")}>
                      <span className="data-inner-tab-icon" aria-hidden>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="3" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="14" y="3" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="3" y="14" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="14" y="14" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </span>
                      <span>Table view</span>
                    </button>
                    <button type="button" className={innerTab === "sql" ? "active" : ""} onClick={() => setInnerTab("sql")}>
                      <span className="data-inner-tab-icon" aria-hidden>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M8 8.5L4 12l4 3.5M16 8.5L20 12l-4 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path d="M13.5 6l-3 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                      <span>SQL</span>
                    </button>
                  </div>
                  {innerTab === "sql" ? (
                    <div className="data-sql-toolbar-toggles">
                      <button
                        type="button"
                        className={`data-sql-editor-toggle ${sqlEditorExpanded ? "is-on" : "is-off"}${!canHideSqlEditor ? " is-locked" : ""}`}
                        disabled={!canHideSqlEditor && sqlEditorExpanded}
                        aria-label="Toggle SQL script panel"
                        aria-pressed={sqlEditorExpanded}
                        title={
                          !canHideSqlEditor
                            ? "Enter SQL and run a query to get a result table before hiding the editor"
                            : sqlEditorExpanded
                              ? "Hide SQL editor"
                              : "Show SQL editor"
                        }
                        onClick={() => {
                          if (!canHideSqlEditor) return;
                          setSqlEditorExpanded((v) => !v);
                        }}
                      >
                        <span className="data-sql-editor-toggle-icon" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect
                              x="3"
                              y="5"
                              width="9"
                              height="14"
                              rx="1.5"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              fill={sqlEditorExpanded ? "currentColor" : "none"}
                              fillOpacity={sqlEditorExpanded ? 0.3 : 0}
                            />
                            <path d="M15 8h6M15 12h6M15 16h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                          </svg>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`data-sql-editor-toggle data-sql-schema-toggle ${sqlSchemaBrowserOpen ? "is-on" : "is-off"}`}
                        aria-label="Toggle table and columns reference"
                        aria-pressed={sqlSchemaBrowserOpen}
                        title={sqlSchemaBrowserOpen ? "Hide table reference" : "Show table and column list"}
                        onClick={() => setSqlSchemaBrowserOpen((v) => !v)}
                      >
                        <span className="data-sql-editor-toggle-icon" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect
                              x="3"
                              y="4"
                              width="10"
                              height="10"
                              rx="1.25"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              fill={sqlSchemaBrowserOpen ? "currentColor" : "none"}
                              fillOpacity={sqlSchemaBrowserOpen ? 0.2 : 0}
                            />
                            <path d="M3 8h10M7 4v10" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M16 10h5M16 14h4M16 18h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                          </svg>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
                {innerTab === "table" ? (
                  <div className="data-table-workspace">
                    <div className="data-db-col">
                      <div className="data-col-title">Tables</div>
                      <input
                        type="search"
                        className="data-table-list-filter"
                        value={tableListFilter}
                        onChange={(e) => setTableListFilter(e.target.value)}
                        placeholder="Filter tables…"
                        aria-label="Filter tables"
                        spellCheck={false}
                      />
                      <ul className="data-list">
                        {visibleTableNames.map((t) => (
                          <li key={t}>
                            <button
                              type="button"
                              className={`data-table-list-btn ${selectedTable === t ? "active" : ""}`}
                              onClick={() => {
                                setSelectedTable(t);
                                setPreviewPage(1);
                              }}
                            >
                              <span className="data-table-list-name">{t}</span>
                              {previewLoading && selectedTable === t ? (
                                <span className="data-table-list-spinner" aria-label="Loading" role="status">
                                  <svg className="data-spinner-svg" width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <circle
                                      cx="12"
                                      cy="12"
                                      r="9"
                                      stroke="currentColor"
                                      strokeWidth="2.25"
                                      strokeLinecap="round"
                                      strokeDasharray="40 22"
                                      opacity="0.9"
                                    />
                                  </svg>
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="data-grid-wrap">
                      <div className="data-grid-scroll" ref={tablePreviewScrollRef}>
                        {!selectedTable ? (
                          <div className="data-placeholder">Select a table</div>
                        ) : previewLoading ? (
                          <div className="data-placeholder data-placeholder-muted">Loading table…</div>
                        ) : previewError ? (
                          <div className="data-placeholder data-placeholder-error">{previewError}</div>
                        ) : preview && Array.isArray(preview.columns) && Array.isArray(preview.rows) ? (
                          <table className="data-grid data-grid--preview">
                            <thead>
                              <tr>
                                {preview.columns.map((c) => (
                                  <th key={c}>
                                    <button
                                      type="button"
                                      className="data-grid-th-sort"
                                      onClick={() => handlePreviewSortClick(c)}
                                      title="Sort: ascending → descending → off"
                                    >
                                      <span className="data-grid-th-sort-label">{c}</span>
                                      {previewSort.column === c && previewSort.dir === "asc" ? (
                                        <span className="data-grid-th-sort-ind" aria-hidden>
                                          ▲
                                        </span>
                                      ) : previewSort.column === c && previewSort.dir === "desc" ? (
                                        <span className="data-grid-th-sort-ind" aria-hidden>
                                          ▼
                                        </span>
                                      ) : null}
                                    </button>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {preview.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={Math.max(1, preview.columns.length)} className="data-grid-empty-cell">
                                    This table has no rows.
                                  </td>
                                </tr>
                              ) : (
                                preview.rows.map((row, ri) => (
                                  <tr key={ri} onClick={() => void openRow(row)} className="data-row-click">
                                    {(row ?? []).map((cell, ci) => (
                                      <td key={ci} title={cell}>
                                        <span className="data-cell-clip">{cell}</span>
                                      </td>
                                    ))}
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        ) : (
                          <div className="data-placeholder data-placeholder-muted">
                            Could not load data for this table.
                          </div>
                        )}
                      </div>
                      {preview && !previewLoading && selectedTable && Array.isArray(preview.columns) ? (
                        <div className="data-preview-pagination">
                          <span className="data-preview-pagination-meta mono">
                            {previewTotalRows.toLocaleString()} rows · page {previewPage} / {previewTotalPages}
                          </span>
                          <div className="data-preview-pagination-controls">
                            <button
                              type="button"
                              className="btn"
                              disabled={previewPage <= 1 || busy}
                              onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                            >
                              Prev
                            </button>
                            <label className="data-preview-page-jump">
                              <span className="data-preview-page-jump-label">Page</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                className="data-preview-page-input mono"
                                value={pageJumpInput}
                                onChange={(e) => setPageJumpInput(e.target.value)}
                                onBlur={() => void commitPageJump()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void commitPageJump();
                                  }
                                }}
                                aria-label="Page number"
                              />
                            </label>
                            <button
                              type="button"
                              className="btn"
                              disabled={previewPage >= previewTotalPages || busy}
                              onClick={() => setPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`data-sql-pane-outer${sqlSchemaBrowserOpen ? " data-sql-pane-outer--with-rail" : ""}`}
                  >
                    {sqlSchemaBrowserOpen ? (
                      <aside className="data-sql-schema-rail" aria-label="Table reference">
                        <div className="data-sql-rail-block">
                          <div className="data-sql-rail-label">Table</div>
                          <select
                            className="docker-select data-sql-rail-select"
                            value={selectedTable}
                            onChange={(e) => setSelectedTable(e.target.value)}
                            disabled={!selectedDb || tables.length === 0}
                          >
                            <option value="">—</option>
                            {tables.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="data-sql-rail-block data-sql-rail-block--grow">
                          <div className="data-sql-rail-label">Columns</div>
                          <ul className="data-sql-rail-columns">
                            {!selectedTable ? (
                              <li className="data-sql-rail-hint">Select a table</li>
                            ) : sqlRailColumns.length === 0 ? (
                              <li className="data-sql-rail-hint">No columns</li>
                            ) : (
                              sqlRailColumns.map((c) => (
                                <li key={c.name}>
                                  <span className="mono data-sql-rail-col-name">{c.name}</span>
                                  <span className="data-sql-rail-col-type">{c.dataType}</span>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      </aside>
                    ) : null}
                    <div className={`data-sql-pane${sqlEditorExpanded ? "" : " data-sql-pane--editor-collapsed"}`}>
                      {sqlEditorExpanded ? (
                        <div className="data-sql-script-block">
                          <textarea className="data-sql-input mono" value={sqlText} onChange={(e) => setSqlText(e.target.value)} rows={8} />
                          <button type="button" className="btn" disabled={busy} onClick={() => void runSql()}>
                            Run
                          </button>
                        </div>
                      ) : null}
                      <div className="data-sql-results">
                        {sqlResult && Array.isArray(sqlResult.columns) && Array.isArray(sqlResult.rows) ? (
                          <table className="data-grid">
                            <thead>
                              <tr>
                                {sqlResult.columns.map((c) => (
                                  <th key={c}>{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sqlResult.rows.map((row, ri) => (
                                <tr key={ri}>
                                  {(row ?? []).map((cell, ci) => (
                                    <td key={ci} title={cell}>
                                      <span className="data-cell-clip">{cell}</span>
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="data-placeholder data-sql-results-placeholder">Run a query to see results here.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          </div>
          </div>
        }
        initialLeftPct={38}
        minLeftPx={320}
        minRightPx={400}
      />

      {newOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal data-modal">
            <div className="modal-title">{editSourceId ? "Edit Data Source" : "New Data Source"}</div>
            <div className="modal-body form data-new-source-body">
              <div className="data-new-source-scope" role="status">
                <div className="data-new-source-scope-label">
                  {editSourceId ? "Connection scope" : "Creating in"}
                </div>
                <div className="data-new-source-scope-value mono">
                  {editSourceId ? editScopeJson : newSourceContextLine}
                </div>
              </div>

              <div className="row two">
                <div className="row">
                  <label>Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                </div>
                <div className="row">
                  <label>Engine</label>
                  <select
                    className="docker-select"
                    value={editEngine}
                    onChange={(e) => {
                      const eng = e.target.value as "postgres" | "mysql";
                      setEditEngine(eng);
                      setEditPort(eng === "postgres" ? 5432 : 3306);
                    }}
                  >
                    <option value="postgres">PostgreSQL</option>
                    <option value="mysql">MySQL / MariaDB</option>
                  </select>
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
                  <select
                    className="docker-select"
                    value={editStorage}
                    onChange={(e) => setEditStorage(e.target.value as "keyring" | "internal")}
                  >
                    <option value="keyring">OS keyring</option>
                    <option value="internal">Internal vault</option>
                  </select>
                </div>
              </div>
              <p className="data-hint">
                Database host/port are inside the target network (e.g. container or remote host). Docker uses a sidecar on the container network, not published ports on your machine.
              </p>
              {editSourceId ? (
                <p className="data-hint">Leave password empty to keep the saved password.</p>
              ) : null}
            </div>
            <div className="data-modal-footer">
              <div className="data-modal-footer-left">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!canTestDataSource}
                  title={dataSourceTestDisabledReason ?? "Test database connection"}
                  onClick={() => void testNewSourceConnection()}
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
                        aria-label={`test-${dataSourceTestState.status}`}
                      >
                        {dataSourceTestState.status === "running" ? (
                          "…"
                        ) : dataSourceTestState.status === "success" ? (
                          "✓"
                        ) : (
                          "✕"
                        )}
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
                    setNewOpen(false);
                    setEditSourceId(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void saveNewSource()}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteSourcePending ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Delete data source?</div>
            <div className="modal-body">
              <div>
                Delete <strong>{deleteSourcePending.name}</strong> ({deleteSourcePending.engine} ·{" "}
                {deleteSourcePending.username}@{deleteSourcePending.host}:{deleteSourcePending.port})?
              </div>
              <div className="muted">Open sessions for this source will be disconnected. This cannot be undone.</div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setDeleteSourcePending(null)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirmDeleteDataSource()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rowModal?.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Row</div>
            <div className="modal-body form">
              {Object.keys(rowModal.row).map((k) => (
                <div className="row" key={k}>
                  <label>{k}</label>
                  <input
                    value={rowModal.row[k]}
                    onChange={(e) =>
                      setRowModal((m) =>
                        m ? { ...m, row: { ...m.row, [k]: e.target.value } } : m
                      )
                    }
                    disabled={rowModal.pkCols.includes(k)}
                  />
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRowModal(null)}>
                Close
              </button>
              <button type="button" className="btn danger" onClick={() => void deleteRowModal()}>
                Delete
              </button>
              <button type="button" className="btn" onClick={() => void saveRowModal()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
