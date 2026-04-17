package main

import "testing"

func TestClassifyUserSQL(t *testing.T) {
	tests := []struct {
		sql  string
		want SQLStatementKind
	}{
		{"SELECT 1", SQLKindSelect},
		{"WITH x AS (SELECT 1) SELECT * FROM x", SQLKindSelect},
		{"WITH t AS (SELECT 1) DELETE FROM foo", SQLKindDelete},
		{"DELETE FROM bar WHERE id=1", SQLKindDelete},
		{"UPDATE t SET a=1 WHERE b=2", SQLKindUpdate},
		{"INSERT INTO t VALUES (1)", SQLKindInsert},
		{"DROP TABLE x", SQLKindDDL},
		{"TRUNCATE t", SQLKindDDL},
	}
	for _, tc := range tests {
		got := ClassifyUserSQL(tc.sql)
		if got != tc.want {
			t.Errorf("%q: got %v want %v", tc.sql, got, tc.want)
		}
	}
}
