# Light SQL client (Data tab) — implementation roadmap

Lightweight database access for **PostgreSQL** and **MySQL/MariaDB**, integrated as a **Data** tab on top of existing SSH **profile/session** flows. Not a replacement for DBeaver or full DB IDEs.

## Principles

- **Tunnel-only**: the app connects to the database **only through an active SSH session** using **local port forwarding** (`ssh -L` semantics). No direct TCP from the workstation to the database host/port except via that tunnel.
- **Same trust model as SSH**: DB credentials use existing secret storage (`keyring` / `internal` vault) where applicable.
- **Small scope**: browse schema, inspect and edit rows where safe, run ad-hoc read/write SQL with clear warnings — not migrations, ER diagrams, or full admin suites.

## Goals

- **Data** tab available when a suitable SSH-backed context exists (same profile/session story as Terminal / SFTP).
- **PostgreSQL** and **MySQL/MariaDB**: list databases/schemas/tables (as applicable), preview rows, insert/update/delete row with confirmation.
- **Custom SQL**: execute user query, show results in a **table grid**; export result to CSV (optional phase).
- Tunnel lifecycle tied to UI session: **open forward → connect drivers → close forward** on disconnect or tab close.

## Non-goals

- Direct database connections without SSH tunnel.
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
   - Row actions: **Edit**, **Delete**, **Add row** (simple forms from column metadata).
   - **Query** sub-panel: textarea for SQL, **Run**, results grid, optional row count / execution time.

4. **State**
   - Persist **non-secret** preferences (last database, table, page size) per profile ID in existing SQLite store if useful; secrets never in plaintext in DB.

## Prerequisites (engineering)

- [ ] Confirm SSH layer can expose **local port forwarding** over an existing `ssh.Client` (Go `x/crypto/ssh` TCP channel forwarding), or implement it safely.
- [ ] Define UX when **no SSH session**: Data tab disabled with short explanation (“Connect via SSH first” / “Open tunnel profile”).
- [ ] Error surfaces for **forward bind failures**, **driver auth failures**, **RBAC** on DB side.

## Phase 0 — Tunnel plumbing (foundation)

- [ ] API: `OpenDataTunnel(profileId, remoteHost, remotePort) -> { localPort, tunnelId }` (names indicative).
- [ ] API: `CloseDataTunnel(tunnelId)`; ensure cleanup on SSH disconnect.
- [ ] Unit tests with fake SSH or integration test script (optional).
- [ ] Document in `PRIVACY.md`: Data tab uses localhost forward; credentials stay client-side.

## Phase 1 — PostgreSQL (read-first)

- [ ] Connect through `127.0.0.1:<localPort>` after tunnel up.
- [ ] List databases / schemas / tables (information_schema or `pg_catalog`).
- [ ] Table preview: `SELECT` with **LIMIT** (configurable default, e.g. 200 rows).
- [ ] Read-only mode flag (optional): block `INSERT`/`UPDATE`/`DELETE` in UI when enabled.

## Phase 2 — PostgreSQL (mutations)

- [ ] **Insert row**: form from column list + types; `INSERT` with parameterized query.
- [ ] **Update row**: identify row via primary key detection when possible; fallback to “where” from selected row cells with strong confirmation.
- [ ] **Delete row**: confirm dialog; use transactions where appropriate.
- [ ] Handle types: timestamps, NULL, text; defer JSON/bytea heavy editing if needed.

## Phase 3 — MySQL / MariaDB (parity)

- [ ] Same feature set as Postgres: list DBs/tables, preview, insert/update/delete, custom query.
- [ ] Respect engine differences (`information_schema`, quoting, `SHOW TABLES` where needed).

## Phase 4 — Custom SQL and polish

- [ ] Single **Query** editor with syntax-neutral execution path; engine-specific error display.
- [ ] Optional: export result grid to CSV.
- [ ] Optional: **dangerous statement** warning (`DROP`, `TRUNCATE`, DDL) — block or require typed confirmation.

## Security and safety

- No DB traffic outside the SSH tunnel path described above.
- **Parameterized queries** for all structured operations; never string-concat user input into SQL for mutations.
- Clear warnings for destructive operations; optional org-style “read-only Data” policy later (enterprise).
- Logging: do not write SQL text containing secrets to app logs by default.

## Open decisions (resolve before heavy UI work)

1. **Tunnel target**: only `127.0.0.1` on remote, or arbitrary remote host reachable from SSH session (both are valid; UX must capture remote target host + port).
2. **One tunnel per profile vs per tab**: default one active Data tunnel per profile session to avoid port explosion.
3. **Primary key detection**: use DB metadata; document fallback when no PK.

## Success criteria

- User with SSH access to a host can open **Data**, forward through SSH, and complete: browse tables → run `SELECT` → edit one row → run custom `SELECT` without leaving daimon.
- PostgreSQL and MySQL/MariaDB paths both work for the same UX baseline.
- Disabling SSH or closing session reliably tears down tunnel and DB connections.
