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
  DataExecMutationSQL,
  DataExplainSQL,
  DataPreviewMutationSQL,
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
import {
  DataGridPaginationFooter,
  DataSortableTable,
  sortDataRowsByColumn,
} from "./DataResultGrid";
import { DropdownSelect, type DropdownOption } from "./ui";
import "./dataworkspace.css";
import "./connections.css";
import "./terminaltabs.css";

type OwnerMode = "ssh" | "docker_local" | "docker_remote";

const PREVIEW_PAGE_SIZE = 100;
/** Matches backend mutationPreviewSampleLimit for UI copy. */
const MUTATION_PREVIEW_SAMPLE_LIMIT = 200;

type SqlRunKind = "select" | "delete" | "update" | "insert" | "ddl" | "other";

/** Mirrors backend ClassifyUserSQL for Run routing (preview vs direct execute). */
function classifySqlKind(sql: string): SqlRunKind {
  let s = sql.trim().replace(/;+\s*$/, "");
  s = s.trim();
  while (s.startsWith("--")) {
    const nl = s.indexOf("\n");
    if (nl < 0) return "other";
    s = s.slice(nl + 1).trim();
  }
  while (s.startsWith("/*")) {
    const end = s.indexOf("*/");
    if (end < 0) break;
    s = s.slice(end + 2).trim();
  }
  const low = s.toLowerCase();
  if (low.startsWith("select")) return "select";
  if (low.startsWith("with")) {
    if (/\)\s*(delete|update|insert)\b/is.test(s)) {
      if (/\bdelete\b/i.test(s)) return "delete";
      if (/\bupdate\b/i.test(s)) return "update";
      return "insert";
    }
    return "select";
  }
  if (low.startsWith("delete")) return "delete";
  if (low.startsWith("update")) return "update";
  if (low.startsWith("insert")) return "insert";
  if (/^(drop|truncate|alter|create|grant|revoke)\b/i.test(low)) return "ddl";
  return "other";
}

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
  /** Matches backend `DataSessionDTO.mode` (e.g. `ssh`, `docker_local`). */
  scopeMode: string;
  /** Transport label for tabs (SSH profile, container, …) — like Connections “connection”. */
  scopeSummary: string;
  /** `false` when the server dropped the session (dead DB/SSH); tab stays until user closes it. */
  connectionAlive?: boolean;
};

type DataTabSnapshot = {
  selectedDb: string;
  selectedTable: string;
  sqlText: string;
  innerTab: "table" | "sql" | "explain";
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
  /** Table view filter bar. */
  tableFilterBarOpen?: boolean;
  /** Last applied filter JSON (`[]` or non-empty array JSON). */
  previewFilterJSON?: string;
  tableFilterClauses?: TableFilterClause[];
  /** SQL tab: result pagination / sort (client-side on loaded rows). */
  sqlPage?: number;
  sqlSortColumn?: string;
  sqlSortDir?: string;
};

type PreviewSort = { column: string | null; dir: "asc" | "desc" | null };

function previewSortToApi(s: PreviewSort): [string, string] {
  if (!s.column || !s.dir) return ["", ""];
  return [s.column, s.dir];
}

function previewSortEqual(a: PreviewSort, b: PreviewSort): boolean {
  return a.column === b.column && a.dir === b.dir;
}

type TableFilterOp = "eq" | "ne" | "is" | "is_not" | "like" | "gt" | "lt" | "in";

type TableFilterClause = {
  join: "" | "AND" | "OR";
  column: string;
  op: TableFilterOp;
  value: string;
};

const TABLE_FILTER_OPS: { op: TableFilterOp; label: string }[] = [
  { op: "eq", label: "Equals" },
  { op: "ne", label: "Not equals" },
  { op: "is", label: "Is" },
  { op: "is_not", label: "Is not" },
  { op: "like", label: "Like" },
  { op: "gt", label: "Greater" },
  { op: "lt", label: "Less" },
  { op: "in", label: "In" },
];

function opNeedsValue(op: TableFilterOp): boolean {
  return op !== "is" && op !== "is_not";
}

function clauseValueOk(c: TableFilterClause): boolean {
  if (!opNeedsValue(c.op)) return true;
  if (c.op === "in") {
    return c.value.split(",").some((p) => p.trim() !== "");
  }
  return c.value.trim() !== "";
}

/** Valid JSON for `DataTablePreview` filter arg, or `""` when no filter. Trailing empty rows are ignored. */
function serializeTableFilterPayload(clauses: TableFilterClause[]): string | null {
  const trimmed = [...clauses];
  while (trimmed.length && !trimmed[trimmed.length - 1].column.trim()) {
    trimmed.pop();
  }
  if (!trimmed.length) return "";
  const out: { join: string; column: string; op: string; value: string }[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (!c.column.trim()) return null;
    if (!clauseValueOk(c)) return null;
    const join = i === 0 ? "" : c.join === "OR" ? "OR" : "AND";
    out.push({
      join,
      column: c.column.trim(),
      op: c.op,
      value: c.value,
    });
  }
  return JSON.stringify(out);
}

/** Backend dropped the session or transport died — mark tab inactive; user closes manually. */
function isStaleDataSessionError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  const s = m.toLowerCase();
  return s.includes("data connection lost") || s.includes("data session not found");
}

function parseTableFilterClauses(json: string): TableFilterClause[] {
  const s = json.trim();
  if (!s) return [];
  try {
    const raw = JSON.parse(s) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((row: any, i: number) => ({
      join: i === 0 ? "" : row?.join === "OR" ? "OR" : "AND",
      column: String(row?.column ?? ""),
      op: (TABLE_FILTER_OPS.some((o) => o.op === row?.op) ? row.op : "eq") as TableFilterOp,
      value: String(row?.value ?? ""),
    }));
  } catch {
    return [];
  }
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
  const [innerTab, setInnerTab] = useState<"table" | "sql" | "explain">("table");

  const [databases, setDatabases] = useState<string[]>([]);
  /** PostgreSQL: cluster database names (read-only in header). Selectable namespaces live in `databases`. */
  const [postgresClusterDBs, setPostgresClusterDBs] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableListFilter, setTableListFilter] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [previewSort, setPreviewSort] = useState<PreviewSort>({ column: null, dir: null });
  const [previewSortQuery, setPreviewSortQuery] = useState<PreviewSort>({ column: null, dir: null });
  const [preview, setPreview] = useState<main.DataQueryResultDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sqlText, setSqlText] = useState("SELECT 1");
  const [sqlResult, setSqlResult] = useState<main.DataQueryResultDTO | null>(null);
  const [sqlPage, setSqlPage] = useState(1);
  const [sqlSort, setSqlSort] = useState<PreviewSort>({ column: null, dir: null });
  const [pendingMutation, setPendingMutation] = useState<
    | null
    | { mode: "preview"; preview: main.DataQueryResultDTO; sql: string }
    | { mode: "raw"; sql: string; title: string }
  >(null);
  const [explainResult, setExplainResult] = useState<main.DataQueryResultDTO | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  /** SQL workspace: show script + Run above results (default on). */
  const [sqlEditorExpanded, setSqlEditorExpanded] = useState(true);
  /** SQL tab: sidebar with table picker + column types. */
  const [sqlSchemaBrowserOpen, setSqlSchemaBrowserOpen] = useState(false);
  const [sqlRailColumns, setSqlRailColumns] = useState<main.DataColumnMetaDTO[]>([]);
  /** Table view: filter row (SSH / direct SQL only). */
  const [tableFilterBarOpen, setTableFilterBarOpen] = useState(false);
  const [tableFilterClauses, setTableFilterClauses] = useState<TableFilterClause[]>([]);
  const [previewFilterCommitted, setPreviewFilterCommitted] = useState("");
  const [filterPickerColumns, setFilterPickerColumns] = useState<main.DataColumnMetaDTO[]>([]);
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
  const prevFilterCtxRef = useRef<{ sid: string | null; db: string; tbl: string }>({
    sid: null,
    db: "",
    tbl: "",
  });
  const tablePreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const sqlResultsScrollRef = useRef<HTMLDivElement | null>(null);
  /** Last known SQL result row count from server (page fetches may omit totalRows = -1). */
  const lastSqlTotalRef = useRef<number | null>(null);
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

  const sshGroupSelectOptions: DropdownOption[] = useMemo(
    () => [
      { value: "all", label: "All groups" },
      ...sortedGroups.map((g) => ({ value: g.id, label: g.name })),
    ],
    [sortedGroups]
  );

  const sshProfileSelectOptions: DropdownOption[] = useMemo(
    () =>
      filteredSSHProfiles.map((p) => ({
        value: p.id,
        label: p.name?.trim() ? p.name : `${p.username}@${p.host}`,
      })),
    [filteredSSHProfiles]
  );

  const remoteProfileSelectOptions: DropdownOption[] = useMemo(
    () =>
      filteredRemoteProfiles.map((p) => ({
        value: p.id,
        label: p.name?.trim() ? p.name : `${p.username}@${p.host}`,
      })),
    [filteredRemoteProfiles]
  );

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
        const [ssc, ssd] = previewSortToApi(sqlSort);
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
          sqlPage,
          sqlSortColumn: ssc,
          sqlSortDir: ssd,
          tableFilterBarOpen,
          previewFilterJSON: previewFilterCommitted,
          tableFilterClauses,
        };
      }
      setRowModal(null);
      if (!sessionId) {
        setSelectedDb("");
        setSelectedTable("");
        setPreview(null);
        setSqlResult(null);
        setSqlText("SELECT 1");
        setPendingMutation(null);
        setExplainResult(null);
        setExplainError(null);
        setExplainLoading(false);
        setInnerTab("table");
        setSqlEditorExpanded(true);
        setSqlSchemaBrowserOpen(false);
        setPreviewPage(1);
        setPreviewSort({ column: null, dir: null });
        setPreviewSortQuery({ column: null, dir: null });
        setTableFilterBarOpen(false);
        setTableFilterClauses([]);
        setPreviewFilterCommitted("");
        setPreviewLoading(false);
        setPreviewError(null);
        setSqlPage(1);
        setSqlSort({ column: null, dir: null });
        setActiveSessionId(null);
        return;
      }
      const snap = dataTabSnapshotsRef.current[sessionId];
      setSelectedDb(snap?.selectedDb ?? "");
      setSelectedTable(snap?.selectedTable ?? "");
      setSqlText(snap?.sqlText ?? "SELECT 1");
      {
        const it = snap?.innerTab;
        setInnerTab(it === "table" || it === "sql" || it === "explain" ? it : "table");
      }
      setPendingMutation(null);
      setExplainResult(null);
      setExplainError(null);
      setExplainLoading(false);
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
      setSqlPage(snap?.sqlPage ?? 1);
      const sqlRs = snap?.sqlSortDir;
      const sqlRc = (snap?.sqlSortColumn ?? "").trim();
      const sqlRdir = sqlRs === "asc" || sqlRs === "desc" ? sqlRs : null;
      const sqlRsort: PreviewSort =
        sqlRc && sqlRdir ? { column: sqlRc, dir: sqlRdir } : { column: null, dir: null };
      setSqlSort(sqlRsort);
      const pjson = snap?.previewFilterJSON ?? "";
      setPreviewFilterCommitted(pjson);
      if (snap?.tableFilterClauses && snap.tableFilterClauses.length > 0) {
        setTableFilterClauses(snap.tableFilterClauses);
      } else {
        setTableFilterClauses(parseTableFilterClauses(pjson));
      }
      setTableFilterBarOpen(snap?.tableFilterBarOpen ?? false);
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
      sqlPage,
      sqlSort,
      tableFilterBarOpen,
      previewFilterCommitted,
      tableFilterClauses,
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
      if (!res.sessionId) {
        alert("no session");
        return;
      }
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
            scopeMode: (res.mode ?? "").trim(),
            scopeSummary,
            connectionAlive: true,
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

  const markSessionDisconnected = useCallback((sid: string) => {
    setSessions((p) =>
      p.map((s) => (s.sessionId === sid ? { ...s, connectionAlive: false } : s))
    );
  }, []);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId) ?? null;

  const activeSessionAlive = useMemo(() => {
    if (!activeSessionId) return true;
    const s = sessions.find((x) => x.sessionId === activeSessionId);
    return s?.connectionAlive !== false;
  }, [sessions, activeSessionId]);

  const activeEngine = useMemo(() => (activeSession?.engine ?? "").toLowerCase(), [activeSession?.engine]);

  const tableFilterSqlSupported = useMemo(
    () => (activeSession?.scopeMode ?? "") === "ssh",
    [activeSession?.scopeMode]
  );

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

  const headerNamespaceOptions: DropdownOption[] = useMemo(() => {
    if (!activeSession) return [];
    if (activeSession.engine === "postgres") {
      return [
        ...databases.map((d) => ({ value: d, label: d })),
        ...postgresClusterDBs.map((d) => ({
          value: d,
          label: `${d} (cluster DB)`,
          disabled: true,
        })),
      ];
    }
    return databases.map((d) => ({ value: d, label: d }));
  }, [activeSession, databases, postgresClusterDBs]);

  const tableRailOptions: DropdownOption[] = useMemo(
    () => [{ value: "", label: "—" }, ...tables.map((t) => ({ value: t, label: t }))],
    [tables]
  );

  const localContainerOptions: DropdownOption[] = useMemo(
    () => [
      { value: "", label: "—" },
      ...localContainers.map((c) => ({
        value: c.id,
        label: c.name || c.id.slice(0, 12),
      })),
    ],
    [localContainers]
  );

  const remoteContainerOptions: DropdownOption[] = useMemo(
    () =>
      remoteContainers.map((c) => ({
        value: c.id,
        label: c.name || c.id.slice(0, 12),
      })),
    [remoteContainers]
  );

  const previewTotalRows = Number(preview?.totalRows ?? 0);
  const previewTotalPages = Math.max(1, Math.ceil(previewTotalRows / PREVIEW_PAGE_SIZE) || 1);

  const sqlSortedRows = useMemo(() => {
    if (!hasSqlResultTable || !sqlResult?.rows || !sqlResult.columns) return [];
    return sortDataRowsByColumn(sqlResult.rows, sqlResult.columns, sqlSort);
  }, [hasSqlResultTable, sqlResult, sqlSort]);

  const sqlLoadedCount = sqlSortedRows.length;

  useEffect(() => {
    if (!sqlResult) {
      lastSqlTotalRef.current = null;
      return;
    }
    const t =
      typeof sqlResult.totalRows === "number"
        ? sqlResult.totalRows
        : Number(sqlResult.totalRows ?? NaN);
    if (Number.isFinite(t) && t >= 0) {
      lastSqlTotalRef.current = t;
    }
  }, [sqlResult]);

  const sqlDisplayTotal = useMemo(() => {
    if (!sqlResult) return 0;
    const t =
      typeof sqlResult.totalRows === "number"
        ? sqlResult.totalRows
        : Number(sqlResult.totalRows ?? NaN);
    if (Number.isFinite(t) && t >= 0) return t;
    return lastSqlTotalRef.current ?? sqlLoadedCount;
  }, [sqlResult, sqlLoadedCount]);

  const sqlServerPaging = useMemo(() => {
    if (!hasSqlResultTable || !sqlResult?.rows) return false;
    return sqlDisplayTotal > sqlResult.rows.length;
  }, [hasSqlResultTable, sqlResult, sqlDisplayTotal]);

  const sqlPageBasis = sqlServerPaging ? sqlDisplayTotal : sqlLoadedCount;
  const sqlTotalPages = Math.max(1, Math.ceil(sqlPageBasis / PREVIEW_PAGE_SIZE) || 1);

  const sqlPageRows = useMemo(() => {
    if (sqlServerPaging) {
      return sqlSortedRows;
    }
    const off = (sqlPage - 1) * PREVIEW_PAGE_SIZE;
    return sqlSortedRows.slice(off, off + PREVIEW_PAGE_SIZE);
  }, [sqlSortedRows, sqlServerPaging, sqlPage]);

  const tableFilterPayload = useMemo(
    () => serializeTableFilterPayload(tableFilterClauses),
    [tableFilterClauses]
  );
  const committedFilterTrim = previewFilterCommitted.trim();
  const tableFilterDirty = useMemo(() => {
    if (tableFilterPayload === null) return true;
    return tableFilterPayload !== committedFilterTrim;
  }, [tableFilterPayload, committedFilterTrim]);
  const tableFilterShowCancel = committedFilterTrim !== "" && !tableFilterDirty;
  const tableFilterApplyDisabled =
    tableFilterShowCancel ||
    tableFilterPayload === null ||
    (!tableFilterDirty && committedFilterTrim === "");

  /** Toolbar toggle looks “on” when the bar is open or a filter is already applied (even if the bar is collapsed). */
  const tableFilterToggleActive =
    tableFilterBarOpen || committedFilterTrim !== "";

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
    if (sqlPage > sqlTotalPages) setSqlPage(sqlTotalPages);
  }, [sqlPage, sqlTotalPages]);

  useEffect(() => {
    const el = sqlResultsScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [sqlResult, sqlPage, sqlSort]);

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
    if (!activeSessionAlive) {
      setDatabases([]);
      setPostgresClusterDBs([]);
      setTables([]);
      setSelectedDb("");
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
      } catch (e: unknown) {
        if (cancelled) return;
        if (isStaleDataSessionError(e)) {
          markSessionDisconnected(sid);
          return;
        }
        setDatabases([]);
        setPostgresClusterDBs([]);
        setSelectedDb("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeEngine, activeSessionAlive, markSessionDisconnected]);

  useEffect(() => {
    if (!activeSessionId || !selectedTable || !sqlSchemaBrowserOpen || (innerTab !== "sql" && innerTab !== "explain")) {
      setSqlRailColumns([]);
      return;
    }
    if (!activeSessionAlive) {
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
      } catch (e: unknown) {
        if (cancelled) return;
        if (isStaleDataSessionError(e)) {
          markSessionDisconnected(sid);
          return;
        }
        setSqlRailColumns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb, selectedTable, sqlSchemaBrowserOpen, innerTab, activeSessionAlive, markSessionDisconnected]);

  useEffect(() => {
    if (!activeSessionId || !selectedDb) {
      setTables([]);
      return;
    }
    if (!activeSessionAlive) {
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
      } catch (e: unknown) {
        if (cancelled) return;
        if (isStaleDataSessionError(e)) {
          markSessionDisconnected(sid);
          return;
        }
        setTables([]);
        setSelectedTable("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb, activeSessionAlive, markSessionDisconnected]);

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
    const fj = previewFilterCommitted.trim();
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    void (async () => {
      try {
        const r = (await DataTablePreview(
          sid,
          db,
          tbl,
          PREVIEW_PAGE_SIZE,
          offset,
          sc,
          sd,
          fj
        )) as main.DataQueryResultDTO;
        if (cancelled) return;
        if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) {
          setPreview(r);
        } else {
          setPreview(null);
          setPreviewError("Unexpected preview response.");
        }
      } catch (e: unknown) {
        if (cancelled) return;
        if (isStaleDataSessionError(e)) {
          markSessionDisconnected(sid);
          return;
        }
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb, selectedTable, previewPage, previewSortQuery, previewFilterCommitted, activeSessionAlive, markSessionDisconnected]);

  useEffect(() => {
    const sid = activeSessionId;
    const db = selectedDb;
    const tbl = selectedTable;
    const prev = prevFilterCtxRef.current;
    const sameSession = prev.sid !== null && sid === prev.sid;
    if (sameSession && (db !== prev.db || tbl !== prev.tbl)) {
      setTableFilterBarOpen(false);
      setPreviewFilterCommitted("");
      setTableFilterClauses([]);
    }
    prevFilterCtxRef.current = { sid, db, tbl };
  }, [activeSessionId, selectedDb, selectedTable]);

  useEffect(() => {
    if (!activeSessionId || !selectedTable || !tableFilterBarOpen) {
      setFilterPickerColumns([]);
      return;
    }
    if (!activeSessionAlive) {
      setFilterPickerColumns([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await DataListTableColumns(activeSessionId, selectedDb, selectedTable);
        if (!cancelled) setFilterPickerColumns(Array.isArray(raw) ? raw : []);
      } catch (e: unknown) {
        if (cancelled) return;
        if (isStaleDataSessionError(e)) {
          markSessionDisconnected(activeSessionId);
          return;
        }
        setFilterPickerColumns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, selectedDb, selectedTable, tableFilterBarOpen, activeSessionAlive, markSessionDisconnected]);

  const handlePreviewSortClick = useCallback((col: string) => {
    setPreviewSort((prev) => {
      if (prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return { column: null, dir: null };
    });
  }, []);

  const handleSqlSortClick = useCallback(
    (col: string) => {
      if (!sqlServerPaging) {
        setSqlPage(1);
      }
      setSqlSort((prev) => {
        if (prev.column !== col) return { column: col, dir: "asc" };
        if (prev.dir === "asc") return { column: col, dir: "desc" };
        return { column: null, dir: null };
      });
    },
    [sqlServerPaging]
  );

  const handleSqlPageChange = useCallback(
    async (p: number) => {
      if (!sqlServerPaging) {
        setSqlPage(p);
        return;
      }
      if (!activeSessionId || !activeSessionAlive) return;
      setBusy(true);
      try {
        const off = (p - 1) * PREVIEW_PAGE_SIZE;
        const r = (await DataExecSQL(activeSessionId, selectedDb, sqlText, off)) as main.DataQueryResultDTO;
        if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) {
          setSqlResult(r);
          setSqlPage(p);
        }
      } catch (e: unknown) {
        if (isStaleDataSessionError(e) && activeSessionId) {
          markSessionDisconnected(activeSessionId);
          return;
        }
        alert(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [sqlServerPaging, activeSessionId, activeSessionAlive, sqlText, selectedDb, markSessionDisconnected]
  );

  const runSql = async () => {
    if (!activeSessionId || !activeSessionAlive) return;
    setPendingMutation(null);
    const kind = classifySqlKind(sqlText);
    if (kind === "select") {
      setBusy(true);
      try {
        const r = (await DataExecSQL(activeSessionId, selectedDb, sqlText, 0)) as main.DataQueryResultDTO;
        if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) {
          setSqlResult(r);
          setSqlPage(1);
          setSqlSort({ column: null, dir: null });
        } else setSqlResult(null);
      } catch (e: unknown) {
        if (isStaleDataSessionError(e) && activeSessionId) {
          markSessionDisconnected(activeSessionId);
          return;
        }
        alert(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (kind === "delete" || kind === "update") {
      setBusy(true);
      try {
        const prev = (await DataPreviewMutationSQL(activeSessionId, selectedDb, sqlText)) as main.DataQueryResultDTO;
        setPendingMutation({ mode: "preview", preview: prev, sql: sqlText.trim() });
      } catch (e: unknown) {
        if (isStaleDataSessionError(e) && activeSessionId) {
          markSessionDisconnected(activeSessionId);
          return;
        }
        setPendingMutation({
          mode: "raw",
          sql: sqlText.trim(),
          title: "Could not build a row preview. Run this statement as written?",
        });
      } finally {
        setBusy(false);
      }
      return;
    }
    setPendingMutation({
      mode: "raw",
      sql: sqlText.trim(),
      title: "Execute this statement?",
    });
  };

  const cancelPendingMutation = useCallback(() => {
    setPendingMutation(null);
  }, []);

  const proceedMutation = async () => {
    if (!activeSessionId || !activeSessionAlive || !pendingMutation) return;
    const sql = pendingMutation.sql;
    setBusy(true);
    try {
      const r = (await DataExecMutationSQL(activeSessionId, selectedDb, sql)) as main.DataQueryResultDTO;
      setPendingMutation(null);
      const ra = r.rowsAffected;
      let msg: string;
      if (ra === undefined || ra === null) {
        msg = "Statement completed.";
      } else if (ra < 0) {
        msg = "Statement completed (rows affected unknown for this connection).";
      } else {
        msg = `Rows affected: ${ra.toLocaleString()}`;
      }
      setSqlResult({
        columns: ["result"],
        rows: [[msg]],
        totalRows: 1,
      });
      setSqlPage(1);
      setSqlSort({ column: null, dir: null });
      setInnerTab("sql");
    } catch (e: unknown) {
      if (isStaleDataSessionError(e) && activeSessionId) {
        markSessionDisconnected(activeSessionId);
        return;
      }
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runExplain = async (analyze: boolean) => {
    if (!activeSessionId || !activeSessionAlive) return;
    setExplainLoading(true);
    setExplainError(null);
    setExplainResult(null);
    try {
      const r = (await DataExplainSQL(activeSessionId, selectedDb, sqlText, analyze)) as main.DataQueryResultDTO;
      setExplainResult(r && Array.isArray(r.columns) && Array.isArray(r.rows) ? r : null);
    } catch (e: unknown) {
      if (isStaleDataSessionError(e) && activeSessionId) {
        markSessionDisconnected(activeSessionId);
        return;
      }
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainLoading(false);
    }
  };

  const disconnectSession = async (sid: string) => {
    const sess = sessions.find((s) => s.sessionId === sid);
    if (sess?.connectionAlive === false) {
      delete dataTabSnapshotsRef.current[sid];
      setSessions((p) => p.filter((x) => x.sessionId !== sid));
      return;
    }
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
    } catch (e: unknown) {
      if (isStaleDataSessionError(e)) {
        markSessionDisconnected(activeSessionId);
        return;
      }
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
          sd,
          previewFilterCommitted.trim()
        )) as main.DataQueryResultDTO;
        setPreview(r);
      }
    } catch (e: unknown) {
      if (isStaleDataSessionError(e) && activeSessionId) {
        markSessionDisconnected(activeSessionId);
        return;
      }
      alert(e instanceof Error ? e.message : String(e));
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
          sd,
          previewFilterCommitted.trim()
        )) as main.DataQueryResultDTO;
        setPreview(r);
      }
    } catch (e: unknown) {
      if (isStaleDataSessionError(e) && activeSessionId) {
        markSessionDisconnected(activeSessionId);
        return;
      }
      alert(e instanceof Error ? e.message : String(e));
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
                  <DropdownSelect
                    className="docker-select"
                    value={sshGroupFilter}
                    onChange={setSshGroupFilter}
                    options={sshGroupSelectOptions}
                    aria-label="Group filter"
                  />
                </label>
                <label className="data-field">
                  <span>Connection</span>
                  <DropdownSelect
                    className="docker-select"
                    value={sshProfileId}
                    onChange={setSshProfileId}
                    options={sshProfileSelectOptions}
                    emptyMessage="No connections in this group"
                    aria-label="SSH profile"
                  />
                </label>
              </div>
            ) : null}

            {ownerMode === "docker_local" ? (
              <label className="data-field">
                <span>Container</span>
                <DropdownSelect
                  value={localContainer}
                  onChange={setLocalContainer}
                  options={localContainerOptions}
                  aria-label="Docker container"
                />
              </label>
            ) : null}

            {ownerMode === "docker_remote" ? (
              <div className="data-remote-block">
                <div className="data-conn-filters" role="group" aria-label="Remote Docker host">
                  <label className="data-field">
                    <span>Group</span>
                    <DropdownSelect
                      className="docker-select"
                      value={remoteGroupFilter}
                      onChange={setRemoteGroupFilter}
                      options={sshGroupSelectOptions}
                      aria-label="Group filter"
                    />
                  </label>
                  <label className="data-field">
                    <span>Connection</span>
                    <DropdownSelect
                      className="docker-select"
                      value={remoteProfileId}
                      onChange={setRemoteProfileId}
                      options={remoteProfileSelectOptions}
                      emptyMessage="No connections in this group"
                      aria-label="SSH profile for Docker"
                    />
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
                      <DropdownSelect
                        value={remoteContainer}
                        onChange={setRemoteContainer}
                        options={remoteContainerOptions}
                        aria-label="Remote Docker container"
                      />
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
                  const anySessionAlive = sessOpen.some((s) => s.connectionAlive !== false);
                  const topMarker = isConnecting
                    ? "orange"
                    : anySessionAlive
                      ? "green"
                      : sessOpen.length > 0
                        ? "gray"
                        : "none";
                  const markerTitle = isConnecting
                    ? "Connecting…"
                    : anySessionAlive
                      ? "Connected"
                      : sessOpen.length > 0
                        ? "Connection lost"
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
                        {sessOpen.map((s) => {
                          const alive = s.connectionAlive !== false;
                          return (
                          <div key={s.sessionId} className="session">
                            <button
                              type="button"
                              className={`session-btn ${activeSessionId === s.sessionId ? "active" : ""}${alive ? "" : " session-btn--inactive"}`}
                              onClick={() => activateDataSession(s.sessionId)}
                              title={`${s.name} · ${dataEngineDisplay(s.engine)} · ${s.scopeSummary}${alive ? "" : " (inactive)"}`}
                            >
                              <span className={`dot ${alive ? "dot-green" : "dot-gray"}`} />
                              <span>
                                {dataEngineIcon(s.engine)} {dataEngineDisplay(s.engine)}: {s.scopeSummary}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="session-close"
                              onClick={() => void disconnectSession(s.sessionId)}
                              title={alive ? "Disconnect" : "Close tab"}
                            >
                              {alive ? "Disconnect" : "Close"}
                            </button>
                          </div>
                          );
                        })}
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
                  const alive = s.connectionAlive !== false;
                  const label = `${dataEngineIcon(s.engine)} ${dataEngineDisplay(s.engine)}: ${s.scopeSummary}`;
                  return (
                    <button
                      key={s.sessionId}
                      type="button"
                      className={`tab ${isActive ? "active" : ""}${alive ? "" : " tab--inactive"}`}
                      title={`${s.name} · ${label}${alive ? "" : " (inactive)"}`}
                      onClick={() => activateDataSession(s.sessionId)}
                    >
                      <span className={`dot ${alive ? "dot-green" : "dot-gray"}`} />
                      <span className="tab-label">{label}</span>
                      <span
                        className="tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          void disconnectSession(s.sessionId);
                        }}
                        title={alive ? "Disconnect" : "Close tab"}
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
                    <DropdownSelect
                      className="docker-select data-header-namespace-select"
                      value={selectedDb}
                      onChange={(v) => {
                        setSelectedDb(v);
                        setPreviewPage(1);
                      }}
                      options={headerNamespaceOptions}
                      disabled={busy || databases.length === 0}
                      searchable
                      searchPlaceholder="Filter databases…"
                      aria-label={
                        activeSession.engine === "postgres"
                          ? "Schema for tables and SQL. Cluster rows are reference only."
                          : "Active database"
                      }
                    />
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
                    <button type="button" className={innerTab === "explain" ? "active" : ""} onClick={() => setInnerTab("explain")}>
                      <span className="data-inner-tab-icon" aria-hidden>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M4 6h16M4 12h10M4 18h14"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      <span>Explain</span>
                    </button>
                  </div>
                  {innerTab === "sql" || innerTab === "explain" ? (
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
                  ) : (
                    <div className="data-table-filter-toolbar">
                      <button
                        type="button"
                        className={`data-sql-editor-toggle data-table-filter-toggle ${tableFilterToggleActive ? "is-on" : "is-off"}${committedFilterTrim !== "" ? " filter-toggle--committed" : ""}`}
                        disabled={!tableFilterSqlSupported}
                        aria-label="Table filter"
                        aria-pressed={tableFilterToggleActive}
                        title={
                          !tableFilterSqlSupported
                            ? "Table filters require an SSH-connected data source"
                            : tableFilterBarOpen
                              ? "Hide filter"
                              : committedFilterTrim !== ""
                                ? "Filter is applied — click to show filter bar"
                                : "Filter rows"
                        }
                        onClick={() => {
                          if (!tableFilterSqlSupported) return;
                          setTableFilterBarOpen((v) => !v);
                        }}
                      >
                        <span className="data-sql-editor-toggle-icon" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                              d="M5 7h14M8 12h8M10 17h4"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                {innerTab === "table" ? (
                  <div
                    className={`data-table-filter-panel-wrap ${tableFilterBarOpen ? "is-open" : ""}`}
                    aria-hidden={!tableFilterBarOpen}
                  >
                    <div className="data-table-filter-panel-inner">
                  <div className="data-table-filter-panel">
                    {!tableFilterSqlSupported ? (
                      <div className="data-table-filter-unsupported">
                        Table filters are available only for data sources opened over SSH (direct SQL driver). Use Table view
                        without filters in Docker mode, or run SQL in the SQL tab.
                      </div>
                    ) : (
                      <>
                        <div className="data-table-filter-panel-main">
                          {tableFilterClauses.length === 0 ? (
                            <button
                              type="button"
                              className="tf-compact tf-plus"
                              title="Add condition"
                              onClick={() =>
                                setTableFilterClauses([{ join: "", column: "", op: "eq", value: "" }])
                              }
                            >
                              +
                            </button>
                          ) : (
                            <>
                              {tableFilterClauses.map((clause, ci) => (
                                <div key={ci} className="tf-clause">
                                  <div className="tf-clause-inner">
                                    {ci > 0 ? (
                                      <div className="tf-join-wrap">
                                        <DropdownSelect
                                          variant="joinChip"
                                          inline
                                          value={clause.join === "OR" ? "OR" : "AND"}
                                          onChange={(v) =>
                                            setTableFilterClauses((prev) =>
                                              prev.map((row, i) =>
                                                i === ci ? { ...row, join: v as "AND" | "OR" } : row
                                              )
                                            )
                                          }
                                          options={[
                                            { value: "AND", label: "AND" },
                                            { value: "OR", label: "OR" },
                                          ]}
                                          aria-label="Change AND or OR"
                                        />
                                      </div>
                                    ) : null}
                                    <div className="tf-clause-body">
                                    <div className="tf-seg">
                                      <DropdownSelect
                                        variant="pill"
                                        inline
                                        value={clause.column.trim() ? clause.column : "__any__"}
                                        onChange={(v) =>
                                          setTableFilterClauses((prev) =>
                                            prev.map((row, i) =>
                                              i === ci ? { ...row, column: v === "__any__" ? "" : v } : row
                                            )
                                          )
                                        }
                                        options={[
                                          { value: "__any__", label: "ANY" },
                                          ...filterPickerColumns.map((col) => ({
                                            value: col.name ?? "",
                                            label: col.name ?? "",
                                          })),
                                        ]}
                                        searchable
                                        searchPlaceholder="Filter columns…"
                                        emptyMessage="No columns"
                                        aria-label="Filter column"
                                      />
                                      <DropdownSelect
                                        variant="pillOp"
                                        inline
                                        value={clause.op}
                                        onChange={(v) => {
                                          const op = v as TableFilterOp;
                                          setTableFilterClauses((prev) =>
                                            prev.map((row, i) =>
                                              i === ci
                                                ? {
                                                    ...row,
                                                    op,
                                                    value: op === "is" || op === "is_not" ? "" : row.value,
                                                  }
                                                : row
                                            )
                                          );
                                        }}
                                        options={TABLE_FILTER_OPS.map((o) => ({
                                          value: o.op,
                                          label: o.label,
                                        }))}
                                        aria-label="Filter operator"
                                      />
                                      {opNeedsValue(clause.op) ? (
                                        <input
                                          className="tf-input"
                                          value={clause.value}
                                          placeholder={clause.op === "in" ? "a, b, c" : "…"}
                                          spellCheck={false}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            setTableFilterClauses((prev) =>
                                              prev.map((row, i) => (i === ci ? { ...row, value: v } : row))
                                            );
                                          }}
                                        />
                                      ) : (
                                        <span className="tf-value-placeholder" aria-hidden>
                                          —
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="tf-remove"
                                      title="Remove condition"
                                      aria-label="Remove condition"
                                      onClick={() => {
                                        setTableFilterClauses((prev) => {
                                          const next = prev.filter((_, i) => i !== ci);
                                          if (next.length === 0) return next;
                                          return next.map((row, i) =>
                                            i === 0 ? { ...row, join: "" } : row
                                          );
                                        });
                                      }}
                                    >
                                      ×
                                    </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              <div className="tf-dotted-and-wrap">
                                <span className="tf-dotted-line" aria-hidden />
                                <DropdownSelect
                                  variant="andPill"
                                  inline
                                  value="AND"
                                  onChange={(v) =>
                                    setTableFilterClauses((prev) => [
                                      ...prev,
                                      { join: v as "AND" | "OR", column: "", op: "eq", value: "" },
                                    ])
                                  }
                                  options={[
                                    { value: "AND", label: "AND" },
                                    { value: "OR", label: "OR" },
                                  ]}
                                  dropdownAlign="center"
                                  aria-label="Add filter row with AND or OR"
                                />
                                <span className="tf-dotted-line" aria-hidden />
                              </div>
                            </>
                          )}
                        </div>
                        <div className="data-table-filter-apply-wrap">
                          <button
                            type="button"
                            className="tf-apply"
                            disabled={tableFilterShowCancel ? false : tableFilterApplyDisabled}
                            onClick={() => {
                              if (tableFilterShowCancel) {
                                setPreviewFilterCommitted("");
                                setTableFilterClauses([]);
                                setPreviewPage(1);
                                return;
                              }
                              if (tableFilterPayload === null) return;
                              setPreviewFilterCommitted(tableFilterPayload);
                              setPreviewPage(1);
                            }}
                          >
                            {tableFilterShowCancel ? "Cancel" : "Apply"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                    </div>
                  </div>
                ) : null}
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
                          <DataSortableTable
                            className="data-grid data-grid--preview"
                            columns={preview.columns}
                            rows={preview.rows}
                            sort={previewSort}
                            onSortClick={handlePreviewSortClick}
                            emptyMessage="This table has no rows."
                            onRowClick={(row) => void openRow(row)}
                          />
                        ) : (
                          <div className="data-placeholder data-placeholder-muted">
                            Could not load data for this table.
                          </div>
                        )}
                      </div>
                      {preview && !previewLoading && selectedTable && Array.isArray(preview.columns) ? (
                        <DataGridPaginationFooter
                          page={previewPage}
                          pageSize={PREVIEW_PAGE_SIZE}
                          totalRows={previewTotalRows}
                          onPageChange={setPreviewPage}
                          paginationDisabled={busy}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : innerTab === "sql" ? (
                  <div
                    className={`data-sql-pane-outer${sqlSchemaBrowserOpen ? " data-sql-pane-outer--with-rail" : ""}`}
                  >
                    {sqlSchemaBrowserOpen ? (
                      <aside className="data-sql-schema-rail" aria-label="Table reference">
                        <div className="data-sql-rail-block">
                          <div className="data-sql-rail-label">Table</div>
                          <DropdownSelect
                            className="docker-select data-sql-rail-select"
                            value={selectedTable}
                            onChange={setSelectedTable}
                            options={tableRailOptions}
                            disabled={!selectedDb || tables.length === 0}
                            searchable
                            searchPlaceholder="Filter tables…"
                            aria-label="Table for SQL rail"
                          />
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
                          <button
                            type="button"
                            className="btn"
                            disabled={busy || !activeSessionAlive}
                            title={!activeSessionAlive ? "Connection lost" : undefined}
                            onClick={() => void runSql()}
                          >
                            Run
                          </button>
                        </div>
                      ) : null}
                      {pendingMutation ? (
                        <div className="data-mutation-banner" role="region" aria-label="Mutation confirmation">
                          {pendingMutation.mode === "preview" ? (
                            <>
                              <div className="data-mutation-banner-title">Affected rows (estimate)</div>
                              <p className="data-mutation-meta mono">
                                {Number(pendingMutation.preview.totalRows ?? 0).toLocaleString()} row(s) match. Sample below
                                (first {MUTATION_PREVIEW_SAMPLE_LIMIT}).
                              </p>
                              {Array.isArray(pendingMutation.preview.columns) &&
                              Array.isArray(pendingMutation.preview.rows) &&
                              pendingMutation.preview.columns.length > 0 ? (
                                <div className="data-grid-wrap data-mutation-sample-wrap">
                                  <div className="data-grid-scroll">
                                    <table className="data-grid">
                                      <thead>
                                        <tr>
                                          {pendingMutation.preview.columns.map((c) => (
                                            <th key={c}>{c}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(pendingMutation.preview.rows ?? []).map((row, ri) => (
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
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <pre className="data-mutation-sql-preview mono">{pendingMutation.sql}</pre>
                          )}
                          <p className="data-mutation-raw-title">
                            {pendingMutation.mode === "raw"
                              ? pendingMutation.title
                              : "Proceed to execute this statement?"}
                          </p>
                          <div className="data-mutation-actions">
                            <button
                              type="button"
                              className="btn data-mutation-proceed"
                              disabled={busy || !activeSessionAlive}
                              onClick={() => void proceedMutation()}
                            >
                              Proceed
                            </button>
                            <button type="button" className="btn" disabled={busy} onClick={cancelPendingMutation}>
                              Cancel
                            </button>
                          </div>
                          <p className="data-mutation-disclaimer data-hint">
                            Preview and row counts are best-effort (simple DELETE/UPDATE shapes only). The real statement
                            may affect a different number of rows because of triggers, permissions, or concurrent changes.
                          </p>
                        </div>
                      ) : null}
                      <div
                        className={`data-sql-results${hasSqlResultTable ? " data-sql-results--split" : ""}`}
                      >
                        {hasSqlResultTable && sqlResult ? (
                          <div className="data-grid-wrap">
                            <div className="data-grid-scroll" ref={sqlResultsScrollRef}>
                              <DataSortableTable
                                className="data-grid data-grid--sql-results"
                                columns={sqlResult.columns ?? []}
                                rows={sqlPageRows}
                                sort={sqlSort}
                                onSortClick={handleSqlSortClick}
                                emptyMessage="No rows."
                              />
                            </div>
                            <DataGridPaginationFooter
                              page={sqlPage}
                              pageSize={PREVIEW_PAGE_SIZE}
                              totalRows={sqlDisplayTotal}
                              paginationRowCount={sqlPageBasis}
                              loadedRowCount={
                                sqlDisplayTotal > sqlLoadedCount ? sqlLoadedCount : undefined
                              }
                              onPageChange={handleSqlPageChange}
                              paginationDisabled={busy}
                            />
                          </div>
                        ) : (
                          <div className="data-placeholder data-sql-results-placeholder">Run a query to see results here.</div>
                        )}
                      </div>
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
                          <DropdownSelect
                            className="docker-select data-sql-rail-select"
                            value={selectedTable}
                            onChange={setSelectedTable}
                            options={tableRailOptions}
                            disabled={!selectedDb || tables.length === 0}
                            searchable
                            searchPlaceholder="Filter tables…"
                            aria-label="Table for SQL rail"
                          />
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
                        <div className="data-sql-script-block data-sql-explain-actions">
                          <textarea className="data-sql-input mono" value={sqlText} onChange={(e) => setSqlText(e.target.value)} rows={8} />
                          <div className="data-sql-explain-buttons">
                            <button
                              type="button"
                              className="btn"
                              disabled={busy || !activeSessionAlive || explainLoading}
                              title={!activeSessionAlive ? "Connection lost" : "Query plan (estimated)"}
                              onClick={() => void runExplain(false)}
                            >
                              Explain
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={busy || !activeSessionAlive || explainLoading}
                              title="Runs the query to measure actual timings"
                              onClick={() => void runExplain(true)}
                            >
                              Explain analyze
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className={`data-sql-results data-sql-results--split data-explain-out`}>
                        {explainLoading ? (
                          <div className="data-placeholder data-placeholder-muted">Loading plan…</div>
                        ) : explainError ? (
                          <div className="data-placeholder data-placeholder-error">{explainError}</div>
                        ) : explainResult &&
                          Array.isArray(explainResult.columns) &&
                          Array.isArray(explainResult.rows) &&
                          explainResult.rows.length > 0 ? (
                          <div className="data-grid-wrap">
                            <div className="data-grid-scroll">
                              <table className="data-grid data-grid--explain">
                                <thead>
                                  <tr>
                                    {(explainResult.columns ?? []).map((c) => (
                                      <th key={c}>{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {explainResult.rows.map((row, ri) => (
                                    <tr key={ri}>
                                      {(row ?? []).map((cell, ci) => (
                                        <td key={ci} className="data-explain-cell">
                                          <span className="data-cell-clip data-explain-cell-text">{cell}</span>
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="data-placeholder data-sql-results-placeholder">
                            Use Explain or Explain analyze to show the plan for the query above.
                          </div>
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
