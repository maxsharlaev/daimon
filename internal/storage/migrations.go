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
	})

	return m.Migrate()
}

