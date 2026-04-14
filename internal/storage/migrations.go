package storage

import (
	"fmt"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func (s *Store) Migrate() error {
	if s == nil || s.DB == nil {
		return fmt.Errorf("store not initialized")
	}

	m := gormigrate.New(s.DB, gormigrate.DefaultOptions, []*gormigrate.Migration{
		{
			ID: "2026-01-18-0001-init",
			Migrate: func(tx *gorm.DB) error {
				if err := tx.AutoMigrate(
					&ProfileGroup{},
					&Profile{},
					&UILayoutState{},
					&SecretRef{},
					&VaultItem{},
					&AppSetting{},
				); err != nil {
					return err
				}
				return nil
			},
			Rollback: func(tx *gorm.DB) error {
				// MVP: no rollback
				return nil
			},
		},
		{
			ID: "2026-01-18-0002-places",
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&Place{})
			},
			Rollback: func(tx *gorm.DB) error {
				return nil
			},
		},
		{
			ID: "2026-01-19-0003-macros",
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&Macro{},
					&MacroDataItem{},
					&MacroParam{},
					&MacroBinding{},
				)
			},
			Rollback: func(tx *gorm.DB) error {
				return nil
			},
		},
		{
			ID: "2026-04-10-0004-logs",
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&LogFormat{},
					&LogSource{},
					&LogEntry{},
				)
			},
			Rollback: func(tx *gorm.DB) error {
				return nil
			},
		},
		{
			ID: "2026-04-11-0005-place-profile-id-length",
			Migrate: func(tx *gorm.DB) error {
				// Widen profile_id so Docker composite Place keys are not truncated.
				return tx.AutoMigrate(&Place{})
			},
			Rollback: func(tx *gorm.DB) error {
				return nil
			},
		},
		{
			ID: "2026-04-12-0006-ai",
			Migrate: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&AiConversation{},
					&AiMessage{},
					&AiUsageEvent{},
				)
			},
			Rollback: func(tx *gorm.DB) error {
				return nil
			},
		},
		{
			ID: "2026-04-14-0007-ai-usage-devlog-fields",
			Migrate: func(tx *gorm.DB) error {
				// Add usage dimensions for developer diagnostics and AI logs UI.
				return tx.AutoMigrate(&AiUsageEvent{})
			},
			Rollback: func(tx *gorm.DB) error {
				return nil
			},
		},
	})

	return m.Migrate()
}
