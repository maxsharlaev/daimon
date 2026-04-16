package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func openPostgresFromTunnel(host string, port int, user, password, database string) (*sql.DB, error) {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, password),
		Host:   net.JoinHostPort(host, strconv.Itoa(port)),
		Path:   "/" + database,
	}
	if database == "" {
		u.Path = "/postgres"
	}
	q := u.Query()
	q.Set("sslmode", "disable")
	u.RawQuery = q.Encode()
	db, err := sql.Open("pgx", u.String())
	if err != nil {
		return nil, err
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func openMySQLFromTunnel(host string, port int, user, password, database string) (*sql.DB, error) {
	// interpolateParams helps with prepared statements
	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?parseTime=true&interpolateParams=true",
		user, password, net.JoinHostPort(host, strconv.Itoa(port)), database)
	if database == "" {
		dsn = fmt.Sprintf("%s:%s@tcp(%s)/?parseTime=true&interpolateParams=true", user, password, net.JoinHostPort(host, strconv.Itoa(port)))
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func quotePGIdent(parts ...string) string {
	var b strings.Builder
	for i, p := range parts {
		if i > 0 {
			b.WriteByte('.')
		}
		b.WriteString(`"`)
		b.WriteString(strings.ReplaceAll(p, `"`, `""`))
		b.WriteString(`"`)
	}
	return b.String()
}

func quoteMySQLIdent(parts ...string) string {
	var b strings.Builder
	for i, p := range parts {
		if i > 0 {
			b.WriteByte('.')
		}
		b.WriteByte('`')
		b.WriteString(strings.ReplaceAll(p, "`", "``"))
		b.WriteByte('`')
	}
	return b.String()
}

// sqlCellToString formats a database/sql Scan destination value for JSON/UI.
// fmt.Sprint on []byte prints decimal bytes like "[73 68]", so we decode UTF-8 explicitly.
func sqlCellToString(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case []byte:
		return string(x)
	case time.Time:
		return x.Format(time.RFC3339Nano)
	case float64:
		return strconv.FormatFloat(x, 'g', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(x), 'g', -1, 32)
	case int64:
		return strconv.FormatInt(x, 10)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int16:
		return strconv.FormatInt(int64(x), 10)
	case int8:
		return strconv.FormatInt(int64(x), 10)
	case int:
		return strconv.Itoa(x)
	case uint64:
		return strconv.FormatUint(x, 10)
	case uint32:
		return strconv.FormatUint(uint64(x), 10)
	case uint16:
		return strconv.FormatUint(uint64(x), 10)
	case uint8:
		return strconv.FormatUint(uint64(x), 10)
	case bool:
		return strconv.FormatBool(x)
	case sql.NullString:
		if x.Valid {
			return x.String
		}
		return ""
	case sql.NullInt64:
		if x.Valid {
			return strconv.FormatInt(x.Int64, 10)
		}
		return ""
	case sql.NullFloat64:
		if x.Valid {
			return strconv.FormatFloat(x.Float64, 'g', -1, 64)
		}
		return ""
	case sql.NullBool:
		if x.Valid {
			return strconv.FormatBool(x.Bool)
		}
		return ""
	case sql.NullTime:
		if x.Valid {
			return x.Time.Format(time.RFC3339Nano)
		}
		return ""
	default:
		return fmt.Sprint(x)
	}
}

func dataListDatabases(engine string, db *sql.DB) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	switch engine {
	case "postgres":
		rows, err := db.QueryContext(ctx, `SELECT datname FROM pg_database WHERE datallowconn AND datistemplate = false ORDER BY datname`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, err
			}
			out = append(out, n)
		}
		return out, rows.Err()
	case "mysql":
		rows, err := db.QueryContext(ctx, `SHOW DATABASES`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, err
			}
			if strings.EqualFold(n, "information_schema") || strings.EqualFold(n, "mysql") || strings.EqualFold(n, "performance_schema") || strings.EqualFold(n, "sys") {
				continue
			}
			out = append(out, n)
		}
		return out, rows.Err()
	default:
		return nil, fmt.Errorf("unknown engine %q", engine)
	}
}

func dataListTables(engine string, db *sql.DB, schemaOrDB string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		q := `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`
		rows, err := db.QueryContext(ctx, q, sch)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, err
			}
			out = append(out, n)
		}
		return out, rows.Err()
	case "mysql":
		dbName := schemaOrDB
		if dbName == "" {
			return nil, errors.New("database name required")
		}
		q := "SHOW TABLES FROM " + quoteMySQLIdent(dbName)
		rows, err := db.QueryContext(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, err
			}
			out = append(out, n)
		}
		return out, rows.Err()
	default:
		return nil, fmt.Errorf("unknown engine %q", engine)
	}
}

// dataResolveSortColumn returns a canonical column name from information_schema, or "" if not allowed / empty.
func dataResolveSortColumn(engine string, db *sql.DB, schemaOrDB, table, candidate string) (string, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", nil
	}
	if len(candidate) > 128 {
		return "", errors.New("sort column too long")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		var cn string
		err := db.QueryRowContext(ctx,
			`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND LOWER(column_name) = LOWER($3) LIMIT 1`,
			sch, table, candidate).Scan(&cn)
		if err == sql.ErrNoRows {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		return cn, nil
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return "", errors.New("database required")
		}
		var cn string
		err := db.QueryRowContext(ctx,
			`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND LOWER(COLUMN_NAME) = LOWER(?) LIMIT 1`,
			dbn, table, candidate).Scan(&cn)
		if err == sql.ErrNoRows {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		return cn, nil
	default:
		return "", fmt.Errorf("unknown engine %q", engine)
	}
}

func dataTablePreview(engine string, db *sql.DB, schemaOrDB, table string, limit, offset int, sortColumn, sortDir string) (cols []string, rowsOut [][]string, err error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	dir := strings.ToLower(strings.TrimSpace(sortDir))
	if dir != "asc" && dir != "desc" {
		dir = ""
	}
	orderClause := ""
	if dir != "" {
		col, err := dataResolveSortColumn(engine, db, schemaOrDB, table, sortColumn)
		if err != nil {
			return nil, nil, err
		}
		if col != "" {
			switch engine {
			case "postgres":
				orderClause = " ORDER BY " + quotePGIdent(col) + " " + strings.ToUpper(dir)
			case "mysql":
				orderClause = " ORDER BY " + quoteMySQLIdent(col) + " " + strings.ToUpper(dir)
			}
		}
	}

	var q string
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		tn := quotePGIdent(sch, table)
		q = fmt.Sprintf(`SELECT * FROM %s%s LIMIT %d OFFSET %d`, tn, orderClause, limit, offset)
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return nil, nil, errors.New("database required")
		}
		tn := quoteMySQLIdent(dbn, table)
		q = fmt.Sprintf(`SELECT * FROM %s%s LIMIT %d OFFSET %d`, tn, orderClause, limit, offset)
	default:
		return nil, nil, fmt.Errorf("unknown engine")
	}

	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	cols, err = rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		raw := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		line := make([]string, len(cols))
		for i, v := range raw {
			line[i] = sqlCellToString(v)
		}
		rowsOut = append(rowsOut, line)
	}
	return cols, rowsOut, rows.Err()
}

func dataTableRowCount(engine string, db *sql.DB, schemaOrDB, table string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var q string
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		tn := quotePGIdent(sch, table)
		q = fmt.Sprintf(`SELECT COUNT(*)::bigint FROM %s`, tn)
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return 0, errors.New("database required")
		}
		tn := quoteMySQLIdent(dbn, table)
		q = fmt.Sprintf(`SELECT COUNT(*) FROM %s`, tn)
	default:
		return 0, fmt.Errorf("unknown engine %q", engine)
	}
	var n int64
	err := db.QueryRowContext(ctx, q).Scan(&n)
	return n, err
}

func dataExecUserSQL(engine string, db *sql.DB, schemaOrDB, sqlText string) (cols []string, rowsOut [][]string, err error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, nil, errors.New("empty SQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Optional: set search_path for postgres single-session
	if engine == "postgres" && schemaOrDB != "" && schemaOrDB != "public" {
		_, _ = db.ExecContext(ctx, `SET search_path TO `+quotePGIdent(schemaOrDB))
	}
	if engine == "mysql" && schemaOrDB != "" {
		_, e := db.ExecContext(ctx, "USE "+quoteMySQLIdent(schemaOrDB))
		if e != nil {
			return nil, nil, e
		}
	}

	rows, err := db.QueryContext(ctx, sqlText)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	cols, err = rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		raw := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		line := make([]string, len(cols))
		for i, v := range raw {
			line[i] = sqlCellToString(v)
		}
		rowsOut = append(rowsOut, line)
	}
	return cols, rowsOut, rows.Err()
}

func dataPrimaryKeyColumns(engine string, db *sql.DB, schemaOrDB, table string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		q := `SELECT kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY kcu.ordinal_position`
		rows, err := db.QueryContext(ctx, q, sch, table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return nil, errors.New("database required")
		}
		q := `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
ORDER BY ORDINAL_POSITION`
		rows, err := db.QueryContext(ctx, q, dbn, table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	default:
		return nil, fmt.Errorf("unknown engine")
	}
}

func dataDeleteRow(engine string, db *sql.DB, schemaOrDB, table string, pkCols []string, pkVals []string) error {
	if len(pkCols) != len(pkVals) || len(pkCols) == 0 {
		return errors.New("primary key required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var where strings.Builder
	args := make([]interface{}, 0, len(pkCols))
	for i := range pkCols {
		if i > 0 {
			where.WriteString(" AND ")
		}
		switch engine {
		case "postgres":
			where.WriteString(quotePGIdent(pkCols[i]))
			where.WriteString(" = $")
			where.WriteString(strconv.Itoa(i + 1))
		case "mysql":
			where.WriteString(quoteMySQLIdent(pkCols[i]))
			where.WriteString(" = ?")
		}
		args = append(args, pkVals[i])
	}
	var q string
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		tn := quotePGIdent(sch, table)
		q = fmt.Sprintf(`DELETE FROM %s WHERE %s`, tn, where.String())
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return errors.New("database required")
		}
		tn := quoteMySQLIdent(dbn, table)
		q = fmt.Sprintf(`DELETE FROM %s WHERE %s`, tn, where.String())
	default:
		return fmt.Errorf("unknown engine")
	}
	res, err := db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("no row deleted")
	}
	return nil
}

func dataUpdateRow(engine string, db *sql.DB, schemaOrDB, table string, colNames []string, colVals []string, pkCols []string, pkVals []string) error {
	if len(pkCols) != len(pkVals) || len(pkCols) == 0 {
		return errors.New("primary key required")
	}
	if len(colNames) != len(colVals) {
		return errors.New("column mismatch")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var setB strings.Builder
	args := make([]interface{}, 0, len(colNames)+len(pkVals))
	argPos := 1
	for i := range colNames {
		if i > 0 {
			setB.WriteString(", ")
		}
		switch engine {
		case "postgres":
			setB.WriteString(quotePGIdent(colNames[i]))
			setB.WriteString(" = $")
			setB.WriteString(strconv.Itoa(argPos))
			argPos++
		case "mysql":
			setB.WriteString(quoteMySQLIdent(colNames[i]))
			setB.WriteString(" = ?")
		}
		args = append(args, colVals[i])
	}
	var where strings.Builder
	for i := range pkCols {
		if i > 0 {
			where.WriteString(" AND ")
		}
		switch engine {
		case "postgres":
			where.WriteString(quotePGIdent(pkCols[i]))
			where.WriteString(" = $")
			where.WriteString(strconv.Itoa(argPos))
			argPos++
		case "mysql":
			where.WriteString(quoteMySQLIdent(pkCols[i]))
			where.WriteString(" = ?")
		}
		args = append(args, pkVals[i])
	}
	var q string
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		tn := quotePGIdent(sch, table)
		q = fmt.Sprintf(`UPDATE %s SET %s WHERE %s`, tn, setB.String(), where.String())
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return errors.New("database required")
		}
		tn := quoteMySQLIdent(dbn, table)
		q = fmt.Sprintf(`UPDATE %s SET %s WHERE %s`, tn, setB.String(), where.String())
	default:
		return fmt.Errorf("unknown engine")
	}
	res, err := db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("no row updated")
	}
	return nil
}

func dataListPostgresSchemas(db *sql.DB) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	q := `SELECT nspname FROM pg_catalog.pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema')
AND nspname NOT LIKE 'pg_toast%'
AND nspname NOT LIKE 'pg_temp\_%' ESCAPE '\'
ORDER BY nspname`
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func dataListTableColumns(engine string, db *sql.DB, schemaOrDB, table string) ([]DataColumnMetaDTO, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	switch engine {
	case "postgres":
		sch := schemaOrDB
		if sch == "" {
			sch = "public"
		}
		q := `SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
ORDER BY ordinal_position`
		rows, err := db.QueryContext(ctx, q, sch, table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []DataColumnMetaDTO
		for rows.Next() {
			var name, typ string
			if err := rows.Scan(&name, &typ); err != nil {
				return nil, err
			}
			out = append(out, DataColumnMetaDTO{Name: name, DataType: typ})
		}
		return out, rows.Err()
	case "mysql":
		dbn := schemaOrDB
		if dbn == "" {
			return nil, errors.New("database required")
		}
		q := `SELECT COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION`
		rows, err := db.QueryContext(ctx, q, dbn, table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []DataColumnMetaDTO
		for rows.Next() {
			var name, typ string
			if err := rows.Scan(&name, &typ); err != nil {
				return nil, err
			}
			out = append(out, DataColumnMetaDTO{Name: name, DataType: typ})
		}
		return out, rows.Err()
	default:
		return nil, fmt.Errorf("unknown engine %q", engine)
	}
}
