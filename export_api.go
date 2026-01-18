package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"

	"daimon/internal/export"
	"daimon/internal/secrets"
	"daimon/internal/storage"
)

type ExportPayloadV1 struct {
	Profile storage.Profile `json:"profile"`
	Secrets map[string]secrets.SecretValue `json:"secrets"` // kind -> value
}

// ExportProfileEncrypted returns an encrypted JSON container (v1) containing profile + secrets.
func (a *App) ExportProfileEncrypted(profileId string, exportPassword string) (string, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return "", errors.New("app not ready")
	}
	if profileId == "" {
		return "", errors.New("profileId required")
	}
	if exportPassword == "" {
		return "", errors.New("export password required")
	}

	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}

	payload := ExportPayloadV1{
		Profile: p,
		Secrets: map[string]secrets.SecretValue{},
	}

	// password
	if val, mode, err := a.secrets.GetSecretValue(profileId, secrets.KindPassword); err == nil {
		if mode != secrets.StorageNone && strings.TrimSpace(val.Password) != "" {
			payload.Secrets[string(secrets.KindPassword)] = val
		}
	}

	// private key: for external file path, try to read file and embed PEM
	sr, err := a.secrets.GetSecretRef(profileId, secrets.KindPrivateKey)
	if err == nil {
		switch secrets.Storage(sr.Storage) {
		case secrets.StorageInternal:
			val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey)
			if err == nil && strings.TrimSpace(val.PrivateKeyPEM) != "" {
				payload.Secrets[string(secrets.KindPrivateKey)] = val
			}
		case secrets.StorageKeyring:
			val, _, err := a.secrets.GetSecretValue(profileId, secrets.KindPrivateKey)
			if err == nil && strings.TrimSpace(val.PrivateKeyPEM) != "" {
				payload.Secrets[string(secrets.KindPrivateKey)] = val
			}
		case secrets.StorageExternal:
			path := strings.TrimSpace(sr.Ref)
			if path != "" {
				if b, rerr := os.ReadFile(path); rerr == nil {
					payload.Secrets[string(secrets.KindPrivateKey)] = secrets.SecretValue{
						PrivateKeyPEM: string(b),
					}
				}
			}
		}
	}

	c, err := export.EncryptPayload(exportPassword, payload)
	if err != nil {
		return "", err
	}
	return export.MarshalContainer(c)
}

type ImportOptions struct {
	GroupID string `json:"groupId,omitempty"`

	PasswordStorage string `json:"passwordStorage"` // none|keyring|internal
	KeyStorage      string `json:"keyStorage"`      // none|keyring|internal|external (external will be ignored here)
}

// ImportProfileEncrypted imports an encrypted JSON container.
// It creates a new profile (in given group) and stores secrets according to ImportOptions.
func (a *App) ImportProfileEncrypted(containerJSON string, exportPassword string, opts ImportOptions) (ProfileDTO, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return ProfileDTO{}, errors.New("app not ready")
	}
	if exportPassword == "" {
		return ProfileDTO{}, errors.New("export password required")
	}
	if opts.PasswordStorage == "" {
		opts.PasswordStorage = string(secrets.StorageNone)
	}
	if opts.KeyStorage == "" {
		opts.KeyStorage = string(secrets.StorageNone)
	}

	c, err := export.UnmarshalContainer(containerJSON)
	if err != nil {
		return ProfileDTO{}, err
	}
	var payload ExportPayloadV1
	if err := export.DecryptPayload(exportPassword, c, &payload); err != nil {
		return ProfileDTO{}, err
	}

	// insert profile with new ID
	p := payload.Profile
	p.ID = ""
	if opts.GroupID != "" {
		p.GroupID = opts.GroupID
	}
	if p.GroupID == "" {
		// ensure default group exists
		g, _ := a.EnsureDefaultGroup()
		if g != nil {
			p.GroupID = g.ID
		}
	}
	p.Name = p.Name + " (imported)"

	if err := a.db.DB.Create(&p).Error; err != nil {
		return ProfileDTO{}, err
	}

	// store secrets according to opts
	if sv, ok := payload.Secrets[string(secrets.KindPassword)]; ok {
		_ = a.secrets.PutSecretValue(p.ID, secrets.KindPassword, secrets.Storage(opts.PasswordStorage), "", sv, "{}")
	}
	if sv, ok := payload.Secrets[string(secrets.KindPrivateKey)]; ok {
		_ = a.secrets.PutSecretValue(p.ID, secrets.KindPrivateKey, secrets.Storage(opts.KeyStorage), "", sv, "{}")
	}

	return mapProfile(p), nil
}

// helper to appease wails bindings (avoid gorm model exposure)
func (a *App) ExportProfileEncryptedPreview(profileId string) (string, error) {
	if a.db == nil || a.db.DB == nil {
		return "", errors.New("app not ready")
	}
	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileId).Error; err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(p, "", "  ")
	return string(b), nil
}

