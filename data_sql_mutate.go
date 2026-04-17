package main

import (
	"fmt"
	"regexp"
	"strings"
)

const mutationPreviewSampleLimit = 200

// reDeleteSingleTable matches a single-table DELETE with optional WHERE (no USING / JOIN).
var reDeleteSingleTable = regexp.MustCompile(`(?is)^\s*delete\s+from\s+(\S+)\s*(?:where\s+(.+))?\s*;?\s*$`)

// reUpdateRest captures UPDATE table SET ... rest (rest may include WHERE or not).
var reUpdatePrefix = regexp.MustCompile(`(?is)^\s*update\s+(\S+)\s+set\s+(.+)$`)

var reWhereSplit = regexp.MustCompile(`(?is)\s+where\s+`)

// mutationDeletePreviewSQL returns COUNT and SELECT sample queries for a simple DELETE, or ok=false.
func mutationDeletePreviewSQL(sqlText string, sampleLimit int) (countSQL, sampleSQL string, ok bool) {
	m := reDeleteSingleTable.FindStringSubmatch(sqlText)
	if m == nil || len(m) < 2 {
		return "", "", false
	}
	table := strings.TrimSpace(m[1])
	if table == "" {
		return "", "", false
	}
	var whereSuffix string
	if len(m) >= 3 && strings.TrimSpace(m[2]) != "" {
		w := strings.TrimSpace(m[2])
		w = strings.TrimSuffix(w, ";")
		whereSuffix = " WHERE " + w
	}
	countSQL = "SELECT COUNT(*) FROM " + table + whereSuffix
	sampleSQL = "SELECT * FROM " + table + whereSuffix
	if sampleLimit > 0 {
		sampleSQL += fmt.Sprintf(" LIMIT %d", sampleLimit)
	}
	return countSQL, sampleSQL, true
}

// mutationUpdatePreviewSQL returns COUNT and SELECT sample for a simple UPDATE, or ok=false.
func mutationUpdatePreviewSQL(sqlText string, sampleLimit int) (countSQL, sampleSQL string, ok bool) {
	m := reUpdatePrefix.FindStringSubmatch(sqlText)
	if m == nil {
		return "", "", false
	}
	table := strings.TrimSpace(m[1])
	rest := strings.TrimSpace(m[2])
	if table == "" || rest == "" {
		return "", "", false
	}
	// Split on first top-level WHERE (heuristic: first \s+where\s+ in remainder after SET).
	idx := reWhereSplit.FindStringIndex(rest)
	if idx == nil {
		countSQL = "SELECT COUNT(*) FROM " + table
		sampleSQL = fmt.Sprintf("SELECT * FROM %s LIMIT %d", table, sampleLimit)
		return countSQL, sampleSQL, true
	}
	whereClause := strings.TrimSpace(rest[idx[1]:])
	whereClause = strings.TrimSuffix(whereClause, ";")
	countSQL = "SELECT COUNT(*) FROM " + table + " WHERE " + whereClause
	sampleSQL = "SELECT * FROM " + table + " WHERE " + whereClause
	if sampleLimit > 0 {
		sampleSQL += fmt.Sprintf(" LIMIT %d", sampleLimit)
	}
	return countSQL, sampleSQL, true
}
