package main

import "strings"

// buildExplainSQL wraps user SQL in EXPLAIN for the given engine.
func buildExplainSQL(engine, userSQL string, analyze bool) string {
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(userSQL), ";"))
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "postgres":
		if analyze {
			return "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + inner
		}
		return "EXPLAIN (FORMAT TEXT) " + inner
	case "mysql":
		if analyze {
			// MySQL 8.0.18+
			return "EXPLAIN ANALYZE " + inner
		}
		return "EXPLAIN " + inner
	default:
		return "EXPLAIN " + inner
	}
}
