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

	CipherB64 string `gorm:"not null"` // base64-encoded ciphertext
	KDFJSON   string `gorm:"not null;default:'{}'"`
	SaltB64   string `gorm:"not null;default:''"`
	NonceB64  string `gorm:"not null;default:''"`
	Hint      string `gorm:"not null;default:''"`
	UpdatedAt time.Time
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
	// Composite docker keys exceed 36 chars (e.g. docker:remote:<uuid>:name:<container>).
	ProfileID string `gorm:"index;size:512;not null"`

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

// Macro is a reusable script with tags and parameterized content.
type Macro struct {
	ID string `gorm:"primaryKey;size:36"`

	Name     string `gorm:"not null"`
	TagsJSON string `gorm:"not null;default:'[]'"`
	Script   string `gorm:"not null;default:''"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *Macro) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type MacroDataItem struct {
	ID      string `gorm:"primaryKey;size:36"`
	MacroID string `gorm:"index;size:36;not null"`

	Key   string `gorm:"not null"`
	Value string `gorm:"not null;default:''"`
	Order int    `gorm:"not null;default:0"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *MacroDataItem) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type MacroParam struct {
	ID      string `gorm:"primaryKey;size:36"`
	MacroID string `gorm:"index;size:36;not null"`

	Name   string `gorm:"not null"`
	Prompt string `gorm:"not null;default:''"`
	Order  int    `gorm:"not null;default:0"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *MacroParam) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type MacroBinding struct {
	ID        string `gorm:"primaryKey;size:36"`
	ProfileID string `gorm:"index;size:36;not null;uniqueIndex:idx_macro_binding"`
	MacroID   string `gorm:"index;size:36;not null;uniqueIndex:idx_macro_binding"`

	IsFavorite bool `gorm:"not null;default:false"`
	Enabled    bool `gorm:"not null;default:true"`

	UpdatedAt time.Time
}

func (m *MacroBinding) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type LogFormat struct {
	ID string `gorm:"primaryKey;size:80"`

	Name        string `gorm:"not null"`
	Description string `gorm:"not null;default:''"`
	BuiltinKey  string `gorm:"uniqueIndex;size:80;not null;default:''"`
	ParserType  string `gorm:"index;size:24;not null;default:'regex'"`
	Pattern     string `gorm:"not null;default:''"`
	TimeLayout  string `gorm:"not null;default:''"`

	CaptureGroupsJSON string `gorm:"not null;default:'{}'"`
	LevelMappingJSON  string `gorm:"not null;default:'{}'"`

	IsSystem bool `gorm:"not null;default:false"`
	Enabled  bool `gorm:"not null;default:true"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *LogFormat) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type LogSource struct {
	ID string `gorm:"primaryKey;size:80"`

	Kind string `gorm:"index;size:32;not null"` // profile | docker_local | docker_remote

	ProfileID     string `gorm:"index;size:36;not null;default:''"`
	ContainerName string `gorm:"index;size:160;not null;default:''"`

	Path     string `gorm:"not null"`
	FormatID string `gorm:"index;size:80;not null"`

	DisplayName  string `gorm:"not null;default:''"`
	OptionsJSON  string `gorm:"not null;default:'{}'"`
	LastError    string `gorm:"not null;default:''"`
	LastSyncedAt *time.Time
	Enabled      bool `gorm:"not null;default:true"`
	Order        int  `gorm:"not null;default:0"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (m *LogSource) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}

type LogEntry struct {
	ID string `gorm:"primaryKey;size:80"`

	SourceID string `gorm:"index;size:80;not null"`
	Kind     string `gorm:"index;size:32;not null"`

	ProfileID     string `gorm:"index;size:36;not null;default:''"`
	ContainerName string `gorm:"index;size:160;not null;default:''"`
	SourcePath    string `gorm:"not null;default:''"`

	TimestampUnixMs int64  `gorm:"index;not null;default:0"`
	IngestedUnixMs  int64  `gorm:"index;not null;default:0"`
	TimestampSource string `gorm:"size:24;not null;default:'unknown'"` // parsed | ingest_time

	Level       string `gorm:"index;size:24;not null;default:'unknown'"`
	LevelSource string `gorm:"size:24;not null;default:'unknown'"` // parsed | guessed | unknown

	Message string `gorm:"not null;default:''"`
	RawText string `gorm:"not null;default:''"`

	DedupeKey string `gorm:"uniqueIndex;size:120;not null"`
	MetaJSON  string `gorm:"not null;default:'{}'"`

	CreatedAt time.Time
}

func (m *LogEntry) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.NewString()
	}
	return nil
}
