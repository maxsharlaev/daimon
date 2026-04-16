package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"al.essio.dev/pkg/shellescape"

	"daimon/internal/secrets"
	"daimon/internal/storage"

	"github.com/google/uuid"
	"gorm.io/gorm/clause"
)

type DataSourceDTO struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Engine     string `json:"engine"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Database   string `json:"database"`
	ScopeJSON  string `json:"scopeJson"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
	HasSecret  bool   `json:"hasSecret"`
}

type UpsertDataSourceRequest struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	Engine    string `json:"engine"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Database  string `json:"database"`
	ScopeJSON string `json:"scopeJson"`

	Password         string `json:"password,omitempty"`
	PasswordStorage  string `json:"passwordStorage,omitempty"` // none | keyring | internal
}

type DataConnectRequest struct {
	DataSourceID          string `json:"dataSourceId"`
	RemoteDockerSessionID string `json:"remoteDockerSessionId,omitempty"`
}

// TestDataSourceConnectionRequest tries a DB reachability check using unsaved form values (no row in DB).
type TestDataSourceConnectionRequest struct {
	Engine                string `json:"engine"`
	Host                  string `json:"host"`
	Port                  int    `json:"port"`
	Username              string `json:"username"`
	Database              string `json:"database"`
	Password              string `json:"password"`
	ScopeJSON             string `json:"scopeJson"`
	RemoteDockerSessionID string `json:"remoteDockerSessionId,omitempty"`
}

type DataSessionDTO struct {
	SessionID    string `json:"sessionId"`
	DataSourceID string `json:"dataSourceId"`
	Engine       string `json:"engine"`
	Mode         string `json:"mode"`
	OK           bool   `json:"ok"`
	Error        string `json:"error,omitempty"`
}

type DataQueryResultDTO struct {
	Columns   []string   `json:"columns"`
	Rows      [][]string `json:"rows"`
	TotalRows int64      `json:"totalRows"`
}

// DataColumnMetaDTO is one column definition for SQL/schema browser UI.
type DataColumnMetaDTO struct {
	Name     string `json:"name"`
	DataType string `json:"dataType"`
}

func mapDataSourceDTO(m storage.DataSource, hasSecret bool) DataSourceDTO {
	return DataSourceDTO{
		ID:        m.ID,
		Name:      m.Name,
		Engine:    m.Engine,
		Host:      m.Host,
		Port:      m.Port,
		Username:  m.Username,
		Database:  m.Database,
		ScopeJSON: m.ScopeJSON,
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: m.UpdatedAt.UTC().Format(time.RFC3339),
		HasSecret: hasSecret,
	}
}

func (a *App) ListDataSources(mode, sshProfileID, containerID string) ([]DataSourceDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	var list []storage.DataSource
	if err := a.db.DB.Clauses(clause.OrderBy{
		Columns: []clause.OrderByColumn{
			{Column: clause.Column{Name: "name"}, Desc: false},
		},
	}).Find(&list).Error; err != nil {
		return nil, err
	}
	out := make([]DataSourceDTO, 0, len(list))
	mode = strings.TrimSpace(strings.ToLower(mode))
	sshProfileID = strings.TrimSpace(sshProfileID)
	containerID = strings.TrimSpace(containerID)
	for _, m := range list {
		sc, err := parseDataScopeJSON(m.ScopeJSON)
		if err != nil {
			continue
		}
		if mode != "" && !sc.matchesFilter(mode, sshProfileID, containerID) {
			continue
		}
		sr, err := a.secrets.GetSecretRef(m.ID, secrets.KindDataSourcePassword)
		hasSecret := err == nil && secrets.Storage(sr.Storage) != secrets.StorageNone
		out = append(out, mapDataSourceDTO(m, hasSecret))
	}
	return out, nil
}

func (a *App) UpsertDataSource(req UpsertDataSourceRequest) (DataSourceDTO, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return DataSourceDTO{}, errors.New("app not ready")
	}
	if strings.TrimSpace(req.Name) == "" {
		return DataSourceDTO{}, errors.New("name required")
	}
	req.Engine = strings.TrimSpace(strings.ToLower(req.Engine))
	if req.Engine != "postgres" && req.Engine != "mysql" {
		return DataSourceDTO{}, errors.New("engine must be postgres or mysql")
	}
	if req.Port <= 0 {
		if req.Engine == "postgres" {
			req.Port = 5432
		} else {
			req.Port = 3306
		}
	}
	if strings.TrimSpace(req.Host) == "" {
		req.Host = "127.0.0.1"
	}
	if req.ScopeJSON == "" {
		req.ScopeJSON = "{}"
	}
	if _, err := parseDataScopeJSON(req.ScopeJSON); err != nil {
		return DataSourceDTO{}, fmt.Errorf("scope: %w", err)
	}

	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = uuid.NewString()
	}

	m := storage.DataSource{
		ID:        id,
		Name:      strings.TrimSpace(req.Name),
		Engine:    req.Engine,
		Host:      strings.TrimSpace(req.Host),
		Port:      req.Port,
		Username:  strings.TrimSpace(req.Username),
		Database:  strings.TrimSpace(req.Database),
		ScopeJSON: req.ScopeJSON,
	}
	if err := a.db.DB.Save(&m).Error; err != nil {
		return DataSourceDTO{}, err
	}

	if req.Password != "" || req.PasswordStorage == "none" {
		st := secrets.StorageKeyring
		switch strings.TrimSpace(req.PasswordStorage) {
		case "none", "":
			if req.Password == "" {
				_ = a.secrets.PutSecretValue(m.ID, secrets.KindDataSourcePassword, secrets.StorageNone, "", secrets.SecretValue{}, "{}")
			}
		case "internal":
			st = secrets.StorageInternal
			fallthrough
		case "keyring":
			if st == secrets.StorageKeyring {
				st = secrets.StorageKeyring
			}
			if req.Password != "" {
				if err := a.secrets.PutSecretValue(m.ID, secrets.KindDataSourcePassword, st, "", secrets.SecretValue{Password: req.Password}, "{}"); err != nil {
					return DataSourceDTO{}, err
				}
			}
		default:
			if req.Password != "" {
				if err := a.secrets.PutSecretValue(m.ID, secrets.KindDataSourcePassword, secrets.StorageKeyring, "", secrets.SecretValue{Password: req.Password}, "{}"); err != nil {
					return DataSourceDTO{}, err
				}
			}
		}
	}

	_, err := a.secrets.GetSecretRef(m.ID, secrets.KindDataSourcePassword)
	hasSecret := err == nil
	return mapDataSourceDTO(m, hasSecret), nil
}

// TestDataSourceConnection opens a short-lived connection (SSH tunnel or Docker sidecar path) and pings the DB.
func (a *App) TestDataSourceConnection(req TestDataSourceConnectionRequest) error {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return errors.New("app not ready")
	}
	ctx := context.Background()
	if a.ctx != nil {
		ctx = a.ctx
	}
	eng := strings.TrimSpace(strings.ToLower(req.Engine))
	if eng != "postgres" && eng != "mysql" {
		return errors.New("engine must be postgres or mysql")
	}
	port := req.Port
	if port <= 0 {
		if eng == "postgres" {
			port = 5432
		} else {
			port = 3306
		}
	}
	host := strings.TrimSpace(req.Host)
	if host == "" {
		host = "127.0.0.1"
	}
	scopeJSON := strings.TrimSpace(req.ScopeJSON)
	if scopeJSON == "" {
		scopeJSON = "{}"
	}
	sc, err := parseDataScopeJSON(scopeJSON)
	if err != nil {
		return fmt.Errorf("scope: %w", err)
	}
	src := storage.DataSource{
		Engine:   eng,
		Host:     host,
		Port:     port,
		Username: strings.TrimSpace(req.Username),
		Database: strings.TrimSpace(req.Database),
	}
	password := req.Password

	sess := &dataSession{
		engine:   eng,
		mode:     sc.Mode,
		host:     src.Host,
		port:     src.Port,
		user:     src.Username,
		password: password,
	}

	switch sc.Mode {
	case "ssh":
		if sc.SSHProfileID == "" {
			return errors.New("scope.sshProfileId required")
		}
		cfg, err := a.buildSSHConfigForProfile(sc.SSHProfileID)
		if err != nil {
			return err
		}
		sid, err := a.ssh.ConnectExecOnlySilent(ctx, cfg)
		if err != nil {
			return err
		}
		defer func() { _ = a.ssh.Disconnect(ctx, sid) }()

		cli, err := a.ssh.Client(sid)
		if err != nil {
			return err
		}
		tun, err := startSSHTunnel(cli, src.Host, src.Port)
		if err != nil {
			return err
		}
		defer func() { _ = tun.Close() }()

		addr := tun.LocalAddr()
		tcp, ok := addr.(*net.TCPAddr)
		if !ok {
			return errors.New("tunnel address")
		}
		db, err := openSQLPool(src.Engine, "127.0.0.1", tcp.Port, src.Username, password, src.Database)
		if err != nil {
			return err
		}
		defer func() { _ = db.Close() }()
		return nil

	case "docker_local":
		cid := strings.TrimSpace(sc.ContainerID)
		if cid == "" {
			cid = strings.TrimSpace(sc.ContainerName)
		}
		if cid == "" {
			return errors.New("scope.containerId required")
		}
		sess.containerID = cid
		_, _, err := a.dataDockerPing(&src, sess)
		return err

	case "docker_remote":
		if strings.TrimSpace(req.RemoteDockerSessionID) == "" {
			return errors.New("connect to remote Docker first (Docker remote session required)")
		}
		cid := strings.TrimSpace(sc.ContainerID)
		if cid == "" {
			cid = strings.TrimSpace(sc.ContainerName)
		}
		if cid == "" {
			return errors.New("scope.containerId required")
		}
		sess.containerID = cid
		sess.remoteSSHSessionID = req.RemoteDockerSessionID
		_, _, err := a.dataDockerPing(&src, sess)
		return err

	default:
		return fmt.Errorf("unsupported scope.mode %q", sc.Mode)
	}
}

func (a *App) DeleteDataSource(id string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("db not ready")
	}
	if id == "" {
		return errors.New("id required")
	}
	_ = a.secrets.PutSecretValue(id, secrets.KindDataSourcePassword, secrets.StorageNone, "", secrets.SecretValue{}, "{}")
	return a.db.DB.Delete(&storage.DataSource{}, "id = ?", id).Error
}

// --- sessions ---

type dataSession struct {
	id           string
	dataSourceID string
	engine       string
	mode         string

	sshSessionID string
	tunnel       *sshTunnel
	db           *sql.DB

	containerID        string
	remoteSSHSessionID string

	host     string
	port     int
	user     string
	password string
}

func (a *App) dataCloseSessionLocked(ds *dataSession) {
	ctx := context.Background()
	if a.ctx != nil {
		ctx = a.ctx
	}
	if ds.db != nil {
		_ = ds.db.Close()
		ds.db = nil
	}
	if ds.tunnel != nil {
		_ = ds.tunnel.Close()
		ds.tunnel = nil
	}
	if ds.sshSessionID != "" {
		_ = a.ssh.Disconnect(ctx, ds.sshSessionID)
		ds.sshSessionID = ""
	}
}

func (a *App) DataConnect(req DataConnectRequest) (DataSessionDTO, error) {
	if a.db == nil || a.db.DB == nil || a.secrets == nil {
		return DataSessionDTO{}, errors.New("app not ready")
	}
	if req.DataSourceID == "" {
		return DataSessionDTO{}, errors.New("dataSourceId required")
	}
	var src storage.DataSource
	if err := a.db.DB.First(&src, "id = ?", req.DataSourceID).Error; err != nil {
		return DataSessionDTO{}, err
	}
	sc, err := parseDataScopeJSON(src.ScopeJSON)
	if err != nil {
		return DataSessionDTO{}, err
	}
	val, _, err := a.secrets.GetSecretValue(src.ID, secrets.KindDataSourcePassword)
	if err != nil {
		return DataSessionDTO{}, err
	}
	if strings.TrimSpace(val.Password) == "" {
		return DataSessionDTO{}, errors.New("database password not configured")
	}
	password := val.Password

	sess := &dataSession{
		id:           randomID(),
		dataSourceID: src.ID,
		engine:       src.Engine,
		mode:         sc.Mode,
		host:         src.Host,
		port:         src.Port,
		user:         src.Username,
		password:     password,
	}

	switch sc.Mode {
	case "ssh":
		if sc.SSHProfileID == "" {
			return DataSessionDTO{}, errors.New("scope.sshProfileId required")
		}
		cfg, err := a.buildSSHConfigForProfile(sc.SSHProfileID)
		if err != nil {
			return DataSessionDTO{}, err
		}
		sid, err := a.ssh.ConnectExecOnlySilent(a.ctx, cfg)
		if err != nil {
			return DataSessionDTO{}, err
		}
		sess.sshSessionID = sid
		cli, err := a.ssh.Client(sid)
		if err != nil {
			_ = a.ssh.Disconnect(a.ctx, sid)
			return DataSessionDTO{}, err
		}
		tun, err := startSSHTunnel(cli, src.Host, src.Port)
		if err != nil {
			_ = a.ssh.Disconnect(a.ctx, sid)
			return DataSessionDTO{}, err
		}
		sess.tunnel = tun
		addr := tun.LocalAddr()
		tcp, ok := addr.(*net.TCPAddr)
		if !ok {
			_ = tun.Close()
			_ = a.ssh.Disconnect(a.ctx, sid)
			return DataSessionDTO{}, errors.New("tunnel address")
		}
		host := "127.0.0.1"
		port := tcp.Port
		db, err := openSQLPool(src.Engine, host, port, src.Username, password, src.Database)
		if err != nil {
			_ = tun.Close()
			_ = a.ssh.Disconnect(a.ctx, sid)
			return DataSessionDTO{}, err
		}
		sess.db = db

	case "docker_local":
		if sc.ContainerID == "" && sc.ContainerName == "" {
			return DataSessionDTO{}, errors.New("scope.containerId required")
		}
		cid := sc.ContainerID
		if cid == "" {
			cid = sc.ContainerName
		}
		sess.containerID = cid
		// validate: run trivial query via sidecar
		if _, _, err := a.dataDockerPing(&src, sess); err != nil {
			return DataSessionDTO{}, err
		}

	case "docker_remote":
		if req.RemoteDockerSessionID == "" {
			return DataSessionDTO{}, errors.New("remoteDockerSessionId required")
		}
		if sc.ContainerID == "" && sc.ContainerName == "" {
			return DataSessionDTO{}, errors.New("scope.containerId required")
		}
		cid := sc.ContainerID
		if cid == "" {
			cid = sc.ContainerName
		}
		sess.containerID = cid
		sess.remoteSSHSessionID = req.RemoteDockerSessionID
		if _, _, err := a.dataDockerPing(&src, sess); err != nil {
			return DataSessionDTO{}, err
		}

	default:
		return DataSessionDTO{}, fmt.Errorf("unsupported scope.mode %q", sc.Mode)
	}

	a.dataMu.Lock()
	a.dataSessions[sess.id] = sess
	a.dataMu.Unlock()

	return DataSessionDTO{
		SessionID:    sess.id,
		DataSourceID: src.ID,
		Engine:       src.Engine,
		Mode:         sc.Mode,
		OK:           true,
	}, nil
}

func openSQLPool(engine, host string, port int, user, password, database string) (*sql.DB, error) {
	switch engine {
	case "postgres":
		return openPostgresFromTunnel(host, port, user, password, database)
	case "mysql":
		return openMySQLFromTunnel(host, port, user, password, database)
	default:
		return nil, fmt.Errorf("unknown engine %q", engine)
	}
}

func (a *App) buildSSHConfigForProfile(profileID string) (SSHConfig, error) {
	var p storage.Profile
	if err := a.db.DB.First(&p, "id = ?", profileID).Error; err != nil {
		return SSHConfig{}, err
	}
	cfg := SSHConfig{
		Host:                  p.Host,
		Port:                  p.Port,
		Username:              p.Username,
		InsecureIgnoreHostKey: true,
		TimeoutMs:             10000,
	}
	if sr, err := a.secrets.GetSecretRef(profileID, secrets.KindPrivateKey); err == nil {
		switch secrets.Storage(sr.Storage) {
		case secrets.StorageExternal:
			if strings.TrimSpace(sr.Ref) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPath = sr.Ref
				if val, _, err := a.secrets.GetSecretValue(profileID, secrets.KindPrivateKey); err == nil {
					cfg.Passphrase = val.Passphrase
				}
				return cfg, nil
			}
		case secrets.StorageKeyring, secrets.StorageInternal:
			val, _, err := a.secrets.GetSecretValue(profileID, secrets.KindPrivateKey)
			if err == nil && strings.TrimSpace(val.PrivateKeyPEM) != "" {
				cfg.AuthType = "privateKey"
				cfg.PrivateKeyPEM = val.PrivateKeyPEM
				cfg.Passphrase = val.Passphrase
				return cfg, nil
			}
		}
	}
	val, mode, err := a.secrets.GetSecretValue(profileID, secrets.KindPassword)
	if err != nil {
		return SSHConfig{}, err
	}
	if mode == secrets.StorageNone || strings.TrimSpace(val.Password) == "" {
		return SSHConfig{}, fmt.Errorf("password required")
	}
	cfg.AuthType = "password"
	cfg.Password = val.Password
	return cfg, nil
}

func (a *App) dataDockerPing(src *storage.DataSource, sess *dataSession) (cols []string, rows [][]string, err error) {
	switch src.Engine {
	case "postgres":
		q := "SELECT 1"
		if sess.mode == "docker_local" {
			return dockerPostgresQuery(sess.containerID, "127.0.0.1", src.Port, src.Username, sess.password, "postgres", q)
		}
		return a.dataRemoteDockerPostgresQuery(sess.remoteSSHSessionID, sess.containerID, src, sess.password, q)
	case "mysql":
		q := "SELECT 1"
		if sess.mode == "docker_local" {
			return dockerMySQLQuery(sess.containerID, "127.0.0.1", src.Port, src.Username, sess.password, "", q)
		}
		return a.dataRemoteDockerMySQLQuery(sess.remoteSSHSessionID, sess.containerID, src, sess.password, q)
	default:
		return nil, nil, fmt.Errorf("unknown engine")
	}
}

func (a *App) dataRemoteDockerPostgresQuery(remoteSessionID, containerID string, src *storage.DataSource, password, sqlText string) ([]string, [][]string, error) {
	db := "postgres"
	if strings.TrimSpace(src.Database) != "" {
		db = src.Database
	}
	b64 := base64.StdEncoding.EncodeToString([]byte(sqlText))
	script := fmt.Sprintf(`echo %s | base64 -d | docker run -i --rm --network container:%s -e PGPASSWORD=%s %s psql -h 127.0.0.1 -p %d -U %s -d %s -At -F "$(printf '\t')" -v ON_ERROR_STOP=1 -f -`,
		shellescape.Quote(b64),
		shellescape.Quote(containerID),
		shellescape.Quote(password),
		postgresSidecarImage,
		src.Port,
		shellescape.Quote(src.Username),
		shellescape.Quote(db),
	)
	out, err := a.ssh.Exec(remoteSessionID, "sh -lc "+shellescape.Quote(script))
	if err != nil {
		return nil, nil, err
	}
	return parseTSV(strings.TrimSpace(out))
}

func (a *App) dataRemoteDockerMySQLQuery(remoteSessionID, containerID string, src *storage.DataSource, password, sqlText string) ([]string, [][]string, error) {
	b64 := base64.StdEncoding.EncodeToString([]byte(sqlText))
	extra := ""
	if strings.TrimSpace(src.Database) != "" {
		extra = " " + shellescape.Quote(strings.TrimSpace(src.Database))
	}
	script := fmt.Sprintf(`echo %s | base64 -d | docker run -i --rm --network container:%s -e MYSQL_PWD=%s %s mysql -h 127.0.0.1 -P %d -u %s -B -N%s`,
		shellescape.Quote(b64),
		shellescape.Quote(containerID),
		shellescape.Quote(password),
		mysqlSidecarImage,
		src.Port,
		shellescape.Quote(src.Username),
		extra,
	)
	out, err := a.ssh.Exec(remoteSessionID, "sh -lc "+shellescape.Quote(script))
	if err != nil {
		return nil, nil, err
	}
	return parseTSV(strings.TrimSpace(out))
}

func (a *App) getDataSession(sessionID string) (*dataSession, error) {
	a.dataMu.Lock()
	defer a.dataMu.Unlock()
	s := a.dataSessions[sessionID]
	if s == nil {
		return nil, errors.New("data session not found")
	}
	return s, nil
}

func (a *App) loadDataSourceRow(id string) (*storage.DataSource, error) {
	var src storage.DataSource
	if err := a.db.DB.First(&src, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &src, nil
}

func (a *App) dataRunQuery(sess *dataSession, src *storage.DataSource, sqlText string) ([]string, [][]string, error) {
	if sess.db != nil {
		schemaOrDB := ""
		if src.Engine == "postgres" {
			schemaOrDB = "public"
		} else if src.Engine == "mysql" {
			schemaOrDB = strings.TrimSpace(src.Database)
		}
		return dataExecUserSQL(src.Engine, sess.db, schemaOrDB, sqlText)
	}
	switch src.Engine {
	case "postgres":
		db := "postgres"
		if strings.TrimSpace(src.Database) != "" {
			db = src.Database
		}
		if sess.mode == "docker_local" {
			return dockerPostgresQuery(sess.containerID, "127.0.0.1", src.Port, src.Username, sess.password, db, sqlText)
		}
		return a.dataRemoteDockerPostgresQuery(sess.remoteSSHSessionID, sess.containerID, src, sess.password, sqlText)
	case "mysql":
		db := strings.TrimSpace(src.Database)
		if sess.mode == "docker_local" {
			return dockerMySQLQuery(sess.containerID, "127.0.0.1", src.Port, src.Username, sess.password, db, sqlText)
		}
		return a.dataRemoteDockerMySQLQuery(sess.remoteSSHSessionID, sess.containerID, src, sess.password, sqlText)
	default:
		return nil, nil, fmt.Errorf("unknown engine")
	}
}

func sqlStringLit(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func (a *App) remoteResolveSortColumn(sess *dataSession, src *storage.DataSource, schOrDb, tbl, candidate string) (string, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", nil
	}
	if len(candidate) > 128 {
		return "", errors.New("sort column too long")
	}
	var q string
	switch src.Engine {
	case "postgres":
		q = fmt.Sprintf(
			`SELECT column_name FROM information_schema.columns WHERE table_schema = '%s' AND table_name = '%s' AND LOWER(column_name) = LOWER('%s') LIMIT 1`,
			sqlStringLit(schOrDb), sqlStringLit(tbl), sqlStringLit(candidate))
	case "mysql":
		q = fmt.Sprintf(
			`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '%s' AND TABLE_NAME = '%s' AND LOWER(COLUMN_NAME) = LOWER('%s') LIMIT 1`,
			sqlStringLit(schOrDb), sqlStringLit(tbl), sqlStringLit(candidate))
	default:
		return "", fmt.Errorf("unknown engine")
	}
	_, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return "", err
	}
	if len(rows) == 0 || len(rows[0]) == 0 {
		return "", nil
	}
	return rows[0][0], nil
}

func (a *App) remotePreviewOrderClause(sess *dataSession, src *storage.DataSource, schOrDb, tbl, sortColumn, sortDir string) (string, error) {
	dir := strings.ToLower(strings.TrimSpace(sortDir))
	if dir != "asc" && dir != "desc" {
		return "", nil
	}
	cn, err := a.remoteResolveSortColumn(sess, src, schOrDb, tbl, sortColumn)
	if err != nil || cn == "" {
		return "", err
	}
	switch src.Engine {
	case "postgres":
		return " ORDER BY " + quotePGIdent(cn) + " " + strings.ToUpper(dir), nil
	case "mysql":
		return " ORDER BY " + quoteMySQLIdent(cn) + " " + strings.ToUpper(dir), nil
	default:
		return "", fmt.Errorf("unknown engine")
	}
}

func (a *App) dataRunQueryCountScalar(sess *dataSession, src *storage.DataSource, sqlText string) (int64, error) {
	cols, rows, err := a.dataRunQuery(sess, src, sqlText)
	if err != nil {
		return 0, err
	}
	_ = cols
	if len(rows) == 0 || len(rows[0]) == 0 {
		return 0, nil
	}
	return strconv.ParseInt(strings.TrimSpace(rows[0][0]), 10, 64)
}

func (a *App) DataDisconnect(sessionID string) error {
	if sessionID == "" {
		return errors.New("sessionId required")
	}
	a.dataMu.Lock()
	sess := a.dataSessions[sessionID]
	delete(a.dataSessions, sessionID)
	a.dataMu.Unlock()
	if sess == nil {
		return nil
	}
	a.dataCloseSessionLocked(sess)
	return nil
}

func (a *App) dataCloseAllSessions() {
	a.dataMu.Lock()
	list := make([]*dataSession, 0, len(a.dataSessions))
	for _, s := range a.dataSessions {
		list = append(list, s)
	}
	a.dataSessions = make(map[string]*dataSession)
	a.dataMu.Unlock()
	for _, s := range list {
		if s != nil {
			a.dataCloseSessionLocked(s)
		}
	}
}

func (a *App) DataListDatabases(sessionID string) ([]string, error) {
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return nil, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return nil, err
	}
	if sess.db != nil {
		out, err := dataListDatabases(src.Engine, sess.db)
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	var q string
	switch src.Engine {
	case "postgres":
		q = `SELECT datname FROM pg_database WHERE datallowconn AND datistemplate = false ORDER BY datname`
	case "mysql":
		q = `SHOW DATABASES`
	default:
		return nil, fmt.Errorf("unknown engine")
	}
	cols, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return nil, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	_ = cols
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if len(r) > 0 {
			out = append(out, r[0])
		}
	}
	return out, nil
}

func (a *App) DataListTables(sessionID, database string) ([]string, error) {
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return nil, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return nil, err
	}
	dbName := strings.TrimSpace(database)
	if sess.db != nil {
		if src.Engine == "postgres" {
			sch := strings.TrimSpace(database)
			if sch == "" {
				sch = "public"
			}
			out, err := dataListTables("postgres", sess.db, sch)
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
		out, err := dataListTables("mysql", sess.db, dbName)
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	var q string
	switch src.Engine {
	case "postgres":
		sch := "public"
		q = fmt.Sprintf(`SELECT tablename FROM pg_tables WHERE schemaname = %s ORDER BY tablename`, quotePGIdent(sch))
		// wrong - need string literal for schema
		q = `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
	case "mysql":
		if dbName == "" {
			return nil, errors.New("database required")
		}
		q = "SHOW TABLES FROM " + quoteMySQLIdent(dbName)
	default:
		return nil, fmt.Errorf("unknown engine")
	}
	cols, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return nil, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	_ = cols
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if len(r) > 0 {
			out = append(out, r[0])
		}
	}
	return out, nil
}

// DataListSchemas returns PostgreSQL schema names in the current database. MySQL returns an empty slice.
func (a *App) DataListSchemas(sessionID string) ([]string, error) {
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return nil, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return nil, err
	}
	if src.Engine != "postgres" {
		return []string{}, nil
	}
	if sess.db != nil {
		out, err := dataListPostgresSchemas(sess.db)
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	q := `SELECT nspname FROM pg_catalog.pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema')
AND nspname NOT LIKE 'pg_toast%'
AND nspname NOT LIKE 'pg_temp\_%' ESCAPE '\'
ORDER BY nspname`
	cols, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return nil, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	_ = cols
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if len(r) > 0 {
			out = append(out, r[0])
		}
	}
	return out, nil
}

// DataListTableColumns returns column names and logical data types for browse / SQL sidebar.
func (a *App) DataListTableColumns(sessionID, database, table string) ([]DataColumnMetaDTO, error) {
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return nil, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return nil, err
	}
	db := strings.TrimSpace(database)
	tbl := strings.TrimSpace(table)
	if tbl == "" {
		return nil, errors.New("table required")
	}
	if sess.db != nil {
		schemaOrDB := db
		if src.Engine == "postgres" && schemaOrDB == "" {
			schemaOrDB = "public"
		}
		out, err := dataListTableColumns(src.Engine, sess.db, schemaOrDB, tbl)
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	var q string
	switch src.Engine {
	case "postgres":
		sch := "public"
		if db != "" {
			sch = db
		}
		q = fmt.Sprintf(`SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = '%s' AND table_name = '%s'
ORDER BY ordinal_position`, strings.ReplaceAll(sch, "'", "''"), strings.ReplaceAll(tbl, "'", "''"))
	case "mysql":
		if db == "" {
			return nil, errors.New("database required")
		}
		q = fmt.Sprintf(`SELECT COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '%s' AND TABLE_NAME = '%s'
ORDER BY ORDINAL_POSITION`, strings.ReplaceAll(db, "'", "''"), strings.ReplaceAll(tbl, "'", "''"))
	default:
		return nil, fmt.Errorf("unknown engine")
	}
	cols, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return nil, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	_ = cols
	out := make([]DataColumnMetaDTO, 0, len(rows))
	for _, r := range rows {
		if len(r) >= 2 {
			out = append(out, DataColumnMetaDTO{Name: r[0], DataType: r[1]})
		} else if len(r) == 1 {
			out = append(out, DataColumnMetaDTO{Name: r[0], DataType: ""})
		}
	}
	return out, nil
}

func (a *App) DataTablePreview(sessionID, database, table string, limit, offset int, sortColumn, sortDir, filterJSON string) (DataQueryResultDTO, error) {
	var out DataQueryResultDTO
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return out, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return out, err
	}
	db := strings.TrimSpace(database)
	tbl := strings.TrimSpace(table)
	if tbl == "" {
		return out, errors.New("table required")
	}
	if sess.db != nil {
		var schemaOrDB string
		if src.Engine == "postgres" {
			schemaOrDB = strings.TrimSpace(db)
			if schemaOrDB == "" {
				schemaOrDB = "public"
			}
		} else {
			schemaOrDB = db
		}
		total, err := dataTableRowCount(src.Engine, sess.db, schemaOrDB, tbl, filterJSON)
		if err != nil {
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
		cols, rows, err := dataTablePreview(src.Engine, sess.db, schemaOrDB, tbl, limit, offset, sortColumn, sortDir, filterJSON)
		if err != nil {
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
		return DataQueryResultDTO{Columns: cols, Rows: rows, TotalRows: total}, nil
	}
	if strings.TrimSpace(filterJSON) != "" {
		return out, errors.New("table filters require a direct database connection")
	}
	var q string
	var countQ string
	switch src.Engine {
	case "postgres":
		sch := "public"
		if db != "" {
			sch = db
		}
		tn := quotePGIdent(sch, tbl)
		ord, err := a.remotePreviewOrderClause(sess, src, sch, tbl, sortColumn, sortDir)
		if err != nil {
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
		q = fmt.Sprintf(`SELECT * FROM %s%s LIMIT %d OFFSET %d`, tn, ord, max1(limit, 200), max0(offset))
		countQ = fmt.Sprintf(`SELECT COUNT(*)::bigint FROM %s`, tn)
	case "mysql":
		if db == "" {
			return out, errors.New("database required")
		}
		tn := quoteMySQLIdent(db, tbl)
		ord, err := a.remotePreviewOrderClause(sess, src, db, tbl, sortColumn, sortDir)
		if err != nil {
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
		q = fmt.Sprintf(`SELECT * FROM %s%s LIMIT %d OFFSET %d`, tn, ord, max1(limit, 200), max0(offset))
		countQ = fmt.Sprintf(`SELECT COUNT(*) FROM %s`, tn)
	default:
		return out, fmt.Errorf("unknown engine")
	}
	total, err := a.dataRunQueryCountScalar(sess, src, countQ)
	if err != nil {
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	cols, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	return DataQueryResultDTO{Columns: cols, Rows: rows, TotalRows: total}, nil
}

func (a *App) DataExecSQL(sessionID, database, sqlText string, offset int) (DataQueryResultDTO, error) {
	var out DataQueryResultDTO
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return out, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return out, err
	}
	if offset < 0 {
		offset = 0
	}
	original := strings.TrimSpace(sqlText)
	var execSQL string
	if isSelectLikeSQL(original) && !hasTrailingRowLimit(original) {
		execSQL = buildPagedSelect(original, 100, offset)
	} else {
		execSQL = ensureSQLDefaultLimit(original, 100)
	}

	var cols []string
	var rows [][]string
	if sess.db != nil {
		schemaOrDB := strings.TrimSpace(database)
		if src.Engine == "postgres" && schemaOrDB == "" {
			schemaOrDB = "public"
		}
		cols, rows, err = dataExecUserSQL(src.Engine, sess.db, schemaOrDB, execSQL)
		if err != nil {
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
	} else {
		db := strings.TrimSpace(database)
		if src.Engine == "mysql" && db != "" {
			src.Database = db
		}
		cols, rows, err = a.dataRunQuery(sess, src, execSQL)
		if err != nil {
			return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
		}
	}

	total := int64(len(rows))
	if isSelectLikeSQL(original) {
		needCount := offset == 0 || hasTrailingRowLimit(original)
		if needCount {
			countQ := buildSQLCountQuery(original)
			if sess.db != nil {
				schemaOrDB := strings.TrimSpace(database)
				if src.Engine == "postgres" && schemaOrDB == "" {
					schemaOrDB = "public"
				}
				if n, e := dataCountUserSQL(src.Engine, sess.db, schemaOrDB, countQ); e == nil {
					total = n
				}
			} else {
				db := strings.TrimSpace(database)
				if src.Engine == "mysql" && db != "" {
					src.Database = db
				}
				if n, e := a.dataRunQueryCountScalar(sess, src, countQ); e == nil {
					total = n
				}
			}
		} else if offset > 0 {
			total = -1
		}
	}

	return DataQueryResultDTO{Columns: cols, Rows: rows, TotalRows: total}, nil
}

func max1(a, b int) int {
	if a > 0 {
		return a
	}
	return b
}

func max0(a int) int {
	if a < 0 {
		return 0
	}
	return a
}

func (a *App) DataPrimaryKeyColumns(sessionID, database, table string) ([]string, error) {
	sess, err := a.getDataSession(sessionID)
	if err != nil {
		return nil, err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return nil, err
	}
	db := strings.TrimSpace(database)
	tbl := strings.TrimSpace(table)
	if tbl == "" {
		return nil, errors.New("table required")
	}
	if sess.db != nil {
		schemaOrDB := db
		if src.Engine == "postgres" && schemaOrDB == "" {
			schemaOrDB = "public"
		}
		out, err := dataPrimaryKeyColumns(src.Engine, sess.db, schemaOrDB, tbl)
		return out, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	var q string
	switch src.Engine {
	case "postgres":
		sch := "public"
		if db != "" {
			sch = db
		}
		q = fmt.Sprintf(`SELECT kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = '%s' AND tc.table_name = '%s' AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY kcu.ordinal_position`, strings.ReplaceAll(sch, "'", "''"), strings.ReplaceAll(tbl, "'", "''"))
	case "mysql":
		if db == "" {
			return nil, errors.New("database required")
		}
		q = fmt.Sprintf(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = '%s' AND TABLE_NAME = '%s' AND CONSTRAINT_NAME = 'PRIMARY'
ORDER BY ORDINAL_POSITION`, strings.ReplaceAll(db, "'", "''"), strings.ReplaceAll(tbl, "'", "''"))
	default:
		return nil, fmt.Errorf("unknown engine")
	}
	cols, rows, err := a.dataRunQuery(sess, src, q)
	if err != nil {
		return nil, a.dataErrAfterMaybeInvalidate(sessionID, err)
	}
	_ = cols
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if len(r) > 0 {
			out = append(out, r[0])
		}
	}
	return out, nil
}

type DataRowMutationRequest struct {
	SessionID string            `json:"sessionId"`
	Database  string            `json:"database"`
	Table     string            `json:"table"`
	Columns   []string          `json:"columns"`
	Values    []string          `json:"values"`
	PKColumns []string          `json:"pkColumns"`
	PKValues  []string          `json:"pkValues"`
}

func (a *App) DataUpdateRow(req DataRowMutationRequest) error {
	sess, err := a.getDataSession(req.SessionID)
	if err != nil {
		return err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return err
	}
	if sess.db == nil {
		return errors.New("row edit requires SSH transport in this build for docker exec path")
	}
	schemaOrDB := strings.TrimSpace(req.Database)
	if src.Engine == "postgres" && schemaOrDB == "" {
		schemaOrDB = "public"
	}
	err = dataUpdateRow(src.Engine, sess.db, schemaOrDB, strings.TrimSpace(req.Table), req.Columns, req.Values, req.PKColumns, req.PKValues)
	return a.dataErrAfterMaybeInvalidate(req.SessionID, err)
}

func (a *App) DataDeleteRow(req DataRowMutationRequest) error {
	sess, err := a.getDataSession(req.SessionID)
	if err != nil {
		return err
	}
	src, err := a.loadDataSourceRow(sess.dataSourceID)
	if err != nil {
		return err
	}
	if sess.db == nil {
		return errors.New("row delete requires SSH transport in this build for docker exec path")
	}
	schemaOrDB := strings.TrimSpace(req.Database)
	if src.Engine == "postgres" && schemaOrDB == "" {
		schemaOrDB = "public"
	}
	err = dataDeleteRow(src.Engine, sess.db, schemaOrDB, strings.TrimSpace(req.Table), req.PKColumns, req.PKValues)
	return a.dataErrAfterMaybeInvalidate(req.SessionID, err)
}
