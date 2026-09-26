# Light SQL client (Data mode) — status and remaining work

Lightweight database access for **PostgreSQL** and **MySQL/MariaDB**. It is a top-level **Data** mode, not a panel inside Connections. Not a replacement for DBeaver or a full database IDE.

## Status against this document

Shipped in `data_api.go`, `data_sql.go`, and `frontend/src/components/DataWorkspace.tsx`:

- Saved data sources (`ssh`, `docker_local`, `docker_remote`). Passwords use secret kind `data_source_password`.
- **SSH**: a dedicated exec-only SSH client and a localhost forward to `DataSource.Host:Port` (the host as seen from the SSH session, not only remote `127.0.0.1`). `DataConnect` / `DataDisconnect` own the tunnel. Connections terminal sessions are not reused.
- **Docker local and remote**: queries run inside the target container network (exec and/or an ephemeral sidecar). A published `-p` port is not required.
- List databases, schemas, tables, and columns. Table preview with limit, offset, sort, and JSON filters.
- SQL editor, `DataExecSQL`, `DataExplainSQL` (plain and analyze), mutation preview, then execute.
- Row **update** and **delete** when a primary key can be resolved (`DataPrimaryKeyColumns`, `DataUpdateRow`, `DataDeleteRow`).
- UI confirmation banner before `INSERT` / `UPDATE` / `DELETE` and before DDL (`DROP`, `TRUNCATE`, `ALTER`, `CREATE`, …). Proceed is a button, not a typed phrase.
- `PRIVACY.md` already describes the Data tab, the localhost forward, and Docker sidecar access.
- Tests: `data_sql_classify_test.go`, `data_sql_mutate_test.go`, `data_docker_sidecar_test.go`.

Not shipped:

- A column form for **insert row** (insert is ad-hoc SQL plus the mutation banner).
- CSV export of the result grid.
- Typed confirmation for DDL.
- A read-only policy switch that blocks writes in the UI.

Resolved decisions that this file used to leave open:

1. Tunnel target is the saved host and port, reachable from the SSH session. The local side binds an ephemeral port on `127.0.0.1`.
2. One tunnel per `DataConnect` session, not a single tunnel for the whole profile.
3. Primary key comes from database metadata. If none is found, row edit stops with an error instead of guessing a `WHERE` clause.

## Principles

- **SSH mode (tunnel-only)**: for **Data + SSH**, the app connects to the database **only through a dedicated SSH session** used by the Data tab (not shared with Connections terminal sessions), using **local port forwarding** (`ssh -L` semantics) to reach `host:port` on the remote side.
- **Docker modes**: **Docker local** and **Docker remote** reach the DB **from inside the target container’s network namespace** via `docker exec` and/or ephemeral **sidecar** containers (`docker run --network container:…`), so a published host port (`-p`) is **not** required.
- **Isolation from Connections**: Data SSH transports do **not** reuse or surface Connections terminal/SFTP/Dashboard session IDs; profile records are shared only as **saved connection metadata** for picking host/user and building SSH config.
- **Same trust model as SSH profiles for secrets**: DB passwords use existing secret storage (`keyring` / `internal` vault) with a dedicated secret kind (`data_source_password`).
- **Small scope**: browse schema, inspect and edit rows where safe, run ad-hoc read/write SQL with clear warnings — not migrations, ER diagrams, or full admin suites.

## Goals

- **Data** mode with saved sources. SSH transport does not require a Connections terminal to be open.
- **PostgreSQL** and **MySQL/MariaDB**: list databases/schemas/tables, preview rows, update/delete a row with confirmation. Insert via the SQL editor (no dedicated insert form yet).
- **Custom SQL**: execute, show a grid, `EXPLAIN` / `EXPLAIN ANALYZE`. CSV export is still optional and not built.
- Tunnel lifecycle follows the Data session: open forward, connect the driver, close both on disconnect.

## Non-goals

- Direct database connections from the workstation for **SSH mode** without an SSH tunnel (Docker modes use in-container access as above, not host TCP to unpublished ports).
- SQL Server, Oracle, SQLite in this roadmap (can be revisited later).
- Visual schema designer, query plan UI comparable to heavy clients.
- Long-running monitoring / APM (see optional future: snapshot “slow queries” only as a separate doc).

## Architecture (high level)

1. **SSH local port forward**
   - For a given active SSH `Client`, bind a **localhost** port on the machine running daimon.
   - Forward to **remote** `host:port` (typically `127.0.0.1:5432` or `127.0.0.1:3306` on the jumped host, or another host reachable from that SSH session).
   - Forward must be **exclusive per Data session** or carefully multiplexed; document port allocation (dynamic ephemeral local port).

2. **Drivers (Go)**
   - PostgreSQL: `pgx` or `lib/pq` (choose one; prefer maintained stack).
   - MySQL/MariaDB: `go-sql-driver/mysql` or compatible.

3. **UI**
   - **Data** tab: connection strip (engine, forwarded target summary), tree or lists for databases → tables, data grid for row preview.
   - Row actions shipped: **Edit** and **Delete** when a primary key exists. **Add row** as a column form is still not built.
   - **Query** sub-panel: textarea for SQL, **Run**, results grid, optional row count / execution time.

4. **State**
   - Persist **non-secret** preferences (last database, table, page size) per profile ID in existing SQLite store if useful; secrets never in plaintext in DB.

## Prerequisites (engineering)

- [x] SSH local port forwarding over an `ssh.Client` (`startSSHTunnel` in the Data connect path).
- [x] Data mode is usable without a Connections terminal. The user creates a data source and connects it.
- [x] Forward bind failures and driver auth failures return as connect/query errors.

## Phase 0 — Tunnel plumbing (foundation)

- [x] Connect and disconnect a Data session (`DataConnect`, `DataDisconnect`), including the SSH forward. Names differ from the sketch below; behavior matches.
- [x] Cleanup closes the SQL pool, the tunnel, and the dedicated SSH client.
- [ ] Unit tests with a fake SSH server (classify, mutation preview, and Docker TSV parsing are tested; the forward itself is not).
- [x] Document in `PRIVACY.md`: Data tab uses a localhost forward; credentials stay client-side.

## Phase 1 — PostgreSQL (read-first)

- [x] Connect through `127.0.0.1:<localPort>` after the tunnel is up.
- [x] List databases / schemas / tables.
- [x] Table preview with `LIMIT` / offset (page size 100 in the UI), sort, and filters.
- [ ] Read-only mode flag: block `INSERT` / `UPDATE` / `DELETE` in the UI when enabled.

## Phase 2 — PostgreSQL (mutations)

- [ ] **Insert row** form from column metadata. Insert SQL in the editor is classified and confirmed; there is no row form.
- [x] **Update row** via primary key (`DataUpdateRow`). No fallback that builds `WHERE` from arbitrary cells.
- [x] **Delete row** via primary key (`DataDeleteRow`) with confirmation.
- [x] Timestamps, NULL, and text go through the grid editors that exist. Heavy JSON/bytea editing is still out of scope.

## Phase 3 — MySQL / MariaDB (parity)

- [x] List databases/tables, preview, update/delete, custom query, explain. Same gaps as PostgreSQL on insert-row form and CSV.
- [x] Engine-specific listing and quoting (including MySQL TSV parsing for the Docker sidecar path).

## Phase 4 — Custom SQL and polish

- [x] SQL editor, Run, result grid, engine errors surfaced in the UI.
- [ ] Export result grid to CSV.
- [x] Dangerous-statement gate: DDL and DML stop on a confirmation banner (`DataPreviewMutationSQL` / raw preview). Typed confirmation is not required.

## Security and safety

- No DB traffic outside the SSH tunnel path described above.
- **Parameterized queries** for all structured operations; never string-concat user input into SQL for mutations.
- Clear warnings for destructive operations; optional org-style “read-only Data” policy later (enterprise).
- Logging: do not write SQL text containing secrets to app logs by default.

## Success criteria

- User with SSH access to a host can open **Data**, connect a source, and complete: browse tables → run `SELECT` → edit one row → run custom `SELECT` without leaving daimon. This path is implemented.
- PostgreSQL and MySQL/MariaDB share that baseline, including Docker local/remote.
- Disconnect tears down the tunnel and the database pool for that Data session.
