package secrets

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"daimon/internal/storage"
	"gorm.io/gorm"
)

type Router struct {
	db      *gorm.DB
	keyring *KeyringStore
	vault   *Vault
}

// maxKeyringPayloadLen is a conservative limit for OS keychain entries (e.g. Windows Credential
// Manager ~2.5KB blob). PEM private keys as JSON almost always exceed this.
const maxKeyringPayloadLen = 2000

func NewRouter(db *gorm.DB) *Router {
	return &Router{
		db:      db,
		keyring: NewKeyringStore("daimon"),
		vault:   NewVault(db),
	}
}

func isKeyringTooBigError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "too big") || strings.Contains(s, "too large") || strings.Contains(s, "credential blob")
}

func (r *Router) putPrivateKeyKeyringOrVault(profileID string, val SecretValue, metaJSON string) error {
	payload, err := encodeSecretValue(val)
	if err != nil {
		return err
	}
	if len(payload) <= maxKeyringPayloadLen {
		if err := r.keyring.Set(profileID, KindPrivateKey, payload); err != nil {
			if r.vault.IsUnlocked() && isKeyringTooBigError(err) {
				return r.putPrivateKeyVaultOnly(profileID, val, metaJSON)
			}
			return err
		}
		_ = r.vault.Delete(profileID, KindPrivateKey)
		return r.SetSecretRef(profileID, KindPrivateKey, StorageKeyring, "keyring:"+r.keyring.Key(profileID, KindPrivateKey), metaJSON)
	}
	if r.vault.IsUnlocked() {
		return r.putPrivateKeyVaultOnly(profileID, val, metaJSON)
	}
	return fmt.Errorf("private key is too large for the OS keyring (~%d byte limit). Unlock Internal vault and choose Internal storage, or use an external key file", maxKeyringPayloadLen)
}

func (r *Router) putPrivateKeyVaultOnly(profileID string, val SecretValue, metaJSON string) error {
	if err := r.vault.Put(profileID, KindPrivateKey, val, ""); err != nil {
		return err
	}
	_ = r.keyring.Delete(profileID, KindPrivateKey)
	return r.SetSecretRef(profileID, KindPrivateKey, StorageInternal, "vault:"+profileID+":"+string(KindPrivateKey), metaJSON)
}

func (r *Router) Vault() *Vault {
	return r.vault
}

func (r *Router) SetSecretRef(profileID string, kind Kind, storageMode Storage, ref string, metaJSON string) error {
	if profileID == "" {
		return errors.New("profileId required")
	}
	if metaJSON == "" {
		metaJSON = "{}"
	}

	var existing storage.SecretRef
	err := r.db.First(&existing, "profile_id = ? AND kind = ?", profileID, string(kind)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		item := storage.SecretRef{
			ProfileID: profileID,
			Kind:      string(kind),
			Storage:   string(storageMode),
			Ref:       ref,
			MetaJSON:  metaJSON,
		}
		return r.db.Create(&item).Error
	}
	if err != nil {
		return err
	}
	existing.Storage = string(storageMode)
	existing.Ref = ref
	existing.MetaJSON = metaJSON
	return r.db.Save(&existing).Error
}

func (r *Router) GetSecretRef(profileID string, kind Kind) (storage.SecretRef, error) {
	var sr storage.SecretRef
	err := r.db.First(&sr, "profile_id = ? AND kind = ?", profileID, string(kind)).Error
	return sr, err
}

func (r *Router) GetSecretValue(profileID string, kind Kind) (SecretValue, Storage, error) {
	sr, err := r.GetSecretRef(profileID, kind)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return SecretValue{}, StorageNone, nil
	}
	if err != nil {
		return SecretValue{}, StorageNone, err
	}
	mode := Storage(sr.Storage)
	switch mode {
	case StorageNone:
		return SecretValue{}, StorageNone, nil
	case StorageKeyring:
		secret, err := r.keyring.Get(profileID, kind)
		if err != nil {
			return SecretValue{}, mode, err
		}
		if kind == KindPassword || kind == KindAIAPIKey || kind == KindDataSourcePassword {
			return SecretValue{Password: secret}, mode, nil
		}
		// For private key, store JSON in keyring to keep passphrase too
		return decodeSecretValue(secret)
	case StorageInternal:
		val, err := r.vault.Get(profileID, kind)
		return val, mode, err
	case StorageExternal:
		// external refs resolved by caller (file path, agent, etc.)
		if kind == KindPrivateKey {
			// Optional: store passphrase in keyring (without storing key material).
			// This allows encrypted OpenSSH/PPK keys to work while keeping the key on disk.
			if secret, err := r.keyring.Get(profileID, kind); err == nil && secret != "" {
				if v, _, derr := decodeSecretValue(secret); derr == nil {
					return SecretValue{PrivateKeyPEM: "", Passphrase: v.Passphrase}, mode, nil
				}
			}
			return SecretValue{PrivateKeyPEM: "", Passphrase: ""}, mode, nil
		}
		return SecretValue{}, mode, nil
	default:
		return SecretValue{}, mode, fmt.Errorf("unknown storage mode: %s", sr.Storage)
	}
}

func (r *Router) PutSecretValue(profileID string, kind Kind, storageMode Storage, ref string, val SecretValue, metaJSON string) error {
	switch storageMode {
	case StorageNone:
		// clear any stored secrets
		_ = r.keyring.Delete(profileID, kind)
		_ = r.vault.Delete(profileID, kind)
		return r.SetSecretRef(profileID, kind, storageMode, "", metaJSON)
	case StorageKeyring:
		if kind == KindPrivateKey {
			return r.putPrivateKeyKeyringOrVault(profileID, val, metaJSON)
		}
		var payload string
		if kind == KindPassword || kind == KindAIAPIKey || kind == KindDataSourcePassword {
			payload = val.Password
		} else {
			p, err := encodeSecretValue(val)
			if err != nil {
				return err
			}
			payload = p
		}
		if err := r.keyring.Set(profileID, kind, payload); err != nil {
			return err
		}
		_ = r.vault.Delete(profileID, kind)
		return r.SetSecretRef(profileID, kind, storageMode, "keyring:"+r.keyring.Key(profileID, kind), metaJSON)
	case StorageInternal:
		if err := r.vault.Put(profileID, kind, val, ""); err != nil {
			return err
		}
		_ = r.keyring.Delete(profileID, kind)
		return r.SetSecretRef(profileID, kind, storageMode, "vault:"+profileID+":"+string(kind), metaJSON)
	case StorageExternal:
		// just store reference (e.g. key path or "ssh-agent")
		// For private key external path, we optionally keep passphrase in keyring.
		if kind == KindPrivateKey {
			if val.Passphrase != "" {
				payload, err := encodeSecretValue(SecretValue{Passphrase: val.Passphrase})
				if err != nil {
					return err
				}
				if err := r.keyring.Set(profileID, kind, payload); err != nil {
					return err
				}
			} else {
				_ = r.keyring.Delete(profileID, kind)
			}
		} else {
			_ = r.keyring.Delete(profileID, kind)
		}
		_ = r.vault.Delete(profileID, kind)
		return r.SetSecretRef(profileID, kind, storageMode, ref, metaJSON)
	default:
		return fmt.Errorf("unknown storage mode: %s", storageMode)
	}
}

func encodeSecretValue(v SecretValue) (string, error) {
	// store as JSON for flexible expansion
	b, err := jsonMarshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func decodeSecretValue(s string) (SecretValue, Storage, error) {
	var v SecretValue
	if err := jsonUnmarshal([]byte(s), &v); err != nil {
		return SecretValue{}, StorageKeyring, err
	}
	return v, StorageKeyring, nil
}

// small wrappers (avoid pulling encoding/json here if you want to swap later)
func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

