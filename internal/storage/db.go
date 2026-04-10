package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Store struct {
	DB     *gorm.DB
	dbPath string
}

type OpenOptions struct {
	DBPath string
}

func Open(opts OpenOptions) (*Store, error) {
	dbPath := opts.DBPath
	if dbPath == "" {
		p, err := DefaultDBPath()
		if err != nil {
			return nil, err
		}
		dbPath = p
	}

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	s := &Store{DB: db, dbPath: dbPath}
	if err := s.Migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.DB == nil {
		return nil
	}
	sqlDB, err := s.DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func DefaultDBPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", errors.New("user config dir not found")
	}
	return filepath.Join(dir, "daimon", "daimon.db"), nil
}

func (s *Store) Path() string {
	if s == nil {
		return ""
	}
	return s.dbPath
}
