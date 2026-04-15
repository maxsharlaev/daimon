import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DeleteLogFormat,
  DeleteMacro,
  GetLogsSettings,
  ListLogFormats,
  ListMacros,
  LogsPurge,
  PreviewLogParse,
  PreviewLogParseDraft,
  PrivacyClearAuthPassword,
  PrivacyClearAuthPrivateKey,
  PrivacyDeleteAllCustomSecrets,
  ListPrivacyDockerLocalLogBuckets,
  ListPrivacyDockerRemoteLogBuckets,
  ListPrivacyDockerRemoteOrphanLogBuckets,
  PrivacyPurgeAllSecrets,
  PrivacyDeleteAllDataSources,
  PrivacyDeleteDataSourcesForProfile,
  PrivacyPurgeDockerLocalLogs,
  PrivacyPurgeDockerRemoteLogs,
  PrivacyPurgeProfileLogs,
  SaveLogsSettings,
  SettingsClearUILayout,
  SettingsPrivacyProfileDetail,
  SettingsPrivacyReport,
  SettingsDatabaseStorageReport,
  UpsertLogFormat,
  UpsertMacro,
  ListAiConversations,
  DeleteAiConversation,
  GetAiSettings,
} from "../../wailsjs/go/main/App";
import type { MacroDTO, ProfileDTO } from "../types/models";
import { SETTINGS_REFRESH_ALL_EVENT } from "../settingsEvents";
import { SettingsPlacesPanel } from "./SettingsPlacesPanel";
import { SettingsDataPanel } from "./SettingsDataPanel";
import { AiModePanel } from "./AiModePanel";
import { DeveloperAiLogsPanel } from "./DeveloperAiLogsPanel";
import { DeveloperModePanel } from "./DeveloperModePanel";
import "./docker/docker.css";
import type {
  LogFormatDTO,
  LogParsePreviewRecordDTO,
  LogParsePreviewResultDTO,
  LogParseDraftDTO,
  LogsSettingsDTO,
  SettingsPrivacyReportDTO,
  SettingsDatabaseStorageDTO,
} from "../types/logs";
import { main } from "../../wailsjs/go/models";
import "./settingspage.css";

type Props = {
  profiles: ProfileDTO[];
  onCreateMacro: () => void;
  onEditMacro: (m: MacroDTO) => void;
};

type SettingsTab = "logs" | "macros" | "places" | "ai" | "developer" | "data" | "privacy";

type PrivacyProfileDetail = {
  profileId: string;
  passwordStorage: string;
  passwordSet: boolean;
  privateKeyStorage: string;
  privateKeySet: boolean;
  customSecrets: { key: string; storage: string; updatedAt: number }[];
  vaultItemCount: number;
  logProfileSourceCount: number;
  logEntryCount: number;
  logLastSyncedUnixMs: number;
  dataSourceCount: number;
};

type PrivacyScope = "connection" | "docker_local" | "docker_remote";

type PrivacySubPage = "home" | "database" | "profiles" | "dialogs" | "maintenance";

type PrivacyDockerLogBucket = {
  containerName: string;
  sourceCount: number;
  entryCount: number;
  lastSyncedUnixMs: number;
  orphaned?: boolean;
};

type PrivacyDockerRemoteOrphanBucket = {
  profileId: string;
  containerName: string;
  sourceCount: number;
  entryCount: number;
  lastSyncedUnixMs: number;
};

type LogsSubTab = "general" | "formats";

/** Sample lines aligned with backend builtin parsers in logs_api.go */
const FORMAT_SAMPLE_BY_BUILTIN: Record<string, string> = {
  generic_plain_with_timestamp_guess: `[2026-04-10 14:32:01] INFO: service ready
  at com.example.Bootstrap.run(Bootstrap.java:88)`,
  syslog: `Apr 10 14:32:01 myhost sshd[1234]: Failed password for root from 192.0.2.1 port 22 ssh2`,
  nginx_access: `192.0.2.1 - - [10/Apr/2026:14:32:01 +0000] "GET /api/health HTTP/1.1" 200 512 "-" "curl/8.0"`,
  nginx_error: `2026/04/10 14:32:01 [error] 1234#1234: *99 open() "/var/www/html/missing" failed (2: No such file or directory), client: 192.0.2.1, server: example.com, request: "GET /missing HTTP/1.1", host: "example.com"`,
  php_error: `[10-Apr-2026 14:32:01 UTC] PHP Warning:  Undefined array key "foo" in /var/www/html/index.php on line 12`,
  php_fpm: `[10-Apr-2026 14:32:01] NOTICE: fpm is running, pid 123`,
};

const CUSTOM_FORMAT_FALLBACK_SAMPLE =
  "2026-04-10 14:32:01 ERROR connection refused to db.example.com:5432";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatSampleLine(f: LogFormatDTO): string {
  const key = (f.builtinKey || "").trim();
  if (key && FORMAT_SAMPLE_BY_BUILTIN[key]) return FORMAT_SAMPLE_BY_BUILTIN[key];
  if (f.parserType === "regex" && (f.pattern || "").trim()) {
    return CUSTOM_FORMAT_FALLBACK_SAMPLE;
  }
  return "No sample line is defined for this format.";
}

function previewStructuredBlock(r: LogParsePreviewRecordDTO): Record<string, unknown> {
  let meta: unknown = {};
  try {
    meta = r.metaJson ? JSON.parse(r.metaJson) : {};
  } catch {
    meta = { _raw: r.metaJson };
  }
  return {
    timestampUnixMs: r.timestampUnixMs,
    timestampSource: r.timestampSource,
    level: r.level,
    levelSource: r.levelSource,
    message: r.message,
    meta,
    rawText: r.rawText,
  };
}

type FormatEditorState = {
  open: boolean;
  id?: string;
  name: string;
  description: string;
  pattern: string;
  timeLayout: string;
  captureGroupsJson: string;
  levelMappingJson: string;
};

const emptyEditor: FormatEditorState = {
  open: false,
  name: "",
  description: "",
  pattern: "",
  timeLayout: "",
  captureGroupsJson: '{\n  "1": "timestamp",\n  "2": "level",\n  "3": "message"\n}',
  levelMappingJson: "{}",
};

export function SettingsPage({ profiles, onCreateMacro, onEditMacro }: Props) {
  const [tab, setTab] = useState<SettingsTab>("privacy");
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [settingsRefreshing, setSettingsRefreshing] = useState(false);

  const [macros, setMacros] = useState<MacroDTO[]>([]);
  const [macrosBusy, setMacrosBusy] = useState(false);
  const [macrosError, setMacrosError] = useState<string | null>(null);

  const [report, setReport] = useState<SettingsPrivacyReportDTO | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  const [formats, setFormats] = useState<LogFormatDTO[]>([]);
  const [formatsBusy, setFormatsBusy] = useState(false);
  const [formatsError, setFormatsError] = useState<string | null>(null);
  const [logsSettings, setLogsSettings] = useState<LogsSettingsDTO>({ maxFileBytes: 20 * 1024 * 1024, defaultRetentionDays: 30, redactionPatterns: [] });
  const [logsSettingsDirty, setLogsSettingsDirty] = useState(false);
  const [editor, setEditor] = useState<FormatEditorState>(emptyEditor);
  const [logsSubTab, setLogsSubTab] = useState<LogsSubTab>("general");
  const [selectedFormatId, setSelectedFormatId] = useState<string>("");
  const [formatPreviewInput, setFormatPreviewInput] = useState("");
  const [formatPreviewResult, setFormatPreviewResult] = useState<LogParsePreviewResultDTO | null>(null);
  const [formatPreviewBusy, setFormatPreviewBusy] = useState(false);
  const [formatPreviewError, setFormatPreviewError] = useState<string | null>(null);
  const [formatsSearchQuery, setFormatsSearchQuery] = useState("");
  const [formatsShowSystem, setFormatsShowSystem] = useState(true);
  const [formatsShowCustom, setFormatsShowCustom] = useState(true);
  const [editorPreviewSample, setEditorPreviewSample] = useState("");
  const [editorDraftPreview, setEditorDraftPreview] = useState<LogParsePreviewResultDTO | null>(null);
  const [editorDraftBusy, setEditorDraftBusy] = useState(false);
  const [editorDraftError, setEditorDraftError] = useState<string | null>(null);

  const [privacySelectedProfileId, setPrivacySelectedProfileId] = useState<string | null>(null);
  const [privacyDetail, setPrivacyDetail] = useState<PrivacyProfileDetail | null>(null);
  const [privacyDetailBusy, setPrivacyDetailBusy] = useState(false);
  const [privacyDetailError, setPrivacyDetailError] = useState<string | null>(null);
  const [privacyActionBusy, setPrivacyActionBusy] = useState(false);

  const [privacyScope, setPrivacyScope] = useState<PrivacyScope>("connection");
  const [privacyDockerLocalBuckets, setPrivacyDockerLocalBuckets] = useState<PrivacyDockerLogBucket[]>([]);
  const [privacyDockerLocalBusy, setPrivacyDockerLocalBusy] = useState(false);
  const [privacyDockerLocalErr, setPrivacyDockerLocalErr] = useState<string | null>(null);
  const [privacyDockerLocalSelected, setPrivacyDockerLocalSelected] = useState<string | null>(null);

  const [privacyRemoteMasterProfileId, setPrivacyRemoteMasterProfileId] = useState<string | null>(null);
  const [privacyDockerRemoteBuckets, setPrivacyDockerRemoteBuckets] = useState<PrivacyDockerLogBucket[]>([]);
  const [privacyDockerRemoteBusy, setPrivacyDockerRemoteBusy] = useState(false);
  const [privacyDockerRemoteErr, setPrivacyDockerRemoteErr] = useState<string | null>(null);
  const [privacyRemotePick, setPrivacyRemotePick] = useState<{ profileId: string; containerName: string } | null>(null);
  const [privacyDockerRemoteOrphanBuckets, setPrivacyDockerRemoteOrphanBuckets] = useState<PrivacyDockerRemoteOrphanBucket[]>(
    []
  );
  const [privacyDockerRemoteOrphanBusy, setPrivacyDockerRemoteOrphanBusy] = useState(false);
  const [privacyDockerRemoteOrphanErr, setPrivacyDockerRemoteOrphanErr] = useState<string | null>(null);
  const [privacyMaintenanceBusy, setPrivacyMaintenanceBusy] = useState(false);
  const [privacyMaintenanceErr, setPrivacyMaintenanceErr] = useState<string | null>(null);
  const [privacyMaintenanceConfirm, setPrivacyMaintenanceConfirm] = useState<null | "layout" | "logs" | "secrets">(null);
  const [privacyDeleteAllDataSourcesOpen, setPrivacyDeleteAllDataSourcesOpen] = useState(false);
  const [privacyDeleteProfileDataSourcesOpen, setPrivacyDeleteProfileDataSourcesOpen] = useState(false);

  const [privacySub, setPrivacySub] = useState<PrivacySubPage>("home");
  const [dbStorage, setDbStorage] = useState<SettingsDatabaseStorageDTO | null>(null);
  const [dbStorageBusy, setDbStorageBusy] = useState(false);

  const [aiPrivacyList, setAiPrivacyList] = useState<main.AiConversationListDTO[]>([]);
  const [aiPrivacyBusy, setAiPrivacyBusy] = useState(false);

  const sortedProfiles = useMemo(
    () =>
      [...profiles].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: "base" })),
    [profiles]
  );

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "dialogs") return;
    void (async () => {
      setAiPrivacyBusy(true);
      try {
        setAiPrivacyList(await ListAiConversations());
      } catch {
        setAiPrivacyList([]);
      } finally {
        setAiPrivacyBusy(false);
      }
    })();
  }, [tab, privacySub]);

  const loadMacros = useCallback(async () => {
    setMacrosBusy(true);
    setMacrosError(null);
    try {
      setMacros((await ListMacros()) as any);
    } catch (e: any) {
      setMacrosError(e?.message ?? String(e));
      setMacros([]);
    } finally {
      setMacrosBusy(false);
    }
  }, []);

  const loadPrivacy = useCallback(async () => {
    setPrivacyBusy(true);
    setPrivacyError(null);
    try {
      setReport((await SettingsPrivacyReport()) as any);
    } catch (e: any) {
      setPrivacyError(e?.message ?? String(e));
      setReport(null);
    } finally {
      setPrivacyBusy(false);
    }
  }, []);

  const loadDbStorage = useCallback(async () => {
    setDbStorageBusy(true);
    try {
      const raw = (await SettingsDatabaseStorageReport()) as SettingsDatabaseStorageDTO & { tables?: unknown };
      const tables = Array.isArray(raw?.tables) ? raw.tables : [];
      setDbStorage({ ...raw, tables } as SettingsDatabaseStorageDTO);
    } catch {
      setDbStorage(null);
    } finally {
      setDbStorageBusy(false);
    }
  }, []);

  const loadLogsSettings = useCallback(async () => {
    setFormatsBusy(true);
    setFormatsError(null);
    try {
      const [nextFormats, nextSettings] = await Promise.all([ListLogFormats(), GetLogsSettings()]);
      setFormats((nextFormats as any) as LogFormatDTO[]);
      setLogsSettings((nextSettings as any) as LogsSettingsDTO);
      setLogsSettingsDirty(false);
    } catch (e: any) {
      setFormatsError(e?.message ?? String(e));
      setFormats([]);
    } finally {
      setFormatsBusy(false);
    }
  }, []);

  const loadAiModeGate = useCallback(async () => {
    try {
      const st = await GetAiSettings();
      setDeveloperModeEnabled(!!st?.developerModeEnabled);
    } catch {
      setDeveloperModeEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadMacros();
    void loadPrivacy();
    void loadLogsSettings();
    void loadAiModeGate();
  }, [loadAiModeGate, loadLogsSettings, loadMacros, loadPrivacy]);

  useEffect(() => {
    if (tab !== "privacy") setPrivacySub("home");
  }, [tab]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "database") return;
    void loadDbStorage();
  }, [tab, privacySub, loadDbStorage]);

  const loadPrivacyDetail = useCallback(async (profileId: string) => {
    setPrivacyDetailBusy(true);
    setPrivacyDetailError(null);
    try {
      const d = (await SettingsPrivacyProfileDetail(profileId)) as PrivacyProfileDetail;
      setPrivacyDetail(d);
    } catch (e: any) {
      setPrivacyDetailError(e?.message ?? String(e));
      setPrivacyDetail(null);
    } finally {
      setPrivacyDetailBusy(false);
    }
  }, []);

  const reloadPrivacyDockerLocal = useCallback(async () => {
    setPrivacyDockerLocalBusy(true);
    setPrivacyDockerLocalErr(null);
    try {
      setPrivacyDockerLocalBuckets((await ListPrivacyDockerLocalLogBuckets()) as PrivacyDockerLogBucket[]);
    } catch (e: any) {
      setPrivacyDockerLocalErr(e?.message ?? String(e));
      setPrivacyDockerLocalBuckets([]);
    } finally {
      setPrivacyDockerLocalBusy(false);
    }
  }, []);

  const reloadPrivacyDockerRemote = useCallback(async (profileId: string) => {
    setPrivacyDockerRemoteBusy(true);
    setPrivacyDockerRemoteErr(null);
    try {
      setPrivacyDockerRemoteBuckets((await ListPrivacyDockerRemoteLogBuckets(profileId)) as PrivacyDockerLogBucket[]);
    } catch (e: any) {
      setPrivacyDockerRemoteErr(e?.message ?? String(e));
      setPrivacyDockerRemoteBuckets([]);
    } finally {
      setPrivacyDockerRemoteBusy(false);
    }
  }, []);

  const reloadPrivacyDockerRemoteOrphans = useCallback(async () => {
    setPrivacyDockerRemoteOrphanBusy(true);
    setPrivacyDockerRemoteOrphanErr(null);
    try {
      setPrivacyDockerRemoteOrphanBuckets((await ListPrivacyDockerRemoteOrphanLogBuckets()) as PrivacyDockerRemoteOrphanBucket[]);
    } catch (e: any) {
      setPrivacyDockerRemoteOrphanErr(e?.message ?? String(e));
      setPrivacyDockerRemoteOrphanBuckets([]);
    } finally {
      setPrivacyDockerRemoteOrphanBusy(false);
    }
  }, []);

  const sortedPrivacyDockerLocalBuckets = useMemo(() => {
    const xs = [...privacyDockerLocalBuckets];
    xs.sort((a, b) => {
      if (!!a.orphaned !== !!b.orphaned) return a.orphaned ? 1 : -1;
      return a.containerName.localeCompare(b.containerName, undefined, { sensitivity: "base" });
    });
    return xs;
  }, [privacyDockerLocalBuckets]);

  const privacyRemoteOrphanProfileIds = useMemo(() => {
    const s = new Set(privacyDockerRemoteOrphanBuckets.map((b) => b.profileId));
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [privacyDockerRemoteOrphanBuckets]);

  const privacyRemoteMasterIsKnownProfile = useMemo(() => {
    if (!privacyRemoteMasterProfileId) return false;
    return sortedProfiles.some((p) => p.id === privacyRemoteMasterProfileId);
  }, [privacyRemoteMasterProfileId, sortedProfiles]);

  const privacyRemoteDetailBuckets = useMemo((): PrivacyDockerLogBucket[] => {
    if (!privacyRemoteMasterProfileId) return [];
    if (privacyRemoteMasterIsKnownProfile) return privacyDockerRemoteBuckets;
    return privacyDockerRemoteOrphanBuckets
      .filter((b) => b.profileId === privacyRemoteMasterProfileId)
      .map((b) => ({
        containerName: b.containerName,
        sourceCount: b.sourceCount,
        entryCount: b.entryCount,
        lastSyncedUnixMs: b.lastSyncedUnixMs,
      }));
  }, [
    privacyRemoteMasterProfileId,
    privacyRemoteMasterIsKnownProfile,
    privacyDockerRemoteBuckets,
    privacyDockerRemoteOrphanBuckets,
  ]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "profiles") return;
    if (!privacySelectedProfileId) {
      setPrivacyDetail(null);
      return;
    }
    void loadPrivacyDetail(privacySelectedProfileId);
  }, [tab, privacySub, privacySelectedProfileId, loadPrivacyDetail]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "profiles") return;
    if (sortedProfiles.length === 0) {
      setPrivacySelectedProfileId(null);
      return;
    }
    if (privacySelectedProfileId && sortedProfiles.some((p) => p.id === privacySelectedProfileId)) return;
    setPrivacySelectedProfileId(sortedProfiles[0].id);
  }, [tab, privacySub, sortedProfiles, privacySelectedProfileId]);

  useEffect(() => {
    if (tab !== "privacy") {
      setPrivacyScope("connection");
      setPrivacyDockerLocalSelected(null);
      setPrivacyRemotePick(null);
      setPrivacyRemoteMasterProfileId(null);
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "profiles" || privacyScope !== "docker_local") return;
    void reloadPrivacyDockerLocal();
  }, [tab, privacySub, privacyScope, reloadPrivacyDockerLocal]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "profiles" || privacyScope !== "docker_remote") return;
    const orphanIds = privacyRemoteOrphanProfileIds;
    if (sortedProfiles.length === 0 && orphanIds.length === 0) {
      setPrivacyRemoteMasterProfileId(null);
      return;
    }
    if (privacyRemoteMasterProfileId) {
      const okKnown = sortedProfiles.some((p) => p.id === privacyRemoteMasterProfileId);
      const okOrphan = orphanIds.includes(privacyRemoteMasterProfileId);
      if (okKnown || okOrphan) return;
    }
    if (sortedProfiles.length > 0) {
      setPrivacyRemoteMasterProfileId(sortedProfiles[0].id);
    } else {
      setPrivacyRemoteMasterProfileId(orphanIds[0] ?? null);
    }
  }, [tab, privacySub, privacyScope, sortedProfiles, privacyRemoteOrphanProfileIds, privacyRemoteMasterProfileId]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "profiles" || privacyScope !== "docker_remote") {
      return;
    }
    void reloadPrivacyDockerRemoteOrphans();
  }, [tab, privacySub, privacyScope, reloadPrivacyDockerRemoteOrphans]);

  useEffect(() => {
    if (tab !== "privacy" || privacySub !== "profiles" || privacyScope !== "docker_remote" || !privacyRemoteMasterProfileId) {
      setPrivacyDockerRemoteBuckets([]);
      return;
    }
    if (!privacyRemoteMasterIsKnownProfile) {
      setPrivacyDockerRemoteBuckets([]);
      return;
    }
    void reloadPrivacyDockerRemote(privacyRemoteMasterProfileId);
  }, [
    tab,
    privacySub,
    privacyScope,
    privacyRemoteMasterProfileId,
    privacyRemoteMasterIsKnownProfile,
    reloadPrivacyDockerRemote,
  ]);

  const runPrivacyAction = useCallback(
    async (action: "password" | "privateKey" | "customSecrets" | "logs", confirmMessage: string) => {
      if (!privacySelectedProfileId) return;
      if (!window.confirm(confirmMessage)) return;
      setPrivacyActionBusy(true);
      setPrivacyDetailError(null);
      try {
        if (action === "password") await PrivacyClearAuthPassword(privacySelectedProfileId);
        if (action === "privateKey") await PrivacyClearAuthPrivateKey(privacySelectedProfileId);
        if (action === "customSecrets") await PrivacyDeleteAllCustomSecrets(privacySelectedProfileId);
        if (action === "logs") await PrivacyPurgeProfileLogs(privacySelectedProfileId);
        await loadPrivacyDetail(privacySelectedProfileId);
        await loadPrivacy();
        await loadDbStorage();
      } catch (e: any) {
        setPrivacyDetailError(e?.message ?? String(e));
      } finally {
        setPrivacyActionBusy(false);
      }
    },
    [privacySelectedProfileId, loadPrivacyDetail, loadPrivacy, loadDbStorage]
  );

  const runPrivacyDeleteAllDataSources = useCallback(async () => {
    setPrivacyActionBusy(true);
    setPrivacyError(null);
    try {
      await PrivacyDeleteAllDataSources();
      setPrivacyDeleteAllDataSourcesOpen(false);
      await loadPrivacy();
      await loadDbStorage();
    } catch (e: any) {
      setPrivacyError(e?.message ?? String(e));
    } finally {
      setPrivacyActionBusy(false);
    }
  }, [loadPrivacy, loadDbStorage]);

  const runPrivacyDeleteDataSourcesForProfile = useCallback(async () => {
    if (!privacySelectedProfileId) return;
    setPrivacyActionBusy(true);
    setPrivacyDetailError(null);
    try {
      await PrivacyDeleteDataSourcesForProfile(privacySelectedProfileId);
      setPrivacyDeleteProfileDataSourcesOpen(false);
      await loadPrivacyDetail(privacySelectedProfileId);
      await loadPrivacy();
      await loadDbStorage();
    } catch (e: any) {
      setPrivacyDetailError(e?.message ?? String(e));
    } finally {
      setPrivacyActionBusy(false);
    }
  }, [privacySelectedProfileId, loadPrivacyDetail, loadPrivacy, loadDbStorage]);

  const runDockerPrivacyPurgeLocal = useCallback(
    async (containerName: string) => {
      if (
        !window.confirm(
          containerName
            ? `Delete all Docker local log sources and imported entries for container “${containerName}”? This cannot be undone.`
            : "Delete all Docker local log sources and imported entries on this machine? This cannot be undone."
        )
      ) {
        return;
      }
      setPrivacyActionBusy(true);
      setPrivacyDockerLocalErr(null);
      try {
        await PrivacyPurgeDockerLocalLogs(containerName);
        await loadPrivacy();
        await loadDbStorage();
        await reloadPrivacyDockerLocal();
        setPrivacyDockerLocalSelected(null);
      } catch (e: any) {
        setPrivacyDockerLocalErr(e?.message ?? String(e));
      } finally {
        setPrivacyActionBusy(false);
      }
    },
    [loadPrivacy, loadDbStorage, reloadPrivacyDockerLocal]
  );

  const runDockerPrivacyPurgeRemote = useCallback(
    async (profileId: string, containerName: string) => {
      const prof = profiles.find((p) => p.id === profileId);
      const isOrphanProfile = !profiles.some((p) => p.id === profileId);
      const label = isOrphanProfile
        ? `Unknown profile (${profileId.length > 28 ? `${profileId.slice(0, 28)}…` : profileId})`
        : prof?.name?.trim() || profileId;
      if (
        !window.confirm(
          containerName
            ? `Delete Docker remote log data for “${label}” / container “${containerName}”? This cannot be undone.`
            : `Delete all Docker remote log data for “${label}”? This cannot be undone.`
        )
      ) {
        return;
      }
      setPrivacyActionBusy(true);
      setPrivacyDockerRemoteErr(null);
      try {
        await PrivacyPurgeDockerRemoteLogs(profileId, containerName);
        await loadPrivacy();
        await loadDbStorage();
        await reloadPrivacyDockerRemoteOrphans();
        if (profiles.some((p) => p.id === profileId)) {
          await reloadPrivacyDockerRemote(profileId);
        }
        setPrivacyRemotePick(null);
      } catch (e: any) {
        setPrivacyDockerRemoteErr(e?.message ?? String(e));
      } finally {
        setPrivacyActionBusy(false);
      }
    },
    [loadPrivacy, loadDbStorage, profiles, reloadPrivacyDockerRemote, reloadPrivacyDockerRemoteOrphans]
  );

  const runPrivacyRefresh = useCallback(async () => {
    await loadPrivacy();
    await loadDbStorage();
    if (privacyScope === "docker_local") await reloadPrivacyDockerLocal();
    if (privacyScope === "docker_remote") {
      await reloadPrivacyDockerRemoteOrphans();
      if (privacyRemoteMasterProfileId && profiles.some((p) => p.id === privacyRemoteMasterProfileId)) {
        await reloadPrivacyDockerRemote(privacyRemoteMasterProfileId);
      }
    }
    if (privacyScope === "connection" && privacySelectedProfileId) {
      await loadPrivacyDetail(privacySelectedProfileId);
    }
  }, [
    loadPrivacy,
    loadDbStorage,
    loadPrivacyDetail,
    privacyScope,
    privacySelectedProfileId,
    privacyRemoteMasterProfileId,
    profiles,
    reloadPrivacyDockerLocal,
    reloadPrivacyDockerRemote,
    reloadPrivacyDockerRemoteOrphans,
  ]);

  const refreshAllSettings = useCallback(async () => {
    setSettingsRefreshing(true);
    try {
      await Promise.all([loadMacros(), loadLogsSettings()]);
      await runPrivacyRefresh();
      await loadAiModeGate();
      try {
        setAiPrivacyList(await ListAiConversations());
      } catch {
        setAiPrivacyList([]);
      }
      window.dispatchEvent(new CustomEvent(SETTINGS_REFRESH_ALL_EVENT));
    } finally {
      setSettingsRefreshing(false);
    }
  }, [loadAiModeGate, loadMacros, loadLogsSettings, runPrivacyRefresh]);

  const executePrivacyMaintenance = useCallback(
    async (kind: "layout" | "logs" | "secrets") => {
      setPrivacyMaintenanceBusy(true);
      setPrivacyMaintenanceErr(null);
      try {
        if (kind === "layout") {
          await SettingsClearUILayout();
          await loadPrivacy();
          await loadDbStorage();
        } else if (kind === "logs") {
          await LogsPurge({} as any);
          await loadPrivacy();
          await loadDbStorage();
          if (privacySelectedProfileId) await loadPrivacyDetail(privacySelectedProfileId);
          await reloadPrivacyDockerLocal();
          await reloadPrivacyDockerRemoteOrphans();
          if (privacyRemoteMasterProfileId && profiles.some((p) => p.id === privacyRemoteMasterProfileId)) {
            await reloadPrivacyDockerRemote(privacyRemoteMasterProfileId);
          }
        } else {
          await PrivacyPurgeAllSecrets();
          await loadPrivacy();
          await loadDbStorage();
          if (privacySelectedProfileId) await loadPrivacyDetail(privacySelectedProfileId);
        }
        setPrivacyMaintenanceConfirm(null);
      } catch (e: any) {
        setPrivacyMaintenanceErr(e?.message ?? String(e));
        setPrivacyMaintenanceConfirm(null);
      } finally {
        setPrivacyMaintenanceBusy(false);
      }
    },
    [
      loadPrivacy,
      loadDbStorage,
      loadPrivacyDetail,
      privacySelectedProfileId,
      reloadPrivacyDockerLocal,
      reloadPrivacyDockerRemote,
      reloadPrivacyDockerRemoteOrphans,
      privacyRemoteMasterProfileId,
      profiles,
    ]
  );

  const customFormats = useMemo(() => formats.filter((f) => !f.isSystem), [formats]);
  const systemFormats = useMemo(() => formats.filter((f) => f.isSystem), [formats]);

  const formatsListOrdered = useMemo(() => [...systemFormats, ...customFormats], [systemFormats, customFormats]);

  const formatsListByKind = useMemo(() => {
    return formatsListOrdered.filter((f) => {
      if (f.isSystem && !formatsShowSystem) return false;
      if (!f.isSystem && !formatsShowCustom) return false;
      return true;
    });
  }, [formatsListOrdered, formatsShowSystem, formatsShowCustom]);

  const formatsListFiltered = useMemo(() => {
    const q = formatsSearchQuery.trim().toLowerCase();
    if (!q) return formatsListByKind;
    return formatsListByKind.filter((f) => {
      const parts = [f.name, f.description, f.builtinKey, f.parserType, f.pattern].filter(Boolean).join(" ").toLowerCase();
      return parts.includes(q);
    });
  }, [formatsListByKind, formatsSearchQuery]);

  useEffect(() => {
    if (logsSubTab !== "formats") {
      setFormatsSearchQuery("");
      setFormatsShowSystem(true);
      setFormatsShowCustom(true);
    }
  }, [logsSubTab]);

  useEffect(() => {
    if (formatsListOrdered.length === 0) {
      setSelectedFormatId("");
      return;
    }
    const q = formatsSearchQuery.trim();
    const pool = q === "" ? formatsListByKind : formatsListFiltered;
    if (pool.length === 0) {
      setSelectedFormatId("");
      return;
    }
    setSelectedFormatId((prev) => (pool.some((f) => f.id === prev) ? prev : pool[0].id));
  }, [formatsListOrdered, formatsListByKind, formatsListFiltered, formatsSearchQuery]);

  const selectedFormat = useMemo(
    () => formatsListOrdered.find((f) => f.id === selectedFormatId) ?? null,
    [formatsListOrdered, selectedFormatId]
  );

  const formatPreviewResetKey = useMemo(() => {
    if (!selectedFormat) return "";
    return `${selectedFormat.id}\x1e${selectedFormat.pattern}\x1e${selectedFormat.builtinKey}\x1e${selectedFormat.parserType}`;
  }, [selectedFormat]);

  useEffect(() => {
    if (!formatPreviewResetKey) {
      setFormatPreviewInput("");
      setFormatPreviewResult(null);
      setFormatPreviewError(null);
      return;
    }
    const f = formatsListOrdered.find((x) => x.id === selectedFormatId);
    if (!f) return;
    setFormatPreviewInput(formatSampleLine(f));
    setFormatPreviewResult(null);
    setFormatPreviewError(null);
  }, [formatPreviewResetKey, formatsListOrdered, selectedFormatId]);

  useEffect(() => {
    if (tab !== "logs" || logsSubTab !== "formats" || !selectedFormat) {
      return;
    }
    const id = selectedFormat.id;
    const raw = formatPreviewInput;
    const t = window.setTimeout(() => {
      void (async () => {
        setFormatPreviewBusy(true);
        setFormatPreviewError(null);
        try {
          const r = (await PreviewLogParse(id, raw)) as LogParsePreviewResultDTO;
          setFormatPreviewResult(r);
        } catch (e: any) {
          setFormatPreviewError(e?.message ?? String(e));
          setFormatPreviewResult(null);
        } finally {
          setFormatPreviewBusy(false);
        }
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [tab, logsSubTab, selectedFormat, formatPreviewInput]);

  const closeFormatEditor = useCallback(() => {
    setEditor(emptyEditor);
    setEditorPreviewSample("");
    setEditorDraftPreview(null);
    setEditorDraftError(null);
    setEditorDraftBusy(false);
  }, []);

  useEffect(() => {
    if (!editor.open) {
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        if (!editor.pattern.trim()) {
          setEditorDraftPreview(null);
          setEditorDraftError(null);
          setEditorDraftBusy(false);
          return;
        }
        setEditorDraftBusy(true);
        setEditorDraftError(null);
        try {
          const req: LogParseDraftDTO = {
            pattern: editor.pattern,
            timeLayout: editor.timeLayout,
            captureGroupsJson: editor.captureGroupsJson,
            levelMappingJson: editor.levelMappingJson,
            raw: editorPreviewSample,
          };
          const r = (await PreviewLogParseDraft(req as any)) as LogParsePreviewResultDTO;
          setEditorDraftPreview(r);
        } catch (e: any) {
          setEditorDraftError(e?.message ?? String(e));
          setEditorDraftPreview(null);
        } finally {
          setEditorDraftBusy(false);
        }
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [
    editor.open,
    editor.pattern,
    editor.timeLayout,
    editor.captureGroupsJson,
    editor.levelMappingJson,
    editorPreviewSample,
  ]);

  const saveLogs = async () => {
    await SaveLogsSettings(logsSettings as any);
    setLogsSettingsDirty(false);
    await loadLogsSettings();
  };

  const openCreateFormat = () => {
    setLogsSubTab("formats");
    setEditorDraftPreview(null);
    setEditorDraftError(null);
    setEditorPreviewSample(CUSTOM_FORMAT_FALLBACK_SAMPLE);
    setEditor({ ...emptyEditor, open: true });
  };
  const openEditFormat = (f: LogFormatDTO) => {
    setEditorDraftPreview(null);
    setEditorDraftError(null);
    setEditorPreviewSample(formatSampleLine(f));
    setEditor({
      open: true,
      id: f.id,
      name: f.name,
      description: f.description,
      pattern: f.pattern,
      timeLayout: f.timeLayout,
      captureGroupsJson: f.captureGroupsJson || "{}",
      levelMappingJson: f.levelMappingJson || "{}",
    });
  };

  const saveFormat = async () => {
    await UpsertLogFormat({
      id: editor.id,
      name: editor.name,
      description: editor.description,
      parserType: "regex",
      pattern: editor.pattern,
      timeLayout: editor.timeLayout,
      captureGroupsJson: editor.captureGroupsJson,
      levelMappingJson: editor.levelMappingJson,
      enabled: true,
    } as any);
    closeFormatEditor();
    await loadLogsSettings();
  };

  return (
    <div className="settings-page panel">
      <div className="panel-titlebar">
        <div className="panel-title">Settings</div>
        <div className="panel-meta">
          <span className="muted">Global settings, privacy report, and log format configuration.</span>
        </div>
        <div className="panel-actions">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void refreshAllSettings()}
            disabled={settingsRefreshing}
            title="Reload macros, logs settings, privacy report, database sizes, and open sub-panels"
          >
            {settingsRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            <div className="settings-nav-group" role="presentation">
              <button
                type="button"
                role="tab"
                className={`settings-tab ${tab === "logs" && logsSubTab === "general" ? "active" : ""}`}
                aria-selected={tab === "logs" && logsSubTab === "general"}
                onClick={() => {
                  setTab("logs");
                  setLogsSubTab("general");
                }}
              >
                Logs
              </button>
              <button
                type="button"
                role="tab"
                className={`settings-tab-text ${tab === "logs" && logsSubTab === "formats" ? "active" : ""}`}
                aria-selected={tab === "logs" && logsSubTab === "formats"}
                onClick={() => {
                  setTab("logs");
                  setLogsSubTab("formats");
                }}
              >
                Formats
              </button>
            </div>
            <button
              type="button"
              role="tab"
              className={`settings-tab ${tab === "macros" ? "active" : ""}`}
              aria-selected={tab === "macros"}
              onClick={() => setTab("macros")}
            >
              Macros
            </button>
            <button
              type="button"
              role="tab"
              className={`settings-tab ${tab === "places" ? "active" : ""}`}
              aria-selected={tab === "places"}
              onClick={() => setTab("places")}
            >
              Places
            </button>
            <button
              type="button"
              role="tab"
              className={`settings-tab ${tab === "ai" ? "active" : ""}`}
              aria-selected={tab === "ai"}
              onClick={() => setTab("ai")}
            >
              AI Mode
            </button>
            <button
              type="button"
              role="tab"
              className={`settings-tab ${tab === "data" ? "active" : ""}`}
              aria-selected={tab === "data"}
              onClick={() => setTab("data")}
            >
              Data
            </button>
            <div className="settings-nav-group settings-nav-group--developer" role="presentation">
              <button
                type="button"
                role="tab"
                className={`settings-tab ${tab === "developer" ? "active" : ""}`}
                aria-selected={tab === "developer"}
                onClick={() => setTab("developer")}
              >
                Developer Mode
              </button>
              {tab === "developer" && developerModeEnabled ? (
                <button
                  type="button"
                  role="tab"
                  className={`settings-tab-text ${tab === "developer" ? "active" : ""}`}
                  aria-selected={tab === "developer"}
                  onClick={() => setTab("developer")}
                >
                  AI Logs
                </button>
              ) : null}
            </div>
            <div className="settings-nav-group settings-nav-group--privacy" role="presentation">
              <button
                type="button"
                role="tab"
                className={`settings-tab ${tab === "privacy" && privacySub === "home" ? "active" : ""}`}
                aria-selected={tab === "privacy" && privacySub === "home"}
                onClick={() => {
                  setTab("privacy");
                  setPrivacySub("home");
                }}
              >
                Privacy
              </button>
              {tab === "privacy" ? (
                <>
                  <button
                    type="button"
                    role="tab"
                    className={`settings-tab-text ${privacySub === "database" ? "active" : ""}`}
                    aria-selected={privacySub === "database"}
                    onClick={() => {
                      setTab("privacy");
                      setPrivacySub("database");
                    }}
                  >
                    Database
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`settings-tab-text ${privacySub === "profiles" ? "active" : ""}`}
                    aria-selected={privacySub === "profiles"}
                    onClick={() => {
                      setTab("privacy");
                      setPrivacySub("profiles");
                    }}
                  >
                    Profiles
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`settings-tab-text ${privacySub === "dialogs" ? "active" : ""}`}
                    aria-selected={privacySub === "dialogs"}
                    onClick={() => {
                      setTab("privacy");
                      setPrivacySub("dialogs");
                    }}
                  >
                    Dialogs
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`settings-tab-text ${privacySub === "maintenance" ? "active" : ""}`}
                    aria-selected={privacySub === "maintenance"}
                    onClick={() => {
                      setTab("privacy");
                      setPrivacySub("maintenance");
                    }}
                  >
                    Maintenance
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="settings-body">
          {tab === "places" ? <SettingsPlacesPanel profiles={profiles} /> : null}

          {tab === "data" ? <SettingsDataPanel profiles={profiles} /> : null}

          {tab === "ai" ? <AiModePanel onSettingsChanged={() => void loadAiModeGate()} /> : null}
          {tab === "developer" ? (
            <>
              <DeveloperModePanel onModeChanged={(enabled) => setDeveloperModeEnabled(enabled)} />
              {developerModeEnabled ? <DeveloperAiLogsPanel /> : null}
            </>
          ) : null}

          {tab === "privacy" ? (
            <div className="settings-section settings-privacy-root">
              {privacySub === "home" ? (
                <div className="settings-section">
                  {privacyError ? <div className="error-text">{privacyError}</div> : null}
                  <div className="settings-section-title" style={{ marginTop: 4 }}>
                    Record counts
                  </div>
                  <div className="settings-grid">
                    <SettingCard label="Profiles" value={String(report?.profileCount ?? 0)} />
                    <SettingCard label="Places" value={String(report?.placeCount ?? 0)} />
                    <SettingCard label="Macros" value={String(report?.macroCount ?? 0)} />
                    <SettingCard label="Secret refs" value={String(report?.secretRefCount ?? 0)} />
                    <SettingCard label="Vault items" value={String(report?.vaultItemCount ?? 0)} />
                    <SettingCard label="Dialogs" value={String(report?.aiConversationCount ?? 0)} />
                    <SettingCard label="Log sources" value={String(report?.logSourceCount ?? 0)} />
                    <SettingCard label="Log entries" value={String(report?.logEntryCount ?? 0)} />
                    <SettingCard label="Log formats" value={String(report?.logFormatCount ?? 0)} />
                    <SettingCard label="Data sources" value={String(report?.dataSourceCount ?? 0)} />
                  </div>
                </div>
              ) : null}

              {privacySub === "database" ? (
                <>
                  <div className="settings-section-title">Database</div>
                  {privacyError ? <div className="error-text">{privacyError}</div> : null}
                  <div className="settings-privacy-dbsource">
                    <div className="settings-privacy-dbsource-label" id="settings-privacy-db-label">
                      Database file
                    </div>
                    <div
                      className="settings-privacy-dbpath mono"
                      title={report?.dbPath ?? dbStorage?.dbPath ?? ""}
                      aria-labelledby="settings-privacy-db-label"
                    >
                      {report?.dbPath ?? dbStorage?.dbPath ?? "—"}
                    </div>
                  </div>
                  <div className="settings-grid" style={{ marginTop: 12 }}>
                    <SettingCard
                      label="Main file"
                      value={
                        dbStorage ? formatBytes(Number(dbStorage.fileBytes) || 0) : dbStorageBusy ? "…" : "—"
                      }
                    />
                    {dbStorage && Number(dbStorage.walBytes) > 0 ? (
                      <SettingCard label="WAL (-wal)" value={formatBytes(Number(dbStorage.walBytes) || 0)} />
                    ) : null}
                    {dbStorage && Number(dbStorage.shmBytes) > 0 ? (
                      <SettingCard label="Shared memory (-shm)" value={formatBytes(Number(dbStorage.shmBytes) || 0)} />
                    ) : null}
                  </div>
                  {(dbStorage?.tables?.length ?? 0) > 0 ? (
                    <>
                      <div className="settings-section-title" style={{ marginTop: 16 }}>
                        Tables
                      </div>
                      <p className="muted small">Row counts per SQLite table (<span className="mono">SELECT COUNT(*)</span>).</p>
                      <table className="settings-table">
                        <thead>
                          <tr>
                            <th>Table</th>
                            <th>Rows</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(dbStorage?.tables ?? []).map((row) => (
                            <tr key={row.tableName}>
                              <td className="mono">{row.tableName}</td>
                              <td className="mono">{String(row.rowCount ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : dbStorage && !dbStorageBusy ? (
                    <p className="muted small" style={{ marginTop: 12 }}>
                      No table list available.
                    </p>
                  ) : null}
                </>
              ) : null}

              {privacySub === "profiles" ? (
                <>
                  <div className="settings-section-title">Profiles</div>
                  {privacyError ? <div className="error-text">{privacyError}</div> : null}
                  {privacyDetailError ? <div className="error-text">{privacyDetailError}</div> : null}

              <div className="settings-places-topbar">
                <div className="settings-places-segments" role="tablist" aria-label="Privacy data scope">
                  {(["connection", "docker_local", "docker_remote"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      className={`settings-segment ${privacyScope === s ? "active" : ""}`}
                      aria-selected={privacyScope === s}
                      onClick={() => {
                        setPrivacyScope(s);
                        setPrivacyDockerLocalSelected(null);
                        setPrivacyRemotePick(null);
                        if (s !== "docker_remote") setPrivacyRemoteMasterProfileId(null);
                      }}
                    >
                      {s === "connection" ? "Connections" : s === "docker_local" ? "Docker local" : "Docker remote"}
                    </button>
                  ))}
                </div>
              </div>

              {privacyScope === "connection" ? (
              <div className="settings-master-detail">
                <div className="settings-master">
                  <ul className="settings-master-list">
                    {sortedProfiles.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={`settings-master-item ${privacySelectedProfileId === p.id ? "active" : ""}`}
                          onClick={() => setPrivacySelectedProfileId(p.id)}
                        >
                          {p.name?.trim() ? p.name : p.id}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="settings-detail">
                  {!privacySelectedProfileId ? (
                    <div className="muted">No profiles.</div>
                  ) : privacyDetailBusy ? (
                    <div className="muted">Loading…</div>
                  ) : !privacyDetail ? (
                    <div className="muted">Could not load details.</div>
                  ) : (
                    <>
                      <div className="settings-privacy-block">
                        <div className="settings-privacy-block-main">
                          <h4>Password</h4>
                          <p>
                            Storage: <span className="mono">{privacyDetail.passwordStorage || "none"}</span>
                            {privacyDetail.passwordSet ? " (credential stored)" : " (not set)"}
                          </p>
                        </div>
                        <div className="settings-privacy-block-actions">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={privacyActionBusy || !privacyDetail.passwordSet}
                            onClick={() =>
                              void runPrivacyAction(
                                "password",
                                "Remove the saved password for this connection? You can set it again later."
                              )
                            }
                          >
                            Clear password
                          </button>
                        </div>
                      </div>
                      <div className="settings-privacy-block">
                        <div className="settings-privacy-block-main">
                          <h4>Private key</h4>
                          <p>
                            Storage: <span className="mono">{privacyDetail.privateKeyStorage || "none"}</span>
                            {privacyDetail.privateKeySet ? " (reference or material stored)" : " (not set)"}
                          </p>
                        </div>
                        <div className="settings-privacy-block-actions">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={privacyActionBusy || !privacyDetail.privateKeySet}
                            onClick={() =>
                              void runPrivacyAction(
                                "privateKey",
                                "Remove the saved private key reference and any stored key material for this connection?"
                              )
                            }
                          >
                            Clear private key
                          </button>
                        </div>
                      </div>
                      <div className="settings-privacy-block">
                        <div className="settings-privacy-block-main">
                          <h4>Custom secrets</h4>
                          <p>
                            {privacyDetail.customSecrets?.length
                              ? `${privacyDetail.customSecrets.length} saved key(s). Values are not shown here.`
                              : "No custom secrets."}{" "}
                            Vault items (encrypted blobs) for this profile: {privacyDetail.vaultItemCount ?? 0}.
                          </p>
                          {privacyDetail.customSecrets?.length ? (
                            <ul className="settings-privacy-secret-list mono">
                              {privacyDetail.customSecrets.map((s) => (
                                <li key={s.key}>
                                  {s.key} <span className="muted">({s.storage})</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="settings-privacy-block-actions">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={privacyActionBusy || !(privacyDetail.customSecrets?.length > 0)}
                            onClick={() =>
                              void runPrivacyAction(
                                "customSecrets",
                                "Delete all custom secrets for this connection? This cannot be undone."
                              )
                            }
                          >
                            Delete all custom secrets
                          </button>
                        </div>
                      </div>
                      <div className="settings-privacy-block">
                        <div className="settings-privacy-block-main">
                          <h4>Logs (SSH profile sources)</h4>
                          <p>
                            Sources: {privacyDetail.logProfileSourceCount ?? 0}, imported entries: {privacyDetail.logEntryCount ?? 0}.
                            Last sync:{" "}
                            {privacyDetail.logLastSyncedUnixMs
                              ? new Date(privacyDetail.logLastSyncedUnixMs).toLocaleString()
                              : "never"}
                          </p>
                        </div>
                        <div className="settings-privacy-block-actions">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={privacyActionBusy || !(privacyDetail.logProfileSourceCount > 0)}
                            onClick={() =>
                              void runPrivacyAction(
                                "logs",
                                "Delete all log sources and imported log entries for this SSH connection? This cannot be undone."
                              )
                            }
                          >
                            Delete log data for this connection
                          </button>
                        </div>
                      </div>
                      <div className="settings-privacy-block">
                        <div className="settings-privacy-block-main">
                          <h4>Data tab (SQL sources)</h4>
                          <p>
                            {privacyDetail.dataSourceCount ?? 0} saved database source(s) reference this SSH connection in scope (direct SSH or Docker remote on this host).
                          </p>
                        </div>
                        <div className="settings-privacy-block-actions">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={privacyActionBusy || !((privacyDetail.dataSourceCount ?? 0) > 0)}
                            onClick={() => setPrivacyDeleteProfileDataSourcesOpen(true)}
                          >
                            Delete these sources…
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              ) : privacyScope === "docker_local" ? (
              <div className="settings-master-detail">
                <div className="settings-master">
                  {privacyDockerLocalErr ? <div className="error-text settings-master-note">{privacyDockerLocalErr}</div> : null}
                  {privacyDockerLocalBusy ? <div className="muted settings-master-note">Loading…</div> : null}
                  <ul className="settings-master-list">
                    {!privacyDockerLocalBusy && privacyDockerLocalBuckets.length === 0 ? (
                      <li className="muted settings-master-empty">No Docker local log sources stored.</li>
                    ) : null}
                    {sortedPrivacyDockerLocalBuckets.map((b) => (
                      <li key={b.containerName}>
                        <button
                          type="button"
                          className={`settings-master-item ${privacyDockerLocalSelected === b.containerName ? "active" : ""}`}
                          onClick={() => setPrivacyDockerLocalSelected(b.containerName)}
                        >
                          <span className="mono">{b.containerName}</span>
                          {b.orphaned ? (
                            <span className="muted settings-privacy-orphan-badge" title="No container with this name on the local Docker engine">
                              {" "}
                              removed
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="settings-detail">
                  {!privacyDockerLocalSelected ? (
                    <div className="muted">Select a container on the left.</div>
                  ) : (
                    (() => {
                      const b = privacyDockerLocalBuckets.find((x) => x.containerName === privacyDockerLocalSelected);
                      if (!b) return <div className="muted">No data for this container.</div>;
                      return (
                        <>
                          <div className="settings-privacy-block">
                            <div className="settings-privacy-block-main">
                              <h4>Docker local logs</h4>
                              <p>
                                Sources: {b.sourceCount}, imported entries: {b.entryCount}. Last sync:{" "}
                                {b.lastSyncedUnixMs ? new Date(b.lastSyncedUnixMs).toLocaleString() : "never"}
                              </p>
                              {b.orphaned ? (
                                <p className="muted">
                                  This container name is not on the local Docker engine anymore; only stored log data remains.
                                </p>
                              ) : null}
                              <p className="muted">
                                This is log data imported from the local Docker engine (Logs workspace). Saved Places for Docker are managed under Settings → Places.
                              </p>
                            </div>
                            <div className="settings-privacy-block-actions">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                disabled={privacyActionBusy}
                                onClick={() => void runDockerPrivacyPurgeLocal(b.containerName)}
                              >
                                Delete log data
                              </button>
                            </div>
                          </div>
                          <div className="settings-privacy-block">
                            <div className="settings-privacy-block-main">
                              <h4>All local Docker logs</h4>
                              <p className="muted">Remove every docker_local log source and imported entries on this machine.</p>
                            </div>
                            <div className="settings-privacy-block-actions">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                disabled={privacyActionBusy || privacyDockerLocalBuckets.length === 0}
                                onClick={() => void runDockerPrivacyPurgeLocal("")}
                              >
                                Purge all
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              </div>
              ) : (
              <div className="settings-master-detail">
                <div className="settings-master">
                  {privacyDockerRemoteErr ? <div className="error-text settings-master-note">{privacyDockerRemoteErr}</div> : null}
                  {privacyDockerRemoteOrphanErr ? (
                    <div className="error-text settings-master-note">{privacyDockerRemoteOrphanErr}</div>
                  ) : null}
                  <ul className="settings-places-remote-stack">
                    {sortedProfiles.length === 0 && privacyRemoteOrphanProfileIds.length === 0 ? (
                      <li className="muted settings-master-empty">No SSH connections.</li>
                    ) : null}
                    {sortedProfiles.map((p) => {
                      const activeProfile = privacyRemoteMasterProfileId === p.id;
                      const buckets = activeProfile ? privacyRemoteDetailBuckets : [];
                      return (
                        <li key={p.id} className="settings-places-remote-item">
                          <button
                            type="button"
                            className={`docker-profile settings-places-remote-profile ${activeProfile ? "active" : ""}`}
                            onClick={() => {
                              setPrivacyRemoteMasterProfileId(p.id);
                              setPrivacyRemotePick(null);
                            }}
                          >
                            <div>
                              <div className="docker-profile-name">{p.name?.trim() ? p.name : `${p.username}@${p.host}`}</div>
                              <div className="docker-profile-meta">SSH connection</div>
                            </div>
                          </button>
                          {activeProfile ? (
                            <div className="settings-places-remote-under">
                              {privacyDockerRemoteBusy ? <div className="muted">Loading…</div> : null}
                              {!privacyDockerRemoteBusy && buckets.length === 0 ? (
                                <div className="muted">No Docker remote log sources were saved for this connection.</div>
                              ) : null}
                              {buckets.map((b) => {
                                const activeC =
                                  privacyRemotePick?.profileId === p.id && privacyRemotePick?.containerName === b.containerName;
                                return (
                                  <div key={b.containerName} className={`docker-container ${activeC ? "active" : ""}`}>
                                    <button
                                      type="button"
                                      className="docker-container-row"
                                      onClick={() => setPrivacyRemotePick({ profileId: p.id, containerName: b.containerName })}
                                    >
                                      <div className="docker-container-info">
                                        <div className="docker-container-title">
                                          <span className="docker-container-name mono">{b.containerName}</span>
                                          {b.orphaned ? (
                                            <span
                                              className="muted settings-privacy-orphan-badge"
                                              title="No container with this name on the remote Docker host (last successful list)"
                                            >
                                              {" "}
                                              removed
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="docker-container-image">
                                          {b.sourceCount} source(s), {b.entryCount} entries
                                        </div>
                                      </div>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    {privacyRemoteOrphanProfileIds.map((k) => {
                      const activeProfile = privacyRemoteMasterProfileId === k;
                      const buckets = activeProfile ? privacyRemoteDetailBuckets : [];
                      return (
                        <li key={`orphan:${k}`} className="settings-places-remote-item">
                          <button
                            type="button"
                            className={`docker-profile settings-places-remote-profile ${activeProfile ? "active" : ""}`}
                            onClick={() => {
                              setPrivacyRemoteMasterProfileId(k);
                              setPrivacyRemotePick(null);
                            }}
                          >
                            <div>
                              <div className="docker-profile-name">Unknown profile</div>
                              <div className="docker-profile-meta mono">{k.length > 24 ? `${k.slice(0, 24)}…` : k}</div>
                            </div>
                          </button>
                          {activeProfile ? (
                            <div className="settings-places-remote-under">
                              {privacyDockerRemoteOrphanBusy ? <div className="muted">Loading…</div> : null}
                              {!privacyDockerRemoteOrphanBusy && buckets.length === 0 ? (
                                <div className="muted">No Docker remote log data for this removed connection.</div>
                              ) : null}
                              {buckets.map((b) => {
                                const activeC =
                                  privacyRemotePick?.profileId === k && privacyRemotePick?.containerName === b.containerName;
                                return (
                                  <div key={b.containerName} className={`docker-container ${activeC ? "active" : ""}`}>
                                    <button
                                      type="button"
                                      className="docker-container-row"
                                      onClick={() => setPrivacyRemotePick({ profileId: k, containerName: b.containerName })}
                                    >
                                      <div className="docker-container-info">
                                        <div className="docker-container-title">
                                          <span className="docker-container-name mono">{b.containerName}</span>
                                        </div>
                                        <div className="docker-container-image">
                                          {b.sourceCount} source(s), {b.entryCount} entries
                                        </div>
                                      </div>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="settings-detail">
                  {!privacyRemotePick ? (
                    <div className="muted">Select a connection and a container on the left.</div>
                  ) : (
                    (() => {
                      const b = privacyRemoteDetailBuckets.find((x) => x.containerName === privacyRemotePick.containerName);
                      if (!b) return <div className="muted">No data for this container.</div>;
                      const prof = profiles.find((x) => x.id === privacyRemotePick.profileId);
                      const pickOrphan = !profiles.some((x) => x.id === privacyRemotePick.profileId);
                      const connLabel = pickOrphan
                        ? `Unknown profile (${privacyRemotePick.profileId.length > 36 ? `${privacyRemotePick.profileId.slice(0, 36)}…` : privacyRemotePick.profileId})`
                        : prof?.name?.trim()
                          ? prof.name
                          : privacyRemotePick.profileId;
                      return (
                        <>
                          <div className="settings-privacy-block">
                            <div className="settings-privacy-block-main">
                              <h4>Docker remote logs</h4>
                              <p>
                                Connection: {connLabel}
                                <br />
                                Container key: <span className="mono">{b.containerName}</span>
                              </p>
                              <p>
                                Sources: {b.sourceCount}, imported entries: {b.entryCount}. Last sync:{" "}
                                {b.lastSyncedUnixMs ? new Date(b.lastSyncedUnixMs).toLocaleString() : "never"}
                              </p>
                              {pickOrphan ? (
                                <p className="muted">
                                  This SSH profile was removed from the app; only stored log data for this Docker key remains.
                                </p>
                              ) : null}
                              {b.orphaned ? (
                                <p className="muted">
                                  This container name was not found on the remote Docker host on the last successful list; only
                                  stored log data may remain.
                                </p>
                              ) : null}
                              <p className="muted">
                                Imported via Logs workspace on remote Docker. Places for this host are under Settings → Places.
                              </p>
                            </div>
                            <div className="settings-privacy-block-actions">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                disabled={privacyActionBusy}
                                onClick={() => void runDockerPrivacyPurgeRemote(privacyRemotePick.profileId, b.containerName)}
                              >
                                Delete log data
                              </button>
                            </div>
                          </div>
                          <div className="settings-privacy-block">
                            <div className="settings-privacy-block-main">
                              <h4>All containers on this connection</h4>
                              <p className="muted">
                                {pickOrphan
                                  ? "Remove every docker_remote log source and entries still keyed to this removed profile id."
                                  : "Remove every docker_remote log source and entries for this SSH profile."}
                              </p>
                            </div>
                            <div className="settings-privacy-block-actions">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                disabled={privacyActionBusy || privacyRemoteDetailBuckets.length === 0}
                                onClick={() => void runDockerPrivacyPurgeRemote(privacyRemotePick.profileId, "")}
                              >
                                Purge all remote
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              </div>
              )}

                </>
              ) : null}

              {privacySub === "dialogs" ? (
                <>
                  <div className="settings-section-title">AI dialogs</div>
                  <p className="muted small">Stored locally in the app database. Delete to remove message history.</p>
                  {aiPrivacyBusy ? <div className="muted">Loading…</div> : null}
                  <table className="settings-table ai-privacy-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Updated</th>
                        <th>Size</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {aiPrivacyList.map((c) => (
                        <tr key={c.id}>
                          <td>{c.title || "(untitled)"}</td>
                          <td className="mono">{c.updatedAt?.slice(0, 19).replace("T", " ") ?? "—"}</td>
                          <td className="mono">{c.byteSize} B</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={async () => {
                                await DeleteAiConversation(c.id);
                                setAiPrivacyList(await ListAiConversations());
                                void loadDbStorage();
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}

              {privacySub === "maintenance" ? (
                <>
                  {privacyMaintenanceErr ? <div className="error-text">{privacyMaintenanceErr}</div> : null}
                  <div className="settings-privacy-maintenance">
                    <div className="settings-privacy-maintenance-head">Maintenance</div>
                    <p className="muted settings-privacy-maintenance-desc">
                      Bulk actions that affect the whole app or database. Use Profiles for targeted cleanup per connection or
                      container.
                    </p>
                    <div className="settings-privacy-maintenance-actions">
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={privacyMaintenanceBusy}
                        onClick={() => setPrivacyMaintenanceConfirm("layout")}
                      >
                        Clear UI layout
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={privacyMaintenanceBusy}
                        onClick={() => setPrivacyMaintenanceConfirm("logs")}
                      >
                        Purge all logs
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={privacyMaintenanceBusy}
                        onClick={() => setPrivacyMaintenanceConfirm("secrets")}
                      >
                        Purge Secrets dialog entries
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={privacyMaintenanceBusy || !(Number(report?.dataSourceCount ?? 0) > 0)}
                        onClick={() => setPrivacyDeleteAllDataSourcesOpen(true)}
                        title={
                          Number(report?.dataSourceCount ?? 0) > 0
                            ? "Remove all saved Data tab connection profiles and stored DB passwords"
                            : "No saved Data sources"
                        }
                      >
                        Delete all Data sources
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "logs" ? (
          <div className="settings-section settings-logs">
            {logsSubTab === "general" ? (
              <div className="settings-logs-general">
                <div className="settings-toolbar">
                  <button className="btn" type="button" onClick={() => void saveLogs()} disabled={!logsSettingsDirty}>
                    Save Defaults
                  </button>
                </div>
                {formatsError ? <div className="error-text">{formatsError}</div> : null}
                <div className="settings-form-grid settings-logs-general-grid">
                  <label className="settings-field">
                    <span className="settings-field-label" id="logs-max-file-bytes-label">
                      Large file warning threshold (bytes)
                    </span>
                    <input
                      id="logs-max-file-bytes"
                      className="settings-field-input"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-labelledby="logs-max-file-bytes-label"
                      value={String(logsSettings.maxFileBytes)}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setLogsSettings((prev) => ({ ...prev, maxFileBytes: Number.isFinite(n) && n >= 0 ? n : 0 }));
                        setLogsSettingsDirty(true);
                      }}
                    />
                    <p className="settings-field-hint">
                      The user is warned about file size when the file is larger than this limit.
                    </p>
                  </label>
                  <label className="settings-field">
                    <span className="settings-field-label" id="logs-retention-label">
                      Default retention (days)
                    </span>
                    <input
                      id="logs-retention-days"
                      className="settings-field-input"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-labelledby="logs-retention-label"
                      value={String(logsSettings.defaultRetentionDays)}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setLogsSettings((prev) => ({
                          ...prev,
                          defaultRetentionDays: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0,
                        }));
                        setLogsSettingsDirty(true);
                      }}
                    />
                    <p className="settings-field-hint">
                      During sync, entries older than this many days are removed.
                    </p>
                  </label>
                  <label className="settings-field settings-field--full">
                    <span className="settings-field-label" id="logs-redaction-label">
                      Redaction regex rules, one per line
                    </span>
                    <textarea
                      id="logs-redaction"
                      className="settings-field-textarea mono"
                      rows={5}
                      aria-labelledby="logs-redaction-label"
                      spellCheck={false}
                      value={(logsSettings.redactionPatterns ?? []).join("\n")}
                      onChange={(e) => {
                        setLogsSettings((prev) => ({
                          ...prev,
                          redactionPatterns: e.target.value
                            .split("\n")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        }));
                        setLogsSettingsDirty(true);
                      }}
                    />
                    <p className="settings-field-hint">
                      One regex per line; matches are replaced with <code className="mono">[REDACTED]</code> on import. Invalid lines are skipped.
                    </p>
                  </label>
                </div>
              </div>
            ) : (
              <>
                {formatsError ? <div className="error-text">{formatsError}</div> : null}
                <div className="settings-formats-split">
                  <div className="settings-formats-column">
                    <input
                      type="search"
                      className="settings-formats-search"
                      placeholder="Search formats…"
                      value={formatsSearchQuery}
                      onChange={(e) => setFormatsSearchQuery(e.target.value)}
                      aria-label="Search formats"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="settings-formats-list">
                      {formatsListOrdered.length === 0 ? <div className="empty">No formats.</div> : null}
                      {formatsListOrdered.length > 0 &&
                      formatsListByKind.length === 0 &&
                      !formatsShowSystem &&
                      !formatsShowCustom ? (
                        <div className="empty">Enable System or Custom to show formats in the list.</div>
                      ) : null}
                      {formatsListOrdered.length > 0 &&
                      formatsListByKind.length === 0 &&
                      (formatsShowSystem || formatsShowCustom) ? (
                        <div className="empty">No matching formats found.</div>
                      ) : null}
                      {formatsListOrdered.length > 0 && formatsListByKind.length > 0 && formatsListFiltered.length === 0 ? (
                        <div className="empty">No formats match your search.</div>
                      ) : null}
                      {formatsListFiltered.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={`settings-format-item ${selectedFormatId === f.id ? "active" : ""}`}
                          onClick={() => setSelectedFormatId(f.id)}
                        >
                          <div className="settings-format-item-title">
                            <span className="settings-format-item-name">{f.name}</span>
                            {f.isSystem ? <span className="badge settings-format-system-badge">system</span> : null}
                          </div>
                          <div className="settings-format-item-sub muted">{f.builtinKey || (f.parserType === "regex" ? "custom regex" : f.parserType)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-formats-preview">
                    <div className="settings-formats-preview-toolbar">
                      <div className="settings-formats-type-filters" role="group" aria-label="Format type filters">
                        <button
                          type="button"
                          className={`settings-format-filter ${formatsShowSystem ? "settings-format-filter--on" : ""}`}
                          aria-pressed={formatsShowSystem}
                          onClick={() => setFormatsShowSystem((v) => !v)}
                        >
                          <span className="settings-format-filter-label">System</span>
                          <span className="settings-format-filter-count">{systemFormats.length}</span>
                        </button>
                        <button
                          type="button"
                          className={`settings-format-filter ${formatsShowCustom ? "settings-format-filter--on" : ""}`}
                          aria-pressed={formatsShowCustom}
                          onClick={() => setFormatsShowCustom((v) => !v)}
                        >
                          <span className="settings-format-filter-label">Custom</span>
                          <span className="settings-format-filter-count">{customFormats.length}</span>
                        </button>
                      </div>
                      <div className="settings-formats-preview-toolbar-actions">
                        <button className="btn" type="button" onClick={openCreateFormat}>
                          + Custom Format
                        </button>
                      </div>
                    </div>
                    <div className="settings-formats-preview-body">
                    {selectedFormat ? (
                      <>
                        <div className="settings-formats-preview-title">{selectedFormat.name}</div>
                        <p className="settings-formats-preview-desc">{selectedFormat.description || "—"}</p>
                        {selectedFormat.pattern ? (
                          <div className="settings-formats-preview-block">
                            <div className="settings-subtitle settings-subtitle-flush">Pattern</div>
                            <pre className="settings-formats-sample">{selectedFormat.pattern}</pre>
                          </div>
                        ) : null}
                        {selectedFormat.timeLayout ? (
                          <div className="muted settings-formats-meta">
                            Time layout: <span className="mono">{selectedFormat.timeLayout}</span>
                          </div>
                        ) : null}
                        <div className="settings-subtitle">Sample log (edit to test parser)</div>
                        <textarea
                          className="settings-formats-sample settings-formats-sample-input"
                          rows={6}
                          spellCheck={false}
                          value={formatPreviewInput}
                          onChange={(e) => setFormatPreviewInput(e.target.value)}
                          aria-label="Log sample for parse preview"
                        />
                        {formatPreviewBusy ? <div className="muted settings-formats-preview-hint">Parsing…</div> : null}
                        {formatPreviewError ? <div className="error-text">{formatPreviewError}</div> : null}
                        {formatPreviewResult?.compileError ? (
                          <div className="error-text">Regex compile error: {formatPreviewResult.compileError}</div>
                        ) : null}
                        {formatPreviewResult && !formatPreviewResult.compileError ? (
                          <div className="settings-formats-parse-out">
                            <div className="settings-subtitle settings-subtitle-flush">Parse result</div>
                            {formatPreviewResult.records.length === 0 ? (
                              <div className="muted">No log records after split (empty input or only blank lines).</div>
                            ) : (
                              formatPreviewResult.records.map((rec, i) => (
                                <div key={i} className="settings-formats-parse-record">
                                  <div className="settings-formats-parse-record-head">
                                    <span className={`badge ${rec.matched ? "badge-connected" : "badge-disconnected"}`}>
                                      {rec.matched ? "Match" : "No match"}
                                    </span>
                                    <span className="muted mono settings-formats-parse-route">{rec.route}</span>
                                  </div>
                                  <pre className="settings-formats-sample settings-formats-parse-json">
                                    {JSON.stringify(previewStructuredBlock(rec), null, 2)}
                                  </pre>
                                </div>
                              ))
                            )}
                          </div>
                        ) : null}
                        {!selectedFormat.isSystem ? (
                          <div className="settings-toolbar settings-formats-actions">
                            <button className="btn btn-ghost" type="button" onClick={() => openEditFormat(selectedFormat)}>
                              Edit
                            </button>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={async () => {
                                await DeleteLogFormat(selectedFormat.id);
                                await loadLogsSettings();
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="muted">Select a format.</div>
                    )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          ) : null}

          {tab === "macros" ? (
          <div className="settings-section">
            <div className="settings-toolbar">
              <button className="btn" type="button" onClick={onCreateMacro}>
                + Macro
              </button>
            </div>
            {macrosError ? <div className="error-text">{macrosError}</div> : null}
            <div className="settings-list">
              {macros.length === 0 ? <div className="empty">No macros yet.</div> : null}
              {macros.map((m) => (
                <div key={m.id} className="settings-row">
                  <div className="settings-row-main">
                    <div className="settings-row-title">{m.name}</div>
                    <div className="settings-row-sub mono">{(m.tags ?? []).join(", ") || "No tags"}</div>
                  </div>
                  <div className="settings-row-actions">
                    <button className="btn btn-ghost" type="button" onClick={() => onEditMacro(m)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={async () => {
                        await UpsertMacro({ ...m, id: "", name: `${m.name} copy` } as any);
                        await loadMacros();
                      }}
                    >
                      Clone
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={async () => {
                        await DeleteMacro(m.id);
                        await loadMacros();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          ) : null}
        </div>
      </div>

      {privacyDeleteAllDataSourcesOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Delete all Data sources?</div>
            <div className="modal-body">
              <p>
                Remove every saved Data tab connection ({report?.dataSourceCount ?? 0} record
                {(report?.dataSourceCount ?? 0) === 1 ? "" : "s"}) and clear stored database passwords from the keyring / vault.
              </p>
              <p className="muted">Active Data sessions are not closed automatically; disconnect them from the Data tab if needed.</p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={privacyActionBusy}
                onClick={() => setPrivacyDeleteAllDataSourcesOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={privacyActionBusy} onClick={() => void runPrivacyDeleteAllDataSources()}>
                {privacyActionBusy ? "Please wait…" : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {privacyDeleteProfileDataSourcesOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Delete Data sources for this connection?</div>
            <div className="modal-body">
              <p>
                Remove {privacyDetail?.dataSourceCount ?? 0} saved Data tab source
                {(privacyDetail?.dataSourceCount ?? 0) === 1 ? "" : "s"} scoped to this SSH profile (including Docker remote sources that use this host).
              </p>
              <p className="muted">This cannot be undone.</p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={privacyActionBusy}
                onClick={() => setPrivacyDeleteProfileDataSourcesOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={privacyActionBusy}
                onClick={() => void runPrivacyDeleteDataSourcesForProfile()}
              >
                {privacyActionBusy ? "Please wait…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {privacyMaintenanceConfirm ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-maintenance-confirm-title"
          onClick={() => {
            if (!privacyMaintenanceBusy) setPrivacyMaintenanceConfirm(null);
          }}
        >
          <div className="modal modal-maintenance-danger" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" id="settings-maintenance-confirm-title">
              {privacyMaintenanceConfirm === "layout"
                ? "Clear UI layout?"
                : privacyMaintenanceConfirm === "logs"
                  ? "Purge all logs?"
                  : "Purge Secrets dialog entries?"}
            </div>
            <div className="modal-body">
              {privacyMaintenanceConfirm === "layout" ? (
                <p>
                  This removes every saved dashboard and panel layout. Positions and sizes of tiles and panels (stored locally in the database) reset to defaults.
                </p>
              ) : privacyMaintenanceConfirm === "logs" ? (
                <p>
                  Delete all imported log entries for every log source. Log sources and formats stay; only ingested entries are removed. This cannot be undone.
                </p>
              ) : (
                <p>
                  Remove every custom secret saved from the per-connection Secrets dialog (keyring / internal vault entries tied to those keys). SSH passwords, private keys, AI
                  keys, and Data tab database passwords are not changed. This cannot be undone.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={privacyMaintenanceBusy}
                onClick={() => setPrivacyMaintenanceConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={privacyMaintenanceBusy}
                onClick={() => void executePrivacyMaintenance(privacyMaintenanceConfirm)}
              >
                {privacyMaintenanceBusy ? "Please wait…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editor.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal modal-format-editor">
            <div className="modal-title">{editor.id ? "Edit custom format" : "New custom format"}</div>
            <div className="modal-body form modal-format-editor-body">
              <div className="modal-format-editor-grid">
                <div className="modal-format-editor-col modal-format-editor-col--form">
                  <div className="row">
                    <label>Name</label>
                    <input value={editor.name} onChange={(e) => setEditor((prev) => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="row">
                    <label>Description</label>
                    <input value={editor.description} onChange={(e) => setEditor((prev) => ({ ...prev, description: e.target.value }))} />
                  </div>
                  <div className="row">
                    <label>Regex pattern</label>
                    <textarea rows={4} className="mono" value={editor.pattern} onChange={(e) => setEditor((prev) => ({ ...prev, pattern: e.target.value }))} />
                  </div>
                  <div className="row">
                    <label>Time layout</label>
                    <input
                      className="mono"
                      value={editor.timeLayout}
                      onChange={(e) => setEditor((prev) => ({ ...prev, timeLayout: e.target.value }))}
                      placeholder="2006-01-02 15:04:05"
                    />
                  </div>
                  <div className="row">
                    <label>Capture groups JSON</label>
                    <textarea rows={5} className="mono" value={editor.captureGroupsJson} onChange={(e) => setEditor((prev) => ({ ...prev, captureGroupsJson: e.target.value }))} />
                  </div>
                  <div className="row">
                    <label>Level mapping JSON</label>
                    <textarea rows={4} className="mono" value={editor.levelMappingJson} onChange={(e) => setEditor((prev) => ({ ...prev, levelMappingJson: e.target.value }))} />
                    <p className="modal-format-editor-hint">
                      Maps the text captured in the <strong>level</strong> group to a stored severity. Keys must match the captured substring exactly; if there is no
                      entry, a lowercase key is tried. Values should be one of: <code className="mono">error</code>, <code className="mono">warn</code>,{" "}
                      <code className="mono">info</code>, <code className="mono">success</code> (other words are normalized when possible). Example:{" "}
                      <code className="mono">{`{"ERR":"error","WARNING":"warn"}`}</code>. Use <code className="mono">{"{}"}</code> to skip mapping and use automatic
                      normalization from the captured level text only.
                    </p>
                  </div>
                </div>
                <div className="modal-format-editor-col modal-format-editor-col--preview">
                  <div className="modal-format-editor-preview-head">Sample log line</div>
                  <textarea
                    className="mono modal-format-editor-sample"
                    rows={8}
                    spellCheck={false}
                    value={editorPreviewSample}
                    onChange={(e) => setEditorPreviewSample(e.target.value)}
                    aria-label="Sample log text for parse preview"
                  />
                  {editorDraftError ? <div className="error-text">{editorDraftError}</div> : null}
                  <div className="modal-format-editor-parse">
                    <div className="modal-format-editor-preview-head">Parse preview</div>
                    {!editor.pattern.trim() ? (
                      <div className="muted">Enter a regex pattern to see a preview.</div>
                    ) : editorDraftBusy ? (
                      <div className="muted">Parsing…</div>
                    ) : editorDraftPreview?.compileError ? (
                      <div className="error-text">Regex: {editorDraftPreview.compileError}</div>
                    ) : editorDraftPreview && editorDraftPreview.records.length === 0 ? (
                      <div className="muted">No records (empty sample or only blank lines).</div>
                    ) : editorDraftPreview ? (
                      editorDraftPreview.records.map((rec, i) => (
                        <div key={i} className="modal-format-editor-parse-record">
                          <div className="settings-formats-parse-record-head">
                            <span className={`badge ${rec.matched ? "badge-connected" : "badge-disconnected"}`}>
                              {rec.matched ? "Match" : "No match"}
                            </span>
                            <span className="muted mono settings-formats-parse-route">{rec.route}</span>
                          </div>
                          <pre className="settings-formats-sample settings-formats-parse-json">{JSON.stringify(previewStructuredBlock(rec), null, 2)}</pre>
                        </div>
                      ))
                    ) : (
                      <div className="muted">—</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={closeFormatEditor}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void saveFormat()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="settings-card">
      <div className="settings-card-label">{label}</div>
      <div className={`settings-card-value ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}
