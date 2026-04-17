package main

import (
	"regexp"
	"strings"
)

// SQLStatementKind classifies the outer statement for routing (read vs mutate vs ddl).
type SQLStatementKind int

const (
	SQLKindSelect SQLStatementKind = iota
	SQLKindDelete
	SQLKindUpdate
	SQLKindInsert
	SQLKindDDL
	SQLKindOther
)

// withThenMutation matches WITH ... ( ) DELETE/UPDATE/INSERT as the main command.
var withThenMutation = regexp.MustCompile(`(?is)\)\s*(delete|update|insert)\b`)

// ClassifyUserSQL returns a coarse kind based on the first significant keyword.
func ClassifyUserSQL(sqlText string) SQLStatementKind {
	s := strings.TrimSpace(sqlText)
	s = strings.TrimSuffix(s, ";")
	s = strings.TrimSpace(s)
	if s == "" {
		return SQLKindOther
	}
	// Strip leading line comments (-- ...)
	for {
		low := strings.ToLower(s)
		if strings.HasPrefix(low, "--") {
			if nl := strings.IndexByte(s, '\n'); nl >= 0 {
				s = strings.TrimSpace(s[nl+1:])
				continue
			}
			return SQLKindOther
		}
		if strings.HasPrefix(low, "/*") {
			end := strings.Index(s, "*/")
			if end < 0 {
				break
			}
			s = strings.TrimSpace(s[end+2:])
			continue
		}
		break
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return SQLKindOther
	}
	low := strings.ToLower(s)
	switch {
	case strings.HasPrefix(low, "select"):
		return SQLKindSelect
	case strings.HasPrefix(low, "with"):
		if withThenMutation.MatchString(s) {
			if strings.Contains(low, "delete") {
				return SQLKindDelete
			}
			if strings.Contains(low, "update") {
				return SQLKindUpdate
			}
			return SQLKindInsert
		}
		return SQLKindSelect
	case strings.HasPrefix(low, "delete"):
		return SQLKindDelete
	case strings.HasPrefix(low, "update"):
		return SQLKindUpdate
	case strings.HasPrefix(low, "insert"):
		return SQLKindInsert
	case strings.HasPrefix(low, "drop"), strings.HasPrefix(low, "truncate"),
		strings.HasPrefix(low, "alter"), strings.HasPrefix(low, "create"),
		strings.HasPrefix(low, "grant"), strings.HasPrefix(low, "revoke"):
		return SQLKindDDL
	default:
		return SQLKindOther
	}
}

// isSelectLikeSQL is true when the statement should use read/paging paths (SELECT and WITH...SELECT).
func isSelectLikeSQL(s string) bool {
	k := ClassifyUserSQL(s)
	return k == SQLKindSelect
}
