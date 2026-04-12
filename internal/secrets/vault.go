package secrets

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"daimon/internal/storage"
	"gorm.io/gorm"
)

// Vault keeps derived master key in memory (unlocked) and encrypts/decrypts vault items stored in SQLite.
type Vault struct {
	mu sync.Mutex

	db *gorm.DB

	// unlocked state
	unlocked bool
	key      []byte

	// kdf settings
	kdf KDFParams
	// salt stored in AppSetting "vault:salt"
	salt []byte
}

func NewVault(db *gorm.DB) *Vault {
	return &Vault{db: db, kdf: DefaultKDFParams()}
}

type VaultStatus struct {
	Setup    bool `json:"setup"`
	Unlocked bool `json:"unlocked"`
}

func (v *Vault) Status() (VaultStatus, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	salt, err := v.loadSalt()
	if err != nil {
		return VaultStatus{}, err
	}
	return VaultStatus{Setup: len(salt) > 0, Unlocked: v.unlocked}, nil
}

func (v *Vault) Setup(masterPassword string) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	if masterPassword == "" {
		return errors.New("master password required")
	}
	if v.db == nil {
		return errors.New("db not ready")
	}
	// if already setup, refuse
	salt, err := v.loadSalt()
	if err != nil {
		return err
	}
	if len(salt) > 0 {
		return errors.New("vault already set up")
	}

	salt, err = RandomBytes(16)
	if err != nil {
		return err
	}
	if err := v.saveSalt(salt); err != nil {
		return err
	}
	key, err := DeriveKey(masterPassword, salt, v.kdf)
	if err != nil {
		return err
	}
	v.salt = salt
	v.key = key
	v.unlocked = true
	return nil
}

func (v *Vault) Unlock(masterPassword string) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	if masterPassword == "" {
		return errors.New("master password required")
	}
	salt, err := v.loadSalt()
	if err != nil {
		return err
	}
	if len(salt) == 0 {
		return errors.New("vault not set up")
	}
	key, err := DeriveKey(masterPassword, salt, v.kdf)
	if err != nil {
		return err
	}
	// Optionally: verify password by decrypting a sentinel. MVP skips sentinel, assumes correct until decrypt fails later.
	v.salt = salt
	v.key = key
	v.unlocked = true
	return nil
}

func (v *Vault) Lock() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.unlocked = false
	v.key = nil
}

// IsUnlocked reports whether the vault currently holds a derived key (safe for Router to branch on).
func (v *Vault) IsUnlocked() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.unlocked && len(v.key) > 0
}

func (v *Vault) Put(profileID string, kind Kind, val SecretValue, hint string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.unlocked || len(v.key) == 0 {
		return errors.New("vault locked")
	}
	if profileID == "" {
		return errors.New("profileId required")
	}

	// encrypt payload
	cipherB64, nonceB64, err := EncryptJSON(v.key, val)
	if err != nil {
		return err
	}
	kdfJSON, _ := json.Marshal(v.kdf)
	item := storage.VaultItem{
		ProfileID:  profileID,
		Kind:       string(kind),
		CipherB64:  cipherB64,
		KDFJSON:    string(kdfJSON),
		SaltB64:    base64.StdEncoding.EncodeToString(v.salt),
		NonceB64:   nonceB64,
		Hint:       hint,
	}

	// upsert by profile+kind
	var existing storage.VaultItem
	err = v.db.First(&existing, "profile_id = ? AND kind = ?", profileID, string(kind)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return v.db.Create(&item).Error
	}
	if err != nil {
		return err
	}
	existing.CipherB64 = item.CipherB64
	existing.KDFJSON = item.KDFJSON
	existing.SaltB64 = item.SaltB64
	existing.NonceB64 = item.NonceB64
	existing.Hint = item.Hint
	return v.db.Save(&existing).Error
}

func (v *Vault) Get(profileID string, kind Kind) (SecretValue, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.unlocked || len(v.key) == 0 {
		return SecretValue{}, errors.New("vault locked")
	}
	var item storage.VaultItem
	if err := v.db.First(&item, "profile_id = ? AND kind = ?", profileID, string(kind)).Error; err != nil {
		return SecretValue{}, err
	}
	var out SecretValue
	if err := DecryptJSON(v.key, item.CipherB64, item.NonceB64, &out); err != nil {
		return SecretValue{}, fmt.Errorf("decrypt failed: %w", err)
	}
	return out, nil
}

func (v *Vault) Delete(profileID string, kind Kind) error {
	if profileID == "" {
		return errors.New("profileId required")
	}
	return v.db.Where("profile_id = ? AND kind = ?", profileID, string(kind)).Delete(&storage.VaultItem{}).Error
}

func (v *Vault) loadSalt() ([]byte, error) {
	if v.salt != nil {
		return v.salt, nil
	}
	var st storage.AppSetting
	err := v.db.First(&st, "key = ?", "vault:salt").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if st.ValueJSON == "" {
		return nil, nil
	}
	salt, err := base64.StdEncoding.DecodeString(st.ValueJSON)
	if err != nil {
		return nil, err
	}
	v.salt = salt
	return salt, nil
}

func (v *Vault) saveSalt(salt []byte) error {
	b64 := base64.StdEncoding.EncodeToString(salt)
	var st storage.AppSetting
	err := v.db.First(&st, "key = ?", "vault:salt").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		st = storage.AppSetting{Key: "vault:salt", ValueJSON: b64}
		return v.db.Create(&st).Error
	}
	if err != nil {
		return err
	}
	st.ValueJSON = b64
	return v.db.Save(&st).Error
}

