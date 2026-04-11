package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"daimon/internal/storage"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gorm.io/gorm"
)

const logsSettingsKey = "logs:settings"

const (
	logFormatGenericPlain = "builtin:generic_plain"
	logFormatSyslog       = "builtin:syslog"
	logFormatNginxAccess  = "builtin:nginx_access"
	logFormatNginxError   = "builtin:nginx_error"
	logFormatPHPErr       = "builtin:php_error"
	logFormatPHPFPM       = "builtin:php_fpm"
)

type LogsSettingsDTO struct {
	MaxFileBytes         int64    `json:"maxFileBytes"`
	DefaultRetentionDays int      `json:"defaultRetentionDays"`
	RedactionPatterns    []string `json:"redactionPatterns"`
}

type SettingsPrivacyReportDTO struct {
	DBPath              string `json:"dbPath"`
	ProfileCount        int64  `json:"profileCount"`
	PlaceCount          int64  `json:"placeCount"`
	MacroCount          int64  `json:"macroCount"`
	SecretRefCount      int64  `json:"secretRefCount"`
	VaultItemCount      int64  `json:"vaultItemCount"`
	AiConversationCount int64  `json:"aiConversationCount"`
	LogSourceCount      int64  `json:"logSourceCount"`
	LogEntryCount       int64  `json:"logEntryCount"`
	LogFormatCount      int64  `json:"logFormatCount"`
}

// SettingsDatabaseTableStatDTO is one user table and its row count (SELECT COUNT(*)).
type SettingsDatabaseTableStatDTO struct {
	TableName string `json:"tableName"`
	RowCount  int64  `json:"rowCount"`
}

// SettingsDatabaseStorageDTO summarizes database file size (and WAL/SHM if present) plus per-table row counts.
type SettingsDatabaseStorageDTO struct {
	DbPath    string                         `json:"dbPath"`
	FileBytes int64                          `json:"fileBytes"`
	WalBytes  int64                          `json:"walBytes"`
	ShmBytes  int64                          `json:"shmBytes"`
	Tables    []SettingsDatabaseTableStatDTO `json:"tables"`
}

type LogFormatDTO struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	BuiltinKey        string `json:"builtinKey"`
	ParserType        string `json:"parserType"`
	Pattern           string `json:"pattern"`
	TimeLayout        string `json:"timeLayout"`
	CaptureGroupsJSON string `json:"captureGroupsJson"`
	LevelMappingJSON  string `json:"levelMappingJson"`
	IsSystem          bool   `json:"isSystem"`
	Enabled           bool   `json:"enabled"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

type UpsertLogFormatRequest struct {
	ID                string `json:"id,omitempty"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	ParserType        string `json:"parserType"`
	Pattern           string `json:"pattern"`
	TimeLayout        string `json:"timeLayout"`
	CaptureGroupsJSON string `json:"captureGroupsJson"`
	LevelMappingJSON  string `json:"levelMappingJson"`
	Enabled           bool   `json:"enabled"`
}

type LogSourceDTO struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	ProfileID     string `json:"profileId"`
	ContainerName string `json:"containerName"`
	Path          string `json:"path"`
	FormatID      string `json:"formatId"`
	DisplayName   string `json:"displayName"`
	OptionsJSON   string `json:"optionsJson"`
	LastError     string `json:"lastError"`
	LastSyncedAt  string `json:"lastSyncedAt,omitempty"`
	Enabled       bool   `json:"enabled"`
	Order         int    `json:"order"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type ListLogSourcesRequest struct {
	Kind          string `json:"kind"`
	ProfileID     string `json:"profileId"`
	ContainerName string `json:"containerName"`
}

type UpsertLogSourceRequest struct {
	ID            string `json:"id,omitempty"`
	Kind          string `json:"kind"`
	ProfileID     string `json:"profileId"`
	ContainerName string `json:"containerName"`
	Path          string `json:"path"`
	FormatID      string `json:"formatId"`
	DisplayName   string `json:"displayName"`
	OptionsJSON   string `json:"optionsJson"`
	Enabled       bool   `json:"enabled"`
	Order         int    `json:"order"`
}

type LogEntryDTO struct {
	ID              string `json:"id"`
	SourceID        string `json:"sourceId"`
	Kind            string `json:"kind"`
	ProfileID       string `json:"profileId"`
	ContainerName   string `json:"containerName"`
	SourcePath      string `json:"sourcePath"`
	TimestampUnixMs int64  `json:"timestampUnixMs"`
	IngestedUnixMs  int64  `json:"ingestedUnixMs"`
	TimestampSource string `json:"timestampSource"`
	Level           string `json:"level"`
	LevelSource     string `json:"levelSource"`
	Message         string `json:"message"`
	RawText         string `json:"rawText"`
}

type LogsQueryRequest struct {
	Kind          string   `json:"kind"`
	ProfileID     string   `json:"profileId"`
	ContainerName string   `json:"containerName"`
	SourceID      string   `json:"sourceId"`
	Search        string   `json:"search"`
	Levels        []string `json:"levels"`
	FromUnixMs    int64    `json:"fromUnixMs"`
	ToUnixMs      int64    `json:"toUnixMs"`
	Ascending     bool     `json:"ascending"`
	Limit         int      `json:"limit"`
	Offset        int      `json:"offset"`
}

type LogsQueryResultDTO struct {
	Entries     []LogEntryDTO `json:"entries"`
	Total       int64         `json:"total"`
	Levels      []string      `json:"levels"`
	SourcePaths []string      `json:"sourcePaths"`
}

type LogsSyncRequest struct {
	SourceID   string `json:"sourceId"`
	ForceLarge bool   `json:"forceLarge"`
}

type LogsSyncResultDTO struct {
	SourceID      string `json:"sourceId"`
	ImportedCount int    `json:"importedCount"`
	SkippedCount  int    `json:"skippedCount"`
	BytesRead     int64  `json:"bytesRead"`
	LargeFile     bool   `json:"largeFile"`
	NeedsConfirm  bool   `json:"needsConfirm"`
	Warning       string `json:"warning,omitempty"`
}

type LogsPurgeRequest struct {
	Kind          string `json:"kind"`
	ProfileID     string `json:"profileId"`
	ContainerName string `json:"containerName"`
	SourceID      string `json:"sourceId"`
	BeforeUnixMs  int64  `json:"beforeUnixMs"`
}

type LogsSyncEvent struct {
	SourceID      string `json:"sourceId"`
	State         string `json:"state"` // running | success | failed | warning
	Message       string `json:"message,omitempty"`
	ImportedCount int    `json:"importedCount,omitempty"`
	SkippedCount  int    `json:"skippedCount,omitempty"`
	BytesRead     int64  `json:"bytesRead,omitempty"`
}

type parsedLogEntry struct {
	TimestampUnixMs int64
	TimestampSource string
	Level           string
	LevelSource     string
	Message         string
	RawText         string
	MetaJSON        string
}

// recordParseResult is the outcome of parsing a single logical log record (used for ingest + preview).
type recordParseResult struct {
	Entry   parsedLogEntry
	Matched bool
	Route   string
}

// LogParsePreviewRecordDTO is one parsed record in the Settings preview UI.
type LogParsePreviewRecordDTO struct {
	Matched         bool   `json:"matched"`
	Route           string `json:"route"`
	TimestampUnixMs int64  `json:"timestampUnixMs"`
	TimestampSource string `json:"timestampSource"`
	Level           string `json:"level"`
	LevelSource     string `json:"levelSource"`
	Message         string `json:"message"`
	RawText         string `json:"rawText"`
	MetaJSON        string `json:"metaJson"`
}

// LogParsePreviewResultDTO is returned by PreviewLogParse (no persistence; optional compile error for custom regex).
type LogParsePreviewResultDTO struct {
	CompileError string                     `json:"compileError,omitempty"`
	Records      []LogParsePreviewRecordDTO `json:"records"`
}

func seedDefaultLogFormats(db *gorm.DB) error {
	if db == nil {
		return nil
	}
	formats := []storage.LogFormat{
		{
			ID:          logFormatGenericPlain,
			Name:        "Generic plain text",
			Description: "Generic log parser with timestamp guess, severity guess, and lightweight multiline merge.",
			BuiltinKey:  "generic_plain_with_timestamp_guess",
			ParserType:  "builtin",
			IsSystem:    true,
			Enabled:     true,
		},
		{
			ID:          logFormatSyslog,
			Name:        "Syslog",
			Description: "Classic syslog format like `Jan 10 12:34:56 host sshd[123]: message`.",
			BuiltinKey:  "syslog",
			ParserType:  "builtin",
			IsSystem:    true,
			Enabled:     true,
		},
		{
			ID:          logFormatNginxAccess,
			Name:        "Nginx access",
			Description: "Nginx combined access log.",
			BuiltinKey:  "nginx_access",
			ParserType:  "builtin",
			IsSystem:    true,
			Enabled:     true,
		},
		{
			ID:          logFormatNginxError,
			Name:        "Nginx error",
			Description: "Nginx error log.",
			BuiltinKey:  "nginx_error",
			ParserType:  "builtin",
			IsSystem:    true,
			Enabled:     true,
		},
		{
			ID:          logFormatPHPErr,
			Name:        "PHP error",
			Description: "PHP error log with bracketed timestamp and PHP severity.",
			BuiltinKey:  "php_error",
			ParserType:  "builtin",
			IsSystem:    true,
			Enabled:     true,
		},
		{
			ID:          logFormatPHPFPM,
			Name:        "PHP-FPM",
			Description: "PHP-FPM process manager log.",
			BuiltinKey:  "php_fpm",
			ParserType:  "builtin",
			IsSystem:    true,
			Enabled:     true,
		},
	}
	for _, f := range formats {
		var existing storage.LogFormat
		err := db.First(&existing, "builtin_key = ?", f.BuiltinKey).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := db.Create(&f).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		existing.Name = f.Name
		existing.Description = f.Description
		existing.ParserType = f.ParserType
		existing.IsSystem = true
		existing.Enabled = true
		if err := db.Save(&existing).Error; err != nil {
			return err
		}
	}
	return nil
}

func defaultLogsSettings() LogsSettingsDTO {
	return LogsSettingsDTO{
		MaxFileBytes:         20 * 1024 * 1024,
		DefaultRetentionDays: 30,
		RedactionPatterns:    []string{},
	}
}

func (a *App) SettingsPrivacyReport() (SettingsPrivacyReportDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return SettingsPrivacyReportDTO{}, errors.New("db not ready")
	}
	var out SettingsPrivacyReportDTO
	out.DBPath = a.db.Path()
	_ = a.db.DB.Model(&storage.Profile{}).Count(&out.ProfileCount).Error
	_ = a.db.DB.Model(&storage.Place{}).Count(&out.PlaceCount).Error
	_ = a.db.DB.Model(&storage.Macro{}).Count(&out.MacroCount).Error
	_ = a.db.DB.Model(&storage.SecretRef{}).Count(&out.SecretRefCount).Error
	_ = a.db.DB.Model(&storage.VaultItem{}).Count(&out.VaultItemCount).Error
	_ = a.db.DB.Model(&storage.AiConversation{}).Count(&out.AiConversationCount).Error
	_ = a.db.DB.Model(&storage.LogSource{}).Count(&out.LogSourceCount).Error
	_ = a.db.DB.Model(&storage.LogEntry{}).Count(&out.LogEntryCount).Error
	_ = a.db.DB.Model(&storage.LogFormat{}).Count(&out.LogFormatCount).Error
	return out, nil
}

func statFileBytes(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

func quoteSQLiteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// SettingsDatabaseStorageReport returns main DB file size (and WAL/SHM if present) plus row counts per app table.
func (a *App) SettingsDatabaseStorageReport() (SettingsDatabaseStorageDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return SettingsDatabaseStorageDTO{}, errors.New("db not ready")
	}
	dbPath := a.db.Path()
	out := SettingsDatabaseStorageDTO{
		DbPath:    dbPath,
		FileBytes: statFileBytes(dbPath),
		WalBytes:  statFileBytes(dbPath + "-wal"),
		ShmBytes:  statFileBytes(dbPath + "-shm"),
	}
	rows, err := a.db.DB.Raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).Rows()
	if err != nil {
		return out, nil
	}
	defer rows.Close()
	var tableNames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		if name != "" {
			tableNames = append(tableNames, name)
		}
	}
	_ = rows.Err()

	for _, tbl := range tableNames {
		var cnt int64
		q := "SELECT COUNT(*) FROM " + quoteSQLiteIdent(tbl)
		if err := a.db.DB.Raw(q).Scan(&cnt).Error; err != nil {
			continue
		}
		out.Tables = append(out.Tables, SettingsDatabaseTableStatDTO{TableName: tbl, RowCount: cnt})
	}
	return out, nil
}

func (a *App) SettingsClearUILayout() error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	return a.db.DB.Where("1 = 1").Delete(&storage.UILayoutState{}).Error
}

func (a *App) GetLogsSettings() (LogsSettingsDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return defaultLogsSettings(), errors.New("db not ready")
	}
	var st storage.AppSetting
	err := a.db.DB.First(&st, "key = ?", logsSettingsKey).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultLogsSettings(), nil
	}
	if err != nil {
		return defaultLogsSettings(), err
	}
	var out LogsSettingsDTO
	if err := json.Unmarshal([]byte(st.ValueJSON), &out); err != nil {
		return defaultLogsSettings(), nil
	}
	if out.MaxFileBytes <= 0 {
		out.MaxFileBytes = defaultLogsSettings().MaxFileBytes
	}
	if out.DefaultRetentionDays <= 0 {
		out.DefaultRetentionDays = defaultLogsSettings().DefaultRetentionDays
	}
	return out, nil
}

func (a *App) SaveLogsSettings(req LogsSettingsDTO) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if req.MaxFileBytes <= 0 {
		req.MaxFileBytes = defaultLogsSettings().MaxFileBytes
	}
	if req.DefaultRetentionDays <= 0 {
		req.DefaultRetentionDays = defaultLogsSettings().DefaultRetentionDays
	}
	b, _ := json.Marshal(req)
	var st storage.AppSetting
	err := a.db.DB.First(&st, "key = ?", logsSettingsKey).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return a.db.DB.Create(&storage.AppSetting{Key: logsSettingsKey, ValueJSON: string(b)}).Error
	}
	if err != nil {
		return err
	}
	st.ValueJSON = string(b)
	return a.db.DB.Save(&st).Error
}

func (a *App) ListLogFormats() ([]LogFormatDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	var rows []storage.LogFormat
	if err := a.db.DB.Order("is_system desc, name asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]LogFormatDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapLogFormat(row))
	}
	return out, nil
}

func (a *App) PreviewLogParse(formatID string, raw string) (LogParsePreviewResultDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return LogParsePreviewResultDTO{}, errors.New("db not ready")
	}
	id := strings.TrimSpace(formatID)
	if id == "" {
		return LogParsePreviewResultDTO{}, errors.New("format id required")
	}
	var row storage.LogFormat
	if err := a.db.DB.First(&row, "id = ?", id).Error; err != nil {
		return LogParsePreviewResultDTO{}, err
	}
	out := LogParsePreviewResultDTO{}
	if row.ParserType == "regex" && !row.IsSystem && strings.TrimSpace(row.Pattern) != "" {
		if _, err := regexp.Compile(row.Pattern); err != nil {
			out.CompileError = err.Error()
			return out, nil
		}
	}
	now := time.Now()
	for _, r := range parseLogRecordsPreview(row, raw, now) {
		e := r.Entry
		out.Records = append(out.Records, LogParsePreviewRecordDTO{
			Matched:         r.Matched,
			Route:           r.Route,
			TimestampUnixMs: e.TimestampUnixMs,
			TimestampSource: e.TimestampSource,
			Level:           e.Level,
			LevelSource:     e.LevelSource,
			Message:         e.Message,
			RawText:         e.RawText,
			MetaJSON:        e.MetaJSON,
		})
	}
	return out, nil
}

// LogParseDraftDTO drives PreviewLogParseDraft (unsaved regex format in the editor).
type LogParseDraftDTO struct {
	Pattern           string `json:"pattern"`
	TimeLayout        string `json:"timeLayout"`
	CaptureGroupsJSON string `json:"captureGroupsJson"`
	LevelMappingJSON  string `json:"levelMappingJson"`
	Raw               string `json:"raw"`
}

func (a *App) PreviewLogParseDraft(req LogParseDraftDTO) (LogParsePreviewResultDTO, error) {
	row := storage.LogFormat{
		ParserType:        "regex",
		IsSystem:          false,
		Pattern:           strings.TrimSpace(req.Pattern),
		TimeLayout:        strings.TrimSpace(req.TimeLayout),
		CaptureGroupsJSON: strings.TrimSpace(req.CaptureGroupsJSON),
		LevelMappingJSON:  strings.TrimSpace(req.LevelMappingJSON),
	}
	if row.CaptureGroupsJSON == "" {
		row.CaptureGroupsJSON = "{}"
	}
	if row.LevelMappingJSON == "" {
		row.LevelMappingJSON = "{}"
	}
	out := LogParsePreviewResultDTO{}
	if row.Pattern == "" {
		return out, nil
	}
	if _, err := regexp.Compile(row.Pattern); err != nil {
		out.CompileError = err.Error()
		return out, nil
	}
	now := time.Now()
	for _, r := range parseLogRecordsPreview(row, req.Raw, now) {
		e := r.Entry
		out.Records = append(out.Records, LogParsePreviewRecordDTO{
			Matched:         r.Matched,
			Route:           r.Route,
			TimestampUnixMs: e.TimestampUnixMs,
			TimestampSource: e.TimestampSource,
			Level:           e.Level,
			LevelSource:     e.LevelSource,
			Message:         e.Message,
			RawText:         e.RawText,
			MetaJSON:        e.MetaJSON,
		})
	}
	return out, nil
}

func (a *App) UpsertLogFormat(req UpsertLogFormatRequest) (LogFormatDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return LogFormatDTO{}, errors.New("db not ready")
	}
	if strings.TrimSpace(req.Name) == "" {
		return LogFormatDTO{}, errors.New("name required")
	}
	parserType := strings.TrimSpace(req.ParserType)
	if parserType == "" {
		parserType = "regex"
	}
	if parserType != "regex" {
		return LogFormatDTO{}, errors.New("only regex custom formats are editable in v1")
	}
	if strings.TrimSpace(req.Pattern) == "" {
		return LogFormatDTO{}, errors.New("pattern required")
	}
	if _, err := regexp.Compile(req.Pattern); err != nil {
		return LogFormatDTO{}, fmt.Errorf("invalid regex: %w", err)
	}
	if strings.TrimSpace(req.CaptureGroupsJSON) == "" {
		req.CaptureGroupsJSON = "{}"
	}
	if strings.TrimSpace(req.LevelMappingJSON) == "" {
		req.LevelMappingJSON = "{}"
	}
	if req.ID == "" {
		row := storage.LogFormat{
			Name:              req.Name,
			Description:       req.Description,
			ParserType:        parserType,
			Pattern:           req.Pattern,
			TimeLayout:        req.TimeLayout,
			CaptureGroupsJSON: req.CaptureGroupsJSON,
			LevelMappingJSON:  req.LevelMappingJSON,
			Enabled:           req.Enabled,
		}
		if !req.Enabled {
			row.Enabled = false
		} else {
			row.Enabled = true
		}
		if err := a.db.DB.Create(&row).Error; err != nil {
			return LogFormatDTO{}, err
		}
		return mapLogFormat(row), nil
	}
	var row storage.LogFormat
	if err := a.db.DB.First(&row, "id = ?", req.ID).Error; err != nil {
		return LogFormatDTO{}, err
	}
	if row.IsSystem {
		return LogFormatDTO{}, errors.New("built-in formats cannot be edited in place")
	}
	row.Name = req.Name
	row.Description = req.Description
	row.ParserType = parserType
	row.Pattern = req.Pattern
	row.TimeLayout = req.TimeLayout
	row.CaptureGroupsJSON = req.CaptureGroupsJSON
	row.LevelMappingJSON = req.LevelMappingJSON
	row.Enabled = req.Enabled
	if err := a.db.DB.Save(&row).Error; err != nil {
		return LogFormatDTO{}, err
	}
	return mapLogFormat(row), nil
}

func (a *App) DeleteLogFormat(id string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	var row storage.LogFormat
	if err := a.db.DB.First(&row, "id = ?", id).Error; err != nil {
		return err
	}
	if row.IsSystem {
		return errors.New("cannot delete built-in format")
	}
	return a.db.DB.Delete(&row).Error
}

func (a *App) ListLogSources(req ListLogSourcesRequest) ([]LogSourceDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	q := a.db.DB.Model(&storage.LogSource{})
	if strings.TrimSpace(req.Kind) != "" {
		q = q.Where("kind = ?", req.Kind)
	}
	if strings.TrimSpace(req.ProfileID) != "" {
		q = q.Where("profile_id = ?", req.ProfileID)
	}
	if strings.TrimSpace(req.ContainerName) != "" {
		q = q.Where("container_name = ?", req.ContainerName)
	}
	var rows []storage.LogSource
	if err := q.Order("`order` asc, path asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]LogSourceDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapLogSource(row))
	}
	return out, nil
}

func (a *App) UpsertLogSource(req UpsertLogSourceRequest) (LogSourceDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return LogSourceDTO{}, errors.New("db not ready")
	}
	kind := strings.TrimSpace(req.Kind)
	if kind != "profile" && kind != "docker_local" && kind != "docker_remote" {
		return LogSourceDTO{}, errors.New("unsupported source kind")
	}
	if strings.TrimSpace(req.Path) == "" {
		return LogSourceDTO{}, errors.New("path required")
	}
	if strings.TrimSpace(req.FormatID) == "" {
		req.FormatID = logFormatGenericPlain
	}
	var fmtRow storage.LogFormat
	if err := a.db.DB.First(&fmtRow, "id = ?", req.FormatID).Error; err != nil {
		return LogSourceDTO{}, fmt.Errorf("format not found: %w", err)
	}
	if kind == "profile" && strings.TrimSpace(req.ProfileID) == "" {
		return LogSourceDTO{}, errors.New("profileId required")
	}
	if (kind == "docker_local" || kind == "docker_remote") && strings.TrimSpace(req.ContainerName) == "" {
		return LogSourceDTO{}, errors.New("containerName required")
	}
	if kind == "docker_remote" && strings.TrimSpace(req.ProfileID) == "" {
		return LogSourceDTO{}, errors.New("profileId required for docker_remote")
	}
	if strings.TrimSpace(req.OptionsJSON) == "" {
		req.OptionsJSON = "{}"
	}
	enabled := req.Enabled
	if req.ID == "" {
		row := storage.LogSource{
			Kind:          kind,
			ProfileID:     req.ProfileID,
			ContainerName: req.ContainerName,
			Path:          req.Path,
			FormatID:      req.FormatID,
			DisplayName:   req.DisplayName,
			OptionsJSON:   req.OptionsJSON,
			Enabled:       enabled,
			Order:         req.Order,
		}
		if !enabled {
			row.Enabled = false
		} else {
			row.Enabled = true
		}
		if err := a.db.DB.Where("kind = ? AND profile_id = ? AND container_name = ? AND path = ?", row.Kind, row.ProfileID, row.ContainerName, row.Path).FirstOrCreate(&row).Error; err != nil {
			return LogSourceDTO{}, err
		}
		return mapLogSource(row), nil
	}
	var row storage.LogSource
	if err := a.db.DB.First(&row, "id = ?", req.ID).Error; err != nil {
		return LogSourceDTO{}, err
	}
	row.Kind = kind
	row.ProfileID = req.ProfileID
	row.ContainerName = req.ContainerName
	row.Path = req.Path
	row.FormatID = req.FormatID
	row.DisplayName = req.DisplayName
	row.OptionsJSON = req.OptionsJSON
	row.Enabled = enabled
	row.Order = req.Order
	if err := a.db.DB.Save(&row).Error; err != nil {
		return LogSourceDTO{}, err
	}
	return mapLogSource(row), nil
}

func (a *App) DeleteLogSource(id string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if err := a.db.DB.Delete(&storage.LogSource{}, "id = ?", id).Error; err != nil {
		return err
	}
	return a.db.DB.Delete(&storage.LogEntry{}, "source_id = ?", id).Error
}

func (a *App) LogsQuery(req LogsQueryRequest) (LogsQueryResultDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return LogsQueryResultDTO{}, errors.New("db not ready")
	}
	sourceIDs, paths, err := a.resolveLogSourceIDs(req.Kind, req.ProfileID, req.ContainerName, req.SourceID)
	if err != nil {
		return LogsQueryResultDTO{}, err
	}
	if len(sourceIDs) == 0 {
		return LogsQueryResultDTO{Entries: []LogEntryDTO{}, Levels: []string{}, SourcePaths: []string{}}, nil
	}
	q := a.db.DB.Model(&storage.LogEntry{}).Where("source_id IN ?", sourceIDs)
	if req.FromUnixMs > 0 {
		q = q.Where("timestamp_unix_ms >= ?", req.FromUnixMs)
	}
	if req.ToUnixMs > 0 {
		q = q.Where("timestamp_unix_ms <= ?", req.ToUnixMs)
	}
	if len(req.Levels) > 0 {
		q = q.Where("level IN ?", req.Levels)
	}
	if s := strings.TrimSpace(req.Search); s != "" {
		like := "%" + s + "%"
		q = q.Where("message LIKE ? OR raw_text LIKE ?", like, like)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return LogsQueryResultDTO{}, err
	}
	order := "timestamp_unix_ms desc, created_at desc"
	if req.Ascending {
		order = "timestamp_unix_ms asc, created_at asc"
	}
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}
	var rows []storage.LogEntry
	if err := q.Order(order).Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return LogsQueryResultDTO{}, err
	}
	levelSet := map[string]struct{}{}
	entries := make([]LogEntryDTO, 0, len(rows))
	for _, row := range rows {
		levelSet[row.Level] = struct{}{}
		entries = append(entries, mapLogEntry(row))
	}
	levels := make([]string, 0, len(levelSet))
	for level := range levelSet {
		levels = append(levels, level)
	}
	sort.Strings(levels)
	return LogsQueryResultDTO{Entries: entries, Total: total, Levels: levels, SourcePaths: paths}, nil
}

func (a *App) LogsSyncSource(req LogsSyncRequest) (LogsSyncResultDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return LogsSyncResultDTO{}, errors.New("db not ready")
	}
	var source storage.LogSource
	if err := a.db.DB.First(&source, "id = ?", req.SourceID).Error; err != nil {
		return LogsSyncResultDTO{}, err
	}
	var format storage.LogFormat
	if err := a.db.DB.First(&format, "id = ?", source.FormatID).Error; err != nil {
		return LogsSyncResultDTO{}, err
	}
	settings, _ := a.GetLogsSettings()
	size, raw, err := a.fetchLogSourceContent(source)
	if err != nil {
		source.LastError = err.Error()
		_ = a.db.DB.Save(&source).Error
		if a.ctx != nil {
			runtimeEmitLogSync(a.ctx, LogsSyncEvent{SourceID: source.ID, State: "failed", Message: err.Error()})
		}
		return LogsSyncResultDTO{}, err
	}
	if size > settings.MaxFileBytes && !req.ForceLarge {
		if a.ctx != nil {
			runtimeEmitLogSync(a.ctx, LogsSyncEvent{SourceID: source.ID, State: "warning", Message: "large file confirmation required", BytesRead: size})
		}
		return LogsSyncResultDTO{
			SourceID:     source.ID,
			BytesRead:    size,
			LargeFile:    true,
			NeedsConfirm: true,
			Warning:      fmt.Sprintf("File is %d bytes and exceeds the configured threshold", size),
		}, nil
	}
	if a.ctx != nil {
		runtimeEmitLogSync(a.ctx, LogsSyncEvent{SourceID: source.ID, State: "running", Message: "importing logs", BytesRead: size})
	}
	parsed := parseLogRecords(format, raw, settings, time.Now())
	imported, skipped, err := a.storeParsedLogs(source, parsed)
	if err != nil {
		source.LastError = err.Error()
		_ = a.db.DB.Save(&source).Error
		if a.ctx != nil {
			runtimeEmitLogSync(a.ctx, LogsSyncEvent{SourceID: source.ID, State: "failed", Message: err.Error(), ImportedCount: imported, SkippedCount: skipped, BytesRead: size})
		}
		return LogsSyncResultDTO{}, err
	}
	now := time.Now()
	source.LastError = ""
	source.LastSyncedAt = &now
	_ = a.db.DB.Save(&source).Error
	if settings.DefaultRetentionDays > 0 {
		cutoff := time.Now().Add(-time.Duration(settings.DefaultRetentionDays) * 24 * time.Hour).UnixMilli()
		_, _ = a.LogsPurge(LogsPurgeRequest{SourceID: source.ID, BeforeUnixMs: cutoff})
	}
	if a.ctx != nil {
		runtimeEmitLogSync(a.ctx, LogsSyncEvent{SourceID: source.ID, State: "success", ImportedCount: imported, SkippedCount: skipped, BytesRead: size})
	}
	return LogsSyncResultDTO{
		SourceID:      source.ID,
		ImportedCount: imported,
		SkippedCount:  skipped,
		BytesRead:     size,
		LargeFile:     size > settings.MaxFileBytes,
	}, nil
}

func (a *App) LogsPurge(req LogsPurgeRequest) (int64, error) {
	if a.db == nil || a.db.DB == nil {
		return 0, errors.New("db not ready")
	}
	sourceIDs, _, err := a.resolveLogSourceIDs(req.Kind, req.ProfileID, req.ContainerName, req.SourceID)
	if err != nil {
		return 0, err
	}
	q := a.db.DB.Model(&storage.LogEntry{})
	if len(sourceIDs) > 0 {
		q = q.Where("source_id IN ?", sourceIDs)
	}
	if req.BeforeUnixMs > 0 {
		q = q.Where("timestamp_unix_ms <= ?", req.BeforeUnixMs)
	}
	res := q.Delete(&storage.LogEntry{})
	return res.RowsAffected, res.Error
}

func (a *App) ListDockerRemoteLogTargets(profileId string) ([]DockerContainerDTO, error) {
	sessionId, err := a.DockerRemoteConnectProfile(profileId)
	if err != nil {
		return nil, err
	}
	defer func() {
		if a.ctx != nil {
			_ = a.DockerRemoteDisconnect(sessionId)
		}
	}()
	return a.DockerRemoteListContainers(sessionId)
}

func (a *App) fetchLogSourceContent(source storage.LogSource) (int64, string, error) {
	switch source.Kind {
	case "profile":
		return a.fetchProfileLog(source.ProfileID, source.Path)
	case "docker_local":
		return a.fetchDockerLocalLog(source.ContainerName, source.Path)
	case "docker_remote":
		return a.fetchDockerRemoteLog(source.ProfileID, source.ContainerName, source.Path)
	default:
		return 0, "", errors.New("unsupported source kind")
	}
}

func (a *App) fetchProfileLog(profileId string, path string) (int64, string, error) {
	sid, err := a.SSHDashboardConnectProfile(profileId)
	if err != nil {
		return 0, "", err
	}
	defer func() {
		if a.ctx != nil {
			_ = a.SSHDisconnect(sid)
		}
	}()
	sizeRaw, err := a.SSHExec(sid, fmt.Sprintf("sh -lc \"if [ -f %s ]; then wc -c < %s; else echo 0; fi\"", shellQuote(path), shellQuote(path)))
	if err != nil {
		return 0, "", err
	}
	size, _ := strconv.ParseInt(strings.TrimSpace(sizeRaw), 10, 64)
	raw, err := a.SSHExec(sid, fmt.Sprintf("sh -lc \"cat %s\"", shellQuote(path)))
	return size, raw, err
}

func (a *App) fetchDockerLocalLog(containerName string, path string) (int64, string, error) {
	containerID, err := a.resolveLocalContainerID(containerName)
	if err != nil {
		return 0, "", err
	}
	sizeRaw, err := a.dockerLocalExecOutput(containerID, fmt.Sprintf("if [ -f %s ]; then wc -c < %s; else echo 0; fi", shellQuote(path), shellQuote(path)))
	if err != nil {
		return 0, "", err
	}
	size, _ := strconv.ParseInt(strings.TrimSpace(sizeRaw), 10, 64)
	raw, err := a.dockerLocalExecOutput(containerID, fmt.Sprintf("cat %s", shellQuote(path)))
	return size, raw, err
}

func (a *App) fetchDockerRemoteLog(profileId string, containerName string, path string) (int64, string, error) {
	sid, err := a.DockerRemoteConnectProfile(profileId)
	if err != nil {
		return 0, "", err
	}
	defer func() {
		if a.ctx != nil {
			_ = a.DockerRemoteDisconnect(sid)
		}
	}()
	containers, err := a.DockerRemoteListContainers(sid)
	if err != nil {
		return 0, "", err
	}
	containerID := ""
	for _, c := range containers {
		if c.Name == containerName {
			containerID = c.ID
			break
		}
	}
	if containerID == "" {
		return 0, "", fmt.Errorf("remote container not found: %s", containerName)
	}
	sizeRaw, err := a.dockerRemoteExecInContainer(sid, containerID, fmt.Sprintf("if [ -f %s ]; then wc -c < %s; else echo 0; fi", shellQuote(path), shellQuote(path)))
	if err != nil {
		return 0, "", err
	}
	size, _ := strconv.ParseInt(strings.TrimSpace(sizeRaw), 10, 64)
	raw, err := a.dockerRemoteExecInContainer(sid, containerID, fmt.Sprintf("cat %s", shellQuote(path)))
	return size, raw, err
}

func (a *App) resolveLocalContainerID(containerName string) (string, error) {
	rows, err := a.DockerLocalListContainers()
	if err != nil {
		return "", err
	}
	for _, row := range rows {
		if row.Name == containerName {
			return row.ID, nil
		}
	}
	return "", fmt.Errorf("container not found: %s", containerName)
}

func (a *App) resolveLogSourceIDs(kind string, profileId string, containerName string, sourceID string) ([]string, []string, error) {
	if strings.TrimSpace(sourceID) != "" {
		var row storage.LogSource
		if err := a.db.DB.First(&row, "id = ?", sourceID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return []string{}, []string{}, nil
			}
			return nil, nil, err
		}
		return []string{row.ID}, []string{row.Path}, nil
	}
	q := a.db.DB.Model(&storage.LogSource{})
	if strings.TrimSpace(kind) != "" {
		q = q.Where("kind = ?", kind)
	}
	if strings.TrimSpace(profileId) != "" {
		q = q.Where("profile_id = ?", profileId)
	}
	if strings.TrimSpace(containerName) != "" {
		q = q.Where("container_name = ?", containerName)
	}
	var rows []storage.LogSource
	if err := q.Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	ids := make([]string, 0, len(rows))
	paths := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		paths = append(paths, row.Path)
	}
	return ids, paths, nil
}

func parseLogRecords(format storage.LogFormat, raw string, settings LogsSettingsDTO, now time.Time) []parsedLogEntry {
	records := splitLogRecords(format, raw)
	out := make([]parsedLogEntry, 0, len(records))
	for _, record := range records {
		if strings.TrimSpace(record) == "" {
			continue
		}
		rec := applyRedaction(record, settings.RedactionPatterns)
		parsed := parseRecord(format, rec, now)
		out = append(out, parsed)
	}
	return out
}

// parseLogRecordsPreview splits raw text like ingest, skips redaction, returns per-record match info for the UI.
func parseLogRecordsPreview(format storage.LogFormat, raw string, now time.Time) []recordParseResult {
	records := splitLogRecords(format, raw)
	out := make([]recordParseResult, 0, len(records))
	for _, record := range records {
		if strings.TrimSpace(record) == "" {
			continue
		}
		out = append(out, parseRecordResult(format, record, now))
	}
	return out
}

func splitLogRecords(format storage.LogFormat, raw string) []string {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	if format.BuiltinKey == "php_error" || format.BuiltinKey == "php_fpm" || format.BuiltinKey == "generic_plain_with_timestamp_guess" {
		var out []string
		var current strings.Builder
		flush := func() {
			if current.Len() == 0 {
				return
			}
			out = append(out, current.String())
			current.Reset()
		}
		for _, line := range lines {
			if strings.TrimSpace(line) == "" {
				flush()
				continue
			}
			if current.Len() == 0 {
				current.WriteString(line)
				continue
			}
			if shouldContinueRecord(format.BuiltinKey, line) {
				current.WriteString("\n")
				current.WriteString(line)
				continue
			}
			flush()
			current.WriteString(line)
		}
		flush()
		return out
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			out = append(out, line)
		}
	}
	return out
}

func shouldContinueRecord(builtinKey string, line string) bool {
	trimmed := strings.TrimLeft(line, " \t")
	if builtinKey == "php_error" || builtinKey == "php_fpm" {
		return line != trimmed || strings.HasPrefix(trimmed, "Stack trace:") || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "thrown in")
	}
	return line != trimmed || strings.HasPrefix(trimmed, "at ") || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "Caused by:") || strings.HasPrefix(trimmed, "... ")
}

var (
	reSyslog      = regexp.MustCompile(`^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+([^\s]+)\s+([^:]+):\s*(.*)$`)
	reNginxAccess = regexp.MustCompile(`^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"$`)
	reNginxError  = regexp.MustCompile(`^(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.*)$`)
	rePHPErr      = regexp.MustCompile(`^\[([^\]]+)\]\s+PHP\s+([^:]+):\s+(.*)$`)
	rePHPFPM      = regexp.MustCompile(`^\[([^\]]+)\]\s+([A-Z]+):\s+(.*)$`)
)

func parseRecord(format storage.LogFormat, record string, now time.Time) parsedLogEntry {
	return parseRecordResult(format, record, now).Entry
}

func parseRecordResult(format storage.LogFormat, record string, now time.Time) recordParseResult {
	switch format.BuiltinKey {
	case "syslog":
		if m := reSyslog.FindStringSubmatch(record); len(m) > 0 {
			ts := parseTimestampGuess(m[1], now)
			return recordParseResult{
				Matched: true,
				Route:   "syslog",
				Entry: parsedLogEntry{
					TimestampUnixMs: ts,
					TimestampSource: chooseTimestampSource(ts, now),
					Level:           guessSeverity(m[4]),
					LevelSource:     "guessed",
					Message:         fmt.Sprintf("%s: %s", m[3], m[4]),
					RawText:         record,
					MetaJSON:        fmt.Sprintf(`{"host":%q}`, m[2]),
				},
			}
		}
	case "nginx_access":
		if m := reNginxAccess.FindStringSubmatch(record); len(m) > 0 {
			ts := parseTimestampGuess(m[2], now)
			return recordParseResult{
				Matched: true,
				Route:   "nginx_access",
				Entry: parsedLogEntry{
					TimestampUnixMs: ts,
					TimestampSource: chooseTimestampSource(ts, now),
					Level:           normalizeSeverity("info"),
					LevelSource:     "parsed",
					Message:         fmt.Sprintf("%s %s (%s)", m[3], m[4], m[1]),
					RawText:         record,
					MetaJSON:        fmt.Sprintf(`{"ip":%q,"request":%q,"status":%q,"size":%q}`, m[1], m[3], m[4], m[5]),
				},
			}
		}
	case "nginx_error":
		if m := reNginxError.FindStringSubmatch(record); len(m) > 0 {
			ts := parseTimestampGuess(m[1], now)
			level := normalizeSeverity(m[2])
			return recordParseResult{
				Matched: true,
				Route:   "nginx_error",
				Entry: parsedLogEntry{
					TimestampUnixMs: ts,
					TimestampSource: chooseTimestampSource(ts, now),
					Level:           level,
					LevelSource:     "parsed",
					Message:         m[3],
					RawText:         record,
					MetaJSON:        "{}",
				},
			}
		}
	case "php_error":
		if m := rePHPErr.FindStringSubmatch(record); len(m) > 0 {
			ts := parseTimestampGuess(m[1], now)
			level := normalizeSeverity(m[2])
			return recordParseResult{
				Matched: true,
				Route:   "php_error",
				Entry: parsedLogEntry{
					TimestampUnixMs: ts,
					TimestampSource: chooseTimestampSource(ts, now),
					Level:           level,
					LevelSource:     "parsed",
					Message:         m[3],
					RawText:         record,
					MetaJSON:        "{}",
				},
			}
		}
	case "php_fpm":
		if m := rePHPFPM.FindStringSubmatch(record); len(m) > 0 {
			ts := parseTimestampGuess(m[1], now)
			level := normalizeSeverity(m[2])
			return recordParseResult{
				Matched: true,
				Route:   "php_fpm",
				Entry: parsedLogEntry{
					TimestampUnixMs: ts,
					TimestampSource: chooseTimestampSource(ts, now),
					Level:           level,
					LevelSource:     "parsed",
					Message:         m[3],
					RawText:         record,
					MetaJSON:        "{}",
				},
			}
		}
	}
	if format.ParserType == "regex" && !format.IsSystem {
		return parseRegexRecordResult(format, record, now)
	}
	ts := parseTimestampGuess(record, now)
	level, source := guessSeverityWithSource(record)
	entry := parsedLogEntry{
		TimestampUnixMs: ts,
		TimestampSource: chooseTimestampSource(ts, now),
		Level:           level,
		LevelSource:     source,
		Message:         strings.TrimSpace(record),
		RawText:         record,
		MetaJSON:        "{}",
	}
	matched := format.BuiltinKey == "generic_plain_with_timestamp_guess"
	route := "generic_fallback"
	if matched {
		route = "generic_plain"
	}
	return recordParseResult{Entry: entry, Matched: matched, Route: route}
}

func parseRegexRecord(format storage.LogFormat, record string, now time.Time) parsedLogEntry {
	return parseRegexRecordResult(format, record, now).Entry
}

// applyLevelMappingJSON returns a normalized level if mappingJSON maps the captured level text, else "".
func applyLevelMappingJSON(levelRaw, mappingJSON string) string {
	raw := strings.TrimSpace(levelRaw)
	if raw == "" {
		return ""
	}
	s := strings.TrimSpace(mappingJSON)
	if s == "" || s == "{}" {
		return ""
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return ""
	}
	for _, k := range []string{raw, strings.ToLower(raw)} {
		if v, ok := m[k]; ok {
			out := normalizeSeverity(strings.TrimSpace(v))
			if out != "unknown" {
				return out
			}
		}
	}
	return ""
}

func parseRegexRecordResult(format storage.LogFormat, record string, now time.Time) recordParseResult {
	re, err := regexp.Compile(format.Pattern)
	if err != nil {
		ts := parseTimestampGuess(record, now)
		level, source := guessSeverityWithSource(record)
		return recordParseResult{
			Matched: false,
			Route:   "regex_compile_error",
			Entry: parsedLogEntry{
				TimestampUnixMs: ts,
				TimestampSource: chooseTimestampSource(ts, now),
				Level:           level,
				LevelSource:     source,
				Message:         record,
				RawText:         record,
				MetaJSON:        "{}",
			},
		}
	}
	matches := re.FindStringSubmatch(record)
	if len(matches) == 0 {
		ts := parseTimestampGuess(record, now)
		level, source := guessSeverityWithSource(record)
		return recordParseResult{
			Matched: false,
			Route:   "regex_no_match",
			Entry: parsedLogEntry{
				TimestampUnixMs: ts,
				TimestampSource: chooseTimestampSource(ts, now),
				Level:           level,
				LevelSource:     source,
				Message:         record,
				RawText:         record,
				MetaJSON:        "{}",
			},
		}
	}
	fields := map[string]string{}
	_ = json.Unmarshal([]byte(format.CaptureGroupsJSON), &fields)
	var timestampRaw, levelRaw, messageRaw string
	meta := map[string]string{}
	for idx, name := range fields {
		n, err := strconv.Atoi(idx)
		if err != nil || n < 0 || n >= len(matches) {
			continue
		}
		val := matches[n]
		switch name {
		case "timestamp":
			timestampRaw = val
		case "level":
			levelRaw = val
		case "message":
			messageRaw = val
		default:
			meta[name] = val
		}
	}
	if messageRaw == "" {
		messageRaw = record
	}
	ts := int64(0)
	if timestampRaw != "" {
		if format.TimeLayout != "" {
			if t, err := time.ParseInLocation(format.TimeLayout, timestampRaw, time.Local); err == nil {
				ts = t.UnixMilli()
			}
		}
		if ts == 0 {
			ts = parseTimestampGuess(timestampRaw, now)
		}
	}
	if ts == 0 {
		ts = parseTimestampGuess(record, now)
	}
	level := applyLevelMappingJSON(levelRaw, format.LevelMappingJSON)
	if level == "" {
		level = normalizeSeverity(levelRaw)
	}
	levelSource := "parsed"
	if level == "unknown" {
		level, levelSource = guessSeverityWithSource(messageRaw)
	}
	metaJSON := "{}"
	if len(meta) > 0 {
		if b, err := json.Marshal(meta); err == nil {
			metaJSON = string(b)
		}
	}
	return recordParseResult{
		Matched: true,
		Route:   "regex",
		Entry: parsedLogEntry{
			TimestampUnixMs: ts,
			TimestampSource: chooseTimestampSource(ts, now),
			Level:           level,
			LevelSource:     levelSource,
			Message:         strings.TrimSpace(messageRaw),
			RawText:         record,
			MetaJSON:        metaJSON,
		},
	}
}

func parseTimestampGuess(text string, now time.Time) int64 {
	candidates := []string{
		text,
		extractBracketTime(text),
		extractLeadingDate(text),
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05.000",
		"2006/01/02 15:04:05",
		"02-Jan-2006 15:04:05 MST",
		"02-Jan-2006 15:04:05",
		"02/Jan/2006:15:04:05 -0700",
		"Jan 2 15:04:05",
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		for _, layout := range layouts {
			if t, err := time.ParseInLocation(layout, candidate, time.Local); err == nil {
				if layout == "Jan 2 15:04:05" {
					t = time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.Local)
				}
				return t.UnixMilli()
			}
		}
	}
	return now.UnixMilli()
}

func extractBracketTime(text string) string {
	if !strings.HasPrefix(text, "[") {
		return ""
	}
	if idx := strings.Index(text, "]"); idx > 1 {
		return text[1:idx]
	}
	return ""
}

func extractLeadingDate(text string) string {
	text = strings.TrimSpace(text)
	if len(text) < 19 {
		return ""
	}
	for _, sep := range []string{" ", "\t"} {
		if idx := strings.Index(text, sep); idx > 0 {
			first := text[:idx]
			if strings.Count(first, "/") == 2 || strings.Count(first, "-") >= 2 {
				if idx2 := strings.Index(strings.TrimSpace(text[idx+1:]), " "); idx2 > 0 {
					return strings.TrimSpace(text[:idx+1+idx2])
				}
			}
		}
	}
	return ""
}

func chooseTimestampSource(ts int64, now time.Time) string {
	if ts == now.UnixMilli() {
		return "ingest_time"
	}
	return "parsed"
}

func guessSeverity(text string) string {
	level, _ := guessSeverityWithSource(text)
	return level
}

func guessSeverityWithSource(text string) (string, string) {
	lower := " " + strings.ToLower(text) + " "
	has := func(tokens ...string) bool {
		for _, token := range tokens {
			if strings.Contains(lower, " "+strings.ToLower(token)+" ") || strings.Contains(lower, "["+strings.ToLower(token)+"]") || strings.Contains(lower, strings.ToLower(token)+":") {
				return true
			}
		}
		return false
	}
	if has("error", "fatal", "exception", "panic", "failed", "failure", "critical", "crit", "alert", "emerg", "denied") {
		return "error", "guessed"
	}
	if has("warn", "warning", "deprecated", "timeout", "timed out", "retry", "slow") {
		return "warn", "guessed"
	}
	if has("ok", "success", "successful", "completed", "done", "healthy", "passed") {
		return "success", "guessed"
	}
	if has("info", "notice", "started", "connected", "loaded", "ready") {
		return "info", "guessed"
	}
	return "unknown", "unknown"
}

func normalizeSeverity(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	switch {
	case s == "":
		return "unknown"
	case strings.Contains(s, "error"), strings.Contains(s, "fatal"), strings.Contains(s, "crit"), strings.Contains(s, "alert"), strings.Contains(s, "panic"), strings.Contains(s, "exception"):
		return "error"
	case strings.Contains(s, "warn"), strings.Contains(s, "deprecat"), strings.Contains(s, "timeout"):
		return "warn"
	case strings.Contains(s, "success"), strings.Contains(s, "ok"), strings.Contains(s, "pass"), strings.Contains(s, "complete"), strings.Contains(s, "done"), strings.Contains(s, "healthy"):
		return "success"
	case strings.Contains(s, "info"), strings.Contains(s, "notice"), strings.Contains(s, "start"), strings.Contains(s, "ready"), strings.Contains(s, "connect"), strings.Contains(s, "load"):
		return "info"
	default:
		return "unknown"
	}
}

func applyRedaction(text string, patterns []string) string {
	out := text
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			continue
		}
		out = re.ReplaceAllString(out, "[REDACTED]")
	}
	return out
}

func (a *App) storeParsedLogs(source storage.LogSource, parsed []parsedLogEntry) (int, int, error) {
	imported := 0
	skipped := 0
	for _, row := range parsed {
		dedupeKey := makeLogDedupeKey(source.ID, row.RawText)
		entry := storage.LogEntry{
			SourceID:        source.ID,
			Kind:            source.Kind,
			ProfileID:       source.ProfileID,
			ContainerName:   source.ContainerName,
			SourcePath:      source.Path,
			TimestampUnixMs: row.TimestampUnixMs,
			IngestedUnixMs:  time.Now().UnixMilli(),
			TimestampSource: row.TimestampSource,
			Level:           row.Level,
			LevelSource:     row.LevelSource,
			Message:         row.Message,
			RawText:         row.RawText,
			DedupeKey:       dedupeKey,
			MetaJSON:        row.MetaJSON,
		}
		err := a.db.DB.Create(&entry).Error
		if err == nil {
			imported++
			continue
		}
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			skipped++
			continue
		}
		return imported, skipped, err
	}
	return imported, skipped, nil
}

func makeLogDedupeKey(sourceID string, raw string) string {
	sum := sha1.Sum([]byte(sourceID + "\n" + raw))
	return hex.EncodeToString(sum[:])
}

func runtimeEmitLogSync(ctx context.Context, ev LogsSyncEvent) {
	if ctx == nil {
		return
	}
	runtime.EventsEmit(ctx, "logs:sync", ev)
}

func mapLogFormat(row storage.LogFormat) LogFormatDTO {
	return LogFormatDTO{
		ID:                row.ID,
		Name:              row.Name,
		Description:       row.Description,
		BuiltinKey:        row.BuiltinKey,
		ParserType:        row.ParserType,
		Pattern:           row.Pattern,
		TimeLayout:        row.TimeLayout,
		CaptureGroupsJSON: row.CaptureGroupsJSON,
		LevelMappingJSON:  row.LevelMappingJSON,
		IsSystem:          row.IsSystem,
		Enabled:           row.Enabled,
		CreatedAt:         row.CreatedAt.Format(time.RFC3339),
		UpdatedAt:         row.UpdatedAt.Format(time.RFC3339),
	}
}

func mapLogSource(row storage.LogSource) LogSourceDTO {
	out := LogSourceDTO{
		ID:            row.ID,
		Kind:          row.Kind,
		ProfileID:     row.ProfileID,
		ContainerName: row.ContainerName,
		Path:          row.Path,
		FormatID:      row.FormatID,
		DisplayName:   row.DisplayName,
		OptionsJSON:   row.OptionsJSON,
		LastError:     row.LastError,
		Enabled:       row.Enabled,
		Order:         row.Order,
		CreatedAt:     row.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     row.UpdatedAt.Format(time.RFC3339),
	}
	if row.LastSyncedAt != nil {
		out.LastSyncedAt = row.LastSyncedAt.Format(time.RFC3339)
	}
	return out
}

func mapLogEntry(row storage.LogEntry) LogEntryDTO {
	return LogEntryDTO{
		ID:              row.ID,
		SourceID:        row.SourceID,
		Kind:            row.Kind,
		ProfileID:       row.ProfileID,
		ContainerName:   row.ContainerName,
		SourcePath:      row.SourcePath,
		TimestampUnixMs: row.TimestampUnixMs,
		IngestedUnixMs:  row.IngestedUnixMs,
		TimestampSource: row.TimestampSource,
		Level:           row.Level,
		LevelSource:     row.LevelSource,
		Message:         row.Message,
		RawText:         row.RawText,
	}
}
