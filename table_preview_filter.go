package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// tableFilterClause is one row in the Table view filter JSON (AND/OR chain).
type tableFilterClause struct {
	Join   string `json:"join"` // "AND" or "OR" before this clause; ignored for the first clause
	Column string `json:"column"`
	Op     string `json:"op"`
	Value  string `json:"value"`
}

func parseTableFilterJSON(s string) ([]tableFilterClause, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "[]" {
		return nil, nil
	}
	var out []tableFilterClause
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	return out, nil
}

type filterArgBuilder struct {
	engine string
	args   []interface{}
	pg     int
}

func (w *filterArgBuilder) nextPlaceholder() string {
	switch w.engine {
	case "postgres":
		w.pg++
		return fmt.Sprintf("$%d", w.pg)
	case "mysql":
		return "?"
	default:
		return "?"
	}
}

func (w *filterArgBuilder) addArg(v interface{}) {
	w.args = append(w.args, v)
}

func quoteFilterColumn(engine, col string) string {
	switch engine {
	case "postgres":
		return quotePGIdent(col)
	case "mysql":
		return quoteMySQLIdent(col)
	default:
		return quotePGIdent(col)
	}
}

func buildTablePreviewWhere(
	engine string,
	db *sql.DB,
	schemaOrDB, table string,
	clauses []tableFilterClause,
) (whereSQL string, args []interface{}, err error) {
	if len(clauses) == 0 {
		return "", nil, nil
	}
	var b strings.Builder
	w := &filterArgBuilder{engine: engine}

	for i := range clauses {
		c := clauses[i]
		if i > 0 {
			j := strings.ToUpper(strings.TrimSpace(c.Join))
			if j != "AND" && j != "OR" {
				return "", nil, fmt.Errorf("filter: clause %d: join must be AND or OR", i)
			}
			b.WriteString(" ")
			b.WriteString(j)
			b.WriteString(" ")
		}
		col, err := dataResolveSortColumn(engine, db, schemaOrDB, table, c.Column)
		if err != nil {
			return "", nil, err
		}
		if col == "" {
			return "", nil, fmt.Errorf("filter: unknown column %q", c.Column)
		}
		qc := quoteFilterColumn(engine, col)
		op := strings.ToLower(strings.TrimSpace(c.Op))
		switch op {
		case "eq":
			if strings.TrimSpace(c.Value) == "" {
				return "", nil, errors.New("filter: value required")
			}
			ph := w.nextPlaceholder()
			w.addArg(c.Value)
			b.WriteString(qc + " = " + ph)
		case "ne":
			if strings.TrimSpace(c.Value) == "" {
				return "", nil, errors.New("filter: value required")
			}
			ph := w.nextPlaceholder()
			w.addArg(c.Value)
			b.WriteString(qc + " <> " + ph)
		case "like":
			if strings.TrimSpace(c.Value) == "" {
				return "", nil, errors.New("filter: value required")
			}
			ph := w.nextPlaceholder()
			w.addArg(c.Value)
			b.WriteString(qc + " LIKE " + ph)
		case "gt":
			if strings.TrimSpace(c.Value) == "" {
				return "", nil, errors.New("filter: value required")
			}
			ph := w.nextPlaceholder()
			w.addArg(c.Value)
			b.WriteString(qc + " > " + ph)
		case "lt":
			if strings.TrimSpace(c.Value) == "" {
				return "", nil, errors.New("filter: value required")
			}
			ph := w.nextPlaceholder()
			w.addArg(c.Value)
			b.WriteString(qc + " < " + ph)
		case "is":
			b.WriteString(qc + " IS NULL")
		case "is_not":
			b.WriteString(qc + " IS NOT NULL")
		case "in":
			parts := splitFilterIN(c.Value)
			if len(parts) == 0 {
				return "", nil, errors.New("filter: IN list is empty")
			}
			phs := make([]string, len(parts))
			for j := range parts {
				phs[j] = w.nextPlaceholder()
				w.addArg(parts[j])
			}
			b.WriteString(qc + " IN (" + strings.Join(phs, ",") + ")")
		default:
			return "", nil, fmt.Errorf("filter: unsupported op %q", c.Op)
		}
	}
	return b.String(), w.args, nil
}

func splitFilterIN(value string) []string {
	var out []string
	for _, p := range strings.Split(value, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
