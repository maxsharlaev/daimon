package main

import (
	"errors"
	"sort"
	"strings"
	"time"

	"daimon/internal/secrets"
	"daimon/internal/storage"
	"gorm.io/gorm"
)

// SettingsPrivacyProfileDetailDTO summarizes stored auth, secrets, and logs for one SSH profile (no secret values).
type SettingsPrivacyProfileDetailDTO struct {
	ProfileID string `json:"profileId"`

	PasswordStorage string `json:"passwordStorage"` // none | keyring | internal | external (should not apply)
	PasswordSet     bool   `json:"passwordSet"`     // storage != none

	PrivateKeyStorage string `json:"privateKeyStorage"`
	PrivateKeySet     bool   `json:"privateKeySet"`

	CustomSecrets []SecretItemDTO `json:"customSecrets"`

	VaultItemCount int64 `json:"vaultItemCount"`

	LogProfileSourceCount int64 `json:"logProfileSourceCount"`
	LogEntryCount         int64 `json:"logEntryCount"`
	LogLastSyncedUnixMs   int64 `json:"logLastSyncedUnixMs"` // 0 if never
}

func (a *App) SettingsPrivacyProfileDetail(profileId string) (SettingsPrivacyProfileDetailDTO, error) {
	var out SettingsPrivacyProfileDetailDTO
	if a.db == nil || a.db.DB == nil {
		return out, errors.New("db not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return out, errors.New("profileId required")
	}
	var prof storage.Profile
	if err := a.db.DB.First(&prof, "id = ?", profileId).Error; err != nil {
		return out, err
	}
	out.ProfileID = profileId

	if a.secrets != nil {
		if sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPassword); err == nil {
			out.PasswordStorage = sr.Storage
			out.PasswordSet = sr.Storage != string(secrets.StorageNone)
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			out.PasswordStorage = string(secrets.StorageNone)
			out.PasswordSet = false
		} else {
			return out, err
		}

		if sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPrivateKey); err == nil {
			out.PrivateKeyStorage = sr.Storage
			out.PrivateKeySet = sr.Storage != string(secrets.StorageNone)
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			out.PrivateKeyStorage = string(secrets.StorageNone)
			out.PrivateKeySet = false
		} else {
			return out, err
		}

		items, err := a.ListSecrets(profileId)
		if err != nil {
			return out, err
		}
		out.CustomSecrets = items
	}

	_ = a.db.DB.Model(&storage.VaultItem{}).Where("profile_id = ?", profileId).Count(&out.VaultItemCount).Error

	var srcIDs []string
	_ = a.db.DB.Model(&storage.LogSource{}).Where("kind = ? AND profile_id = ?", "profile", profileId).Pluck("id", &srcIDs).Error
	out.LogProfileSourceCount = int64(len(srcIDs))
	if len(srcIDs) > 0 {
		_ = a.db.DB.Model(&storage.LogEntry{}).Where("source_id IN ?", srcIDs).Count(&out.LogEntryCount).Error
	}

	var sources []storage.LogSource
	_ = a.db.DB.Where("kind = ? AND profile_id = ?", "profile", profileId).Find(&sources).Error
	var maxT *time.Time
	for _, s := range sources {
		if s.LastSyncedAt == nil {
			continue
		}
		if maxT == nil || s.LastSyncedAt.After(*maxT) {
			t := *s.LastSyncedAt
			maxT = &t
		}
	}
	if maxT != nil {
		out.LogLastSyncedUnixMs = maxT.UnixMilli()
	}

	return out, nil
}

func (a *App) PrivacyClearAuthPassword(profileId string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return errors.New("profileId required")
	}
	return a.secrets.PutSecretValue(profileId, secrets.KindPassword, secrets.StorageNone, "", secrets.SecretValue{}, "{}")
}

func (a *App) PrivacyClearAuthPrivateKey(profileId string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return errors.New("profileId required")
	}
	return a.secrets.PutSecretValue(profileId, secrets.KindPrivateKey, secrets.StorageNone, "", secrets.SecretValue{}, "{}")
}

func (a *App) PrivacyDeleteAllCustomSecrets(profileId string) error {
	if a.secrets == nil || a.db == nil || a.db.DB == nil {
		return errors.New("secrets not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return errors.New("profileId required")
	}
	items, err := a.ListSecrets(profileId)
	if err != nil {
		return err
	}
	for _, it := range items {
		if err := a.DeleteSecret(profileId, it.Key); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) PrivacyPurgeProfileLogs(profileId string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return errors.New("profileId required")
	}
	var sources []storage.LogSource
	if err := a.db.DB.Find(&sources, "kind = ? AND profile_id = ?", "profile", profileId).Error; err != nil {
		return err
	}
	for _, s := range sources {
		if err := a.DeleteLogSource(s.ID); err != nil {
			return err
		}
	}
	return nil
}

// PrivacyPurgeAllSecrets removes every stored secret reference: clears keyring / internal vault material per ref, then deletes all secret_ref rows (SSH passwords, keys, custom secrets, passphrases).
func (a *App) PrivacyPurgeAllSecrets() error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	var refs []storage.SecretRef
	if err := a.db.DB.Find(&refs).Error; err != nil {
		return err
	}
	for _, r := range refs {
		if err := a.secrets.PutSecretValue(r.ProfileID, secrets.Kind(r.Kind), secrets.StorageNone, "", secrets.SecretValue{}, "{}"); err != nil {
			return err
		}
	}
	return a.db.DB.Where("1 = 1").Delete(&storage.SecretRef{}).Error
}

// PrivacyDockerLogBucketDTO aggregates imported log data stored for one Docker container key (local or remote).
type PrivacyDockerLogBucketDTO struct {
	ContainerName    string `json:"containerName"`
	SourceCount      int64  `json:"sourceCount"`
	EntryCount       int64  `json:"entryCount"`
	LastSyncedUnixMs int64  `json:"lastSyncedUnixMs"`
	// Orphaned is true when the container name is not present on the live Docker host (local engine or remote host after a successful list). False if Docker could not be queried.
	Orphaned bool `json:"orphaned"`
}

func markPrivacyDockerBucketsOrphanedByLiveNames(buckets []PrivacyDockerLogBucketDTO, liveNames map[string]bool) {
	for i := range buckets {
		buckets[i].Orphaned = !liveNames[buckets[i].ContainerName]
	}
}

// PrivacyDockerRemoteOrphanBucketDTO is docker_remote log data tied to a deleted SSH profile (profile row missing).
type PrivacyDockerRemoteOrphanBucketDTO struct {
	ProfileID        string `json:"profileId"`
	ContainerName    string `json:"containerName"`
	SourceCount      int64  `json:"sourceCount"`
	EntryCount       int64  `json:"entryCount"`
	LastSyncedUnixMs int64  `json:"lastSyncedUnixMs"`
}

func aggregatePrivacyDockerRemoteOrphanBuckets(db *gorm.DB, sources []storage.LogSource) ([]PrivacyDockerRemoteOrphanBucketDTO, error) {
	byProf := map[string]map[string][]storage.LogSource{}
	for _, s := range sources {
		pid := s.ProfileID
		cn := s.ContainerName
		if byProf[pid] == nil {
			byProf[pid] = map[string][]storage.LogSource{}
		}
		byProf[pid][cn] = append(byProf[pid][cn], s)
	}
	pids := make([]string, 0, len(byProf))
	for k := range byProf {
		pids = append(pids, k)
	}
	sort.Strings(pids)
	out := make([]PrivacyDockerRemoteOrphanBucketDTO, 0)
	for _, pid := range pids {
		inner := byProf[pid]
		cns := make([]string, 0, len(inner))
		for k := range inner {
			cns = append(cns, k)
		}
		sort.Strings(cns)
		for _, cn := range cns {
			list := inner[cn]
			ids := make([]string, len(list))
			for i := range list {
				ids[i] = list[i].ID
			}
			var entryCount int64
			if len(ids) > 0 {
				_ = db.Model(&storage.LogEntry{}).Where("source_id IN ?", ids).Count(&entryCount).Error
			}
			var maxT *time.Time
			for _, s := range list {
				if s.LastSyncedAt != nil && (maxT == nil || s.LastSyncedAt.After(*maxT)) {
					t := *s.LastSyncedAt
					maxT = &t
				}
			}
			d := PrivacyDockerRemoteOrphanBucketDTO{
				ProfileID:     pid,
				ContainerName: cn,
				SourceCount:   int64(len(list)),
				EntryCount:    entryCount,
			}
			if maxT != nil {
				d.LastSyncedUnixMs = maxT.UnixMilli()
			}
			out = append(out, d)
		}
	}
	return out, nil
}

func aggregatePrivacyDockerLogBuckets(db *gorm.DB, sources []storage.LogSource) ([]PrivacyDockerLogBucketDTO, error) {
	by := map[string][]storage.LogSource{}
	for _, s := range sources {
		by[s.ContainerName] = append(by[s.ContainerName], s)
	}
	names := make([]string, 0, len(by))
	for k := range by {
		names = append(names, k)
	}
	sort.Strings(names)
	out := make([]PrivacyDockerLogBucketDTO, 0, len(names))
	for _, cn := range names {
		list := by[cn]
		ids := make([]string, len(list))
		for i := range list {
			ids[i] = list[i].ID
		}
		var entryCount int64
		if len(ids) > 0 {
			_ = db.Model(&storage.LogEntry{}).Where("source_id IN ?", ids).Count(&entryCount).Error
		}
		var maxT *time.Time
		for _, s := range list {
			if s.LastSyncedAt != nil && (maxT == nil || s.LastSyncedAt.After(*maxT)) {
				t := *s.LastSyncedAt
				maxT = &t
			}
		}
		d := PrivacyDockerLogBucketDTO{
			ContainerName: cn,
			SourceCount:   int64(len(list)),
			EntryCount:    entryCount,
		}
		if maxT != nil {
			d.LastSyncedUnixMs = maxT.UnixMilli()
		}
		out = append(out, d)
	}
	return out, nil
}

// ListPrivacyDockerLocalLogBuckets returns one row per container name for stored docker_local log sources.
func (a *App) ListPrivacyDockerLocalLogBuckets() ([]PrivacyDockerLogBucketDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	var sources []storage.LogSource
	if err := a.db.DB.Where("kind = ?", "docker_local").Find(&sources).Error; err != nil {
		return nil, err
	}
	out, err := aggregatePrivacyDockerLogBuckets(a.db.DB, sources)
	if err != nil {
		return nil, err
	}
	if rows, err := a.DockerLocalListContainers(); err == nil {
		live := map[string]bool{}
		for _, c := range rows {
			if n := strings.TrimSpace(c.Name); n != "" {
				live[n] = true
			}
		}
		markPrivacyDockerBucketsOrphanedByLiveNames(out, live)
	}
	return out, nil
}

// ListPrivacyDockerRemoteLogBuckets returns docker_remote log aggregates for one SSH profile.
func (a *App) ListPrivacyDockerRemoteLogBuckets(profileId string) ([]PrivacyDockerLogBucketDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return nil, errors.New("profileId required")
	}
	var prof storage.Profile
	if err := a.db.DB.First(&prof, "id = ?", profileId).Error; err != nil {
		return nil, err
	}
	var sources []storage.LogSource
	if err := a.db.DB.Where("kind = ? AND profile_id = ?", "docker_remote", profileId).Find(&sources).Error; err != nil {
		return nil, err
	}
	out, err := aggregatePrivacyDockerLogBuckets(a.db.DB, sources)
	if err != nil {
		return nil, err
	}
	if sid, err := a.DockerRemoteConnectProfile(profileId); err == nil {
		live := map[string]bool{}
		if containers, err := a.DockerRemoteListContainers(sid); err == nil {
			for _, c := range containers {
				if n := strings.TrimSpace(c.Name); n != "" {
					live[n] = true
				}
			}
			markPrivacyDockerBucketsOrphanedByLiveNames(out, live)
		}
		if a.ctx != nil {
			_ = a.DockerRemoteDisconnect(sid)
		}
	}
	return out, nil
}

// ListPrivacyDockerRemoteOrphanLogBuckets returns docker_remote aggregates for SSH profile IDs that no longer exist (deleted connections).
func (a *App) ListPrivacyDockerRemoteOrphanLogBuckets() ([]PrivacyDockerRemoteOrphanBucketDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	var sources []storage.LogSource
	q := a.db.DB.Where("kind = ?", "docker_remote").
		Where("NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = log_sources.profile_id)")
	if err := q.Find(&sources).Error; err != nil {
		return nil, err
	}
	return aggregatePrivacyDockerRemoteOrphanBuckets(a.db.DB, sources)
}

// PrivacyPurgeDockerLocalLogs deletes docker_local log sources and entries. Empty containerName purges all local Docker log data.
func (a *App) PrivacyPurgeDockerLocalLogs(containerName string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	q := a.db.DB.Where("kind = ?", "docker_local")
	if strings.TrimSpace(containerName) != "" {
		q = q.Where("container_name = ?", containerName)
	}
	var sources []storage.LogSource
	if err := q.Find(&sources).Error; err != nil {
		return err
	}
	for _, s := range sources {
		if err := a.DeleteLogSource(s.ID); err != nil {
			return err
		}
	}
	return nil
}

// PrivacyPurgeDockerRemoteLogs deletes docker_remote sources for an SSH profile; optional containerName limits to one container.
func (a *App) PrivacyPurgeDockerRemoteLogs(profileId string, containerName string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if strings.TrimSpace(profileId) == "" {
		return errors.New("profileId required")
	}
	q := a.db.DB.Where("kind = ? AND profile_id = ?", "docker_remote", profileId)
	if strings.TrimSpace(containerName) != "" {
		q = q.Where("container_name = ?", containerName)
	}
	var sources []storage.LogSource
	if err := q.Find(&sources).Error; err != nil {
		return err
	}
	for _, s := range sources {
		if err := a.DeleteLogSource(s.ID); err != nil {
			return err
		}
	}
	return nil
}
