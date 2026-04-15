package storage

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const dataSourcesTable = "data_sources"

// RepairDataSourcesTable fixes SQLite tables created with an incomplete schema (e.g. missing `name`)
// so AutoMigrate could not alter in place. SQLite rejects NOT NULL ADD COLUMN without a row default;
// GORM's AddColumn can emit that, so we use explicit ALTER TABLE ... DEFAULT ... here.
func RepairDataSourcesTable(tx *gorm.DB) error {
	ds := &DataSource{}
	if !tx.Migrator().HasTable(ds) {
		return tx.AutoMigrate(ds)
	}

	hasCol := func(col string) (bool, error) {
		var n int64
		// Table name is a fixed constant; pragma expects a literal table name.
		q := fmt.Sprintf(
			"SELECT COUNT(*) FROM pragma_table_info('%s') WHERE LOWER(name) = ?",
			dataSourcesTable,
		)
		err := tx.Raw(q, strings.ToLower(col)).Scan(&n).Error
		if err != nil {
			return false, err
		}
		return n > 0, nil
	}

	// Column SQL fragments after "ADD COLUMN" — must include DEFAULT for NOT NULL when table has rows.
	type addSpec struct {
		pragmaName string // pragma_table_info name (snake_case)
		ddl        string // full "colname TYPE ... DEFAULT ..."
	}
	specs := []addSpec{
		{"name", `name TEXT NOT NULL DEFAULT ''`},
		{"engine", `engine TEXT NOT NULL DEFAULT 'postgres'`},
		{"host", `host TEXT NOT NULL DEFAULT '127.0.0.1'`},
		{"port", `port INTEGER NOT NULL DEFAULT 5432`},
		{"username", `username TEXT NOT NULL DEFAULT ''`},
		{"database", `"database" TEXT NOT NULL DEFAULT ''`},
		{"scope_json", `scope_json TEXT NOT NULL DEFAULT '{}'`},
		{"ssh_profile_id", `ssh_profile_id TEXT NOT NULL DEFAULT ''`},
		{"remote_port", `remote_port INTEGER NOT NULL DEFAULT 0`},
		{"created_at", `created_at DATETIME NOT NULL DEFAULT (datetime('now'))`},
		{"updated_at", `updated_at DATETIME NOT NULL DEFAULT (datetime('now'))`},
	}

	for _, s := range specs {
		ok, err := hasCol(s.pragmaName)
		if err != nil {
			return err
		}
		if ok {
			continue
		}
		stmt := fmt.Sprintf("ALTER TABLE %q ADD COLUMN %s", dataSourcesTable, s.ddl)
		if err := tx.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return tx.AutoMigrate(ds)
}
