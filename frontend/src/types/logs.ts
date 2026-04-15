export type LogFormatDTO = {
  id: string;
  name: string;
  description: string;
  builtinKey: string;
  parserType: string;
  pattern: string;
  timeLayout: string;
  captureGroupsJson: string;
  levelMappingJson: string;
  isSystem: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LogSourceDTO = {
  id: string;
  kind: "profile" | "docker_local" | "docker_remote";
  profileId: string;
  containerName: string;
  path: string;
  formatId: string;
  displayName: string;
  optionsJson: string;
  lastError: string;
  lastSyncedAt?: string;
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type LogEntryDTO = {
  id: string;
  sourceId: string;
  kind: string;
  profileId: string;
  containerName: string;
  sourcePath: string;
  timestampUnixMs: number;
  ingestedUnixMs: number;
  timestampSource: string;
  level: "error" | "warn" | "info" | "success" | "unknown";
  levelSource: "parsed" | "guessed" | "unknown";
  message: string;
  rawText: string;
};

export type LogsQueryResultDTO = {
  entries: LogEntryDTO[];
  total: number;
  levels: string[];
  sourcePaths: string[];
};

export type LogsSettingsDTO = {
  maxFileBytes: number;
  defaultRetentionDays: number;
  redactionPatterns: string[];
};

export type SettingsPrivacyReportDTO = {
  dbPath: string;
  profileCount: number;
  placeCount: number;
  macroCount: number;
  secretRefCount: number;
  vaultItemCount: number;
  aiConversationCount: number;
  logSourceCount: number;
  logEntryCount: number;
  logFormatCount: number;
  dataSourceCount: number;
};

export type SettingsDatabaseTableStatDTO = {
  tableName: string;
  rowCount: number;
};

export type SettingsDatabaseStorageDTO = {
  dbPath: string;
  fileBytes: number;
  walBytes: number;
  shmBytes: number;
  tables: SettingsDatabaseTableStatDTO[];
};

export type LogsSyncResultDTO = {
  sourceId: string;
  importedCount: number;
  skippedCount: number;
  bytesRead: number;
  largeFile: boolean;
  needsConfirm: boolean;
  warning?: string;
};

export type LogParsePreviewRecordDTO = {
  matched: boolean;
  route: string;
  timestampUnixMs: number;
  timestampSource: string;
  level: string;
  levelSource: string;
  message: string;
  rawText: string;
  metaJson: string;
};

export type LogParsePreviewResultDTO = {
  compileError?: string;
  records: LogParsePreviewRecordDTO[];
};

export type LogParseDraftDTO = {
  pattern: string;
  timeLayout: string;
  captureGroupsJson: string;
  levelMappingJson: string;
  raw: string;
};
