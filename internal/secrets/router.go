package secrets

import (
	"encoding/json"
	"errors"
	"fmt"

	"daimon/internal/storage"
	"gorm.io/gorm"
)

type Router struct {
	db      *gorm.DB
	keyring *KeyringStore
	vault   *Vault
}

func NewRouter(db *gorm.DB) *Router {
	return &Router{
		db:      db,
		keyring: NewKeyringStore("daimon"),
		vault:   NewVault(db),
	}
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
		if kind == KindPassword {
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
		var payload string
		if kind == KindPassword {
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
		_ = r.keyring.Delete(profileID, kind)
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

