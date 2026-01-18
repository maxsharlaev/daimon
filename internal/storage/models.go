package storage

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ProfileGroup struct {
	ID       string  `gorm:"primaryKey;size:36"`
	ParentID *string `gorm:"index;size:36"`

	Name  string `gorm:"not null"`
	Order int    `gorm:"not null;default:0"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *ProfileGroup) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type Profile struct {
	ID      string `gorm:"primaryKey;size:36"`
	GroupID string `gorm:"index;size:36;not null"`

	Name string `gorm:"not null"`

	Host     string `gorm:"not null"`
	Port     int    `gorm:"not null;default:22"`
	Username string `gorm:"not null"`

	SSHOptionsJSON string `gorm:"not null;default:'{}'"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *Profile) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

// UILayoutState stores arbitrary JSON state for UI (split sizes, expanded groups, open tabs, etc).
type UILayoutState struct {
	ID    string `gorm:"primaryKey;size:80"`
	Scope string `gorm:"uniqueIndex;size:120;not null"` // "app" or "profile:<id>"

	LayoutJSON string `gorm:"not null;default:'{}'"`

	UpdatedAt time.Time
}

// SecretRef stores how to retrieve a secret (never store plaintext in this table).
// storage: none | keyring | external | internal
// kind: password | private_key
type SecretRef struct {
	ID        string `gorm:"primaryKey;size:80"`
	ProfileID string `gorm:"index;size:36;not null"`

	Kind    string `gorm:"index;size:40;not null"`
	Storage string `gorm:"index;size:40;not null"`

	Ref      string `gorm:"not null;default:''"`
	MetaJSON string `gorm:"not null;default:'{}'"`

	UpdatedAt time.Time
}

func (m *SecretRef) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

// VaultItem stores encrypted secret blob for internal vault mode.
type VaultItem struct {
	ID        string `gorm:"primaryKey;size:80"`
	ProfileID string `gorm:"index;size:36;not null"`

	Kind string `gorm:"index;size:40;not null"`

	CipherB64   string `gorm:"not null"` // base64-encoded ciphertext
	KDFJSON     string `gorm:"not null;default:'{}'"`
	SaltB64     string `gorm:"not null;default:''"`
	NonceB64    string `gorm:"not null;default:''"`
	Hint        string `gorm:"not null;default:''"`
	UpdatedAt   time.Time
}

func (m *VaultItem) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

// AppSetting stores arbitrary extensible settings.
type AppSetting struct {
	Key       string `gorm:"primaryKey;size:120"`
	ValueJSON string `gorm:"not null;default:'{}'"`
	UpdatedAt time.Time
}

// Place stores a saved remote path ("place") for a profile.
// Used by the Places UI to quickly cd/open in terminal/files.
type Place struct {
	ID        string `gorm:"primaryKey;size:36"`
	ProfileID string `gorm:"index;size:36;not null"`

	Name       string `gorm:"not null;default:''"` // optional label
	RemotePath string `gorm:"not null"`
	Order      int    `gorm:"not null;default:0"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *Place) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

