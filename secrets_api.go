package main

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"daimon/internal/secrets"
	"daimon/internal/storage"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type VaultStatusDTO struct {
	Setup    bool `json:"setup"`
	Unlocked bool `json:"unlocked"`
}

type SecretRefDTO struct {
	ProfileID string `json:"profileId"`
	Kind      string `json:"kind"`    // password | private_key
	Storage   string `json:"storage"` // none | keyring | external | internal
	Ref       string `json:"ref"`
	MetaJSON  string `json:"metaJson"`
}

type SecretItemDTO struct {
	ProfileID string `json:"profileId"`
	Key       string `json:"key"`
	Storage   string `json:"storage"`
	MetaJSON  string `json:"metaJson"`
	UpdatedAt int64  `json:"updatedAt"`
}

type SetSecretRequest struct {
	ProfileID string `json:"profileId"`
	Kind      string `json:"kind"`
	Storage   string `json:"storage"`
	Ref       string `json:"ref,omitempty"`
	MetaJSON  string `json:"metaJson,omitempty"`

	// For password
	Password string `json:"password,omitempty"`

	// For private key
	PrivateKeyPEM string `json:"privateKeyPem,omitempty"`
	Passphrase    string `json:"passphrase,omitempty"`
}

type UpsertSecretRequest struct {
	ProfileID string `json:"profileId"`
	Key       string `json:"key"`
	Storage   string `json:"storage"`
	Value     string `json:"value"`
	MetaJSON  string `json:"metaJson,omitempty"`
}

const customSecretPrefix = "custom:"

func (a *App) VaultStatus() (VaultStatusDTO, error) {
	if a.secrets == nil {
		return VaultStatusDTO{}, errors.New("secrets not ready")
	}
	st, err := a.secrets.Vault().Status()
	if err != nil {
		return VaultStatusDTO{}, err
	}
	return VaultStatusDTO{Setup: st.Setup, Unlocked: st.Unlocked}, nil
}

func (a *App) VaultSetup(masterPassword string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	return a.secrets.Vault().Setup(masterPassword)
}

func (a *App) VaultUnlock(masterPassword string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	return a.secrets.Vault().Unlock(masterPassword)
}

func (a *App) VaultLock() error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	a.secrets.Vault().Lock()
	return nil
}

func (a *App) GetSecretRef(profileId string, kind string) (SecretRefDTO, error) {
	if a.secrets == nil {
		return SecretRefDTO{}, errors.New("secrets not ready")
	}
	if profileId == "" {
		return SecretRefDTO{}, errors.New("profileId required")
	}
	k := secrets.Kind(kind)
	sr, err := a.secrets.GetSecretRef(profileId, k)
	if err != nil {
		return SecretRefDTO{}, err
	}
	return SecretRefDTO{
		ProfileID: sr.ProfileID,
		Kind:      sr.Kind,
		Storage:   sr.Storage,
		Ref:       sr.Ref,
		MetaJSON:  sr.MetaJSON,
	}, nil
}

func (a *App) SetSecret(req SetSecretRequest) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	if req.ProfileID == "" {
		return errors.New("profileId required")
	}
	if req.Kind == "" {
		return errors.New("kind required")
	}
	mode := secrets.Storage(req.Storage)
	k := secrets.Kind(req.Kind)

	val := secrets.SecretValue{
		Password:      req.Password,
		PrivateKeyPEM: req.PrivateKeyPEM,
		Passphrase:    req.Passphrase,
	}

	switch k {
	case secrets.KindPassword:
		if mode != secrets.StorageNone && mode != secrets.StorageKeyring && mode != secrets.StorageInternal {
			return fmt.Errorf("unsupported storage for password: %s", req.Storage)
		}
	case secrets.KindPrivateKey:
		// allow external for key path, plus internal/keyring/none
		if mode != secrets.StorageNone && mode != secrets.StorageKeyring && mode != secrets.StorageInternal && mode != secrets.StorageExternal {
			return fmt.Errorf("unsupported storage for private_key: %s", req.Storage)
		}
	default:
		return fmt.Errorf("unknown kind: %s", req.Kind)
	}

	return a.secrets.PutSecretValue(req.ProfileID, k, mode, req.Ref, val, req.MetaJSON)
}

func (a *App) ListSecrets(profileId string) ([]SecretItemDTO, error) {
	if a.secrets == nil || a.db == nil || a.db.DB == nil {
		return nil, errors.New("secrets not ready")
	}
	if profileId == "" {
		return nil, errors.New("profileId required")
	}
	var refs []storage.SecretRef
	if err := a.db.DB.
		Where("profile_id = ? AND kind LIKE ? AND storage != ?", profileId, customSecretPrefix+"%", string(secrets.StorageNone)).
		Order("updated_at DESC").
		Find(&refs).Error; err != nil {
		return nil, err
	}
	out := make([]SecretItemDTO, 0, len(refs))
	for _, r := range refs {
		key := strings.TrimPrefix(r.Kind, customSecretPrefix)
		if key == "" {
			continue
		}
		out = append(out, SecretItemDTO{
			ProfileID: r.ProfileID,
			Key:       key,
			Storage:   r.Storage,
			MetaJSON:  r.MetaJSON,
			UpdatedAt: r.UpdatedAt.Unix(),
		})
	}
	return out, nil
}

func (a *App) UpsertSecret(req UpsertSecretRequest) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	if req.ProfileID == "" {
		return errors.New("profileId required")
	}
	key := strings.TrimSpace(req.Key)
	if key == "" {
		return errors.New("key required")
	}
	// Enforce length to fit SecretRef.Kind (size 40).
	if len(customSecretPrefix)+len(key) > 40 {
		return fmt.Errorf("key too long (max %d chars)", 40-len(customSecretPrefix))
	}
	mode := secrets.Storage(req.Storage)
	if mode != secrets.StorageNone && mode != secrets.StorageKeyring && mode != secrets.StorageInternal {
		return fmt.Errorf("unsupported storage for secret: %s", req.Storage)
	}

	meta := req.MetaJSON
	if strings.TrimSpace(meta) == "" {
		meta = "{}"
	}
	kind := secrets.Kind(customSecretPrefix + key)
	val := secrets.SecretValue{Password: req.Value}
	return a.secrets.PutSecretValue(req.ProfileID, kind, mode, "", val, meta)
}

func (a *App) DeleteSecret(profileId string, key string) error {
	if a.secrets == nil || a.db == nil || a.db.DB == nil {
		return errors.New("secrets not ready")
	}
	if profileId == "" {
		return errors.New("profileId required")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("key required")
	}
	kind := secrets.Kind(customSecretPrefix + key)
	// Clear any stored values first.
	_ = a.secrets.PutSecretValue(profileId, kind, secrets.StorageNone, "", secrets.SecretValue{}, "{}")
	// Remove reference row to avoid listing.
	return a.db.DB.Where("profile_id = ? AND kind = ?", profileId, string(kind)).Delete(&storage.SecretRef{}).Error
}

func (a *App) CopySecretToClipboard(profileId string, key string) error {
	if a.secrets == nil {
		return errors.New("secrets not ready")
	}
	if a.ctx == nil {
		return errors.New("app context not ready")
	}
	if profileId == "" {
		return errors.New("profileId required")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("key required")
	}
	kind := secrets.Kind(customSecretPrefix + key)
	val, _, err := a.secrets.GetSecretValue(profileId, kind)
	if err != nil {
		return err
	}
	if val.Password == "" {
		return errors.New("secret value is empty")
	}
	if err := runtime.ClipboardSetText(a.ctx, val.Password); err != nil {
		return err
	}
	// Best-effort clipboard clear after ~20s.
	time.AfterFunc(20*time.Second, func() {
		_ = runtime.ClipboardSetText(a.ctx, "")
	})
	return nil
}