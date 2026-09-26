# daimon

`daimon` is a **Golang + Wails** local-first desktop operator console. The top bar switches modes: **Local**, **Connections**, **Docker**, **Logs**, and **Data**, plus **Settings**. An optional **AI agent** opens on Connections and Docker when an OpenAI-compatible endpoint is configured.

## Positioning

One desktop app for the machine in front of you and the hosts you operate: a local shell and files, SSH terminals, SFTP, saved paths (**Places**), parameterized scripts (**Macros**), a Linux **Dashboard**, **Docker** (local daemon or remote over SSH), ingested **Logs**, and a light **Data** client for PostgreSQL and MySQL/MariaDB.

Secrets stay under user control (**OS keyring** and/or **encrypted internal vault**). Network use is explicit. The app is **open source (MPL-2.0)**. Releases, billing, and team services are not part of this repository — see **`docs/PRODUCT_ROADMAP.md`**.

## License

- Source code: **MPL-2.0** (see `LICENSE`)
- Trademarks (name/logo usage): see `TRADEMARKS.md`

## Security and Privacy

- Security policy and vulnerability reporting: `SECURITY.md`
- Privacy and local data handling: `PRIVACY.md`
- Threat model: `docs/security/THREAT_MODEL.md`
- Hardening plan: `docs/security/HARDENING_ROADMAP.md`

## Roadmaps

Prioritized work and what is already shipped: **`docs/PRODUCT_ROADMAP.md`**.

Depth:

- Data / Light SQL status: `docs/sql/LIGHT_SQL_ROADMAP.md`
- Kubernetes (not in the app yet): `docs/kubernetes/IMPLEMENTATION_ROADMAP.md`
- Hardening: `docs/security/HARDENING_ROADMAP.md`

## Modes

- **Local**: file panes on this machine and a local PTY shell. Layout toggles left/right panes and the terminal; the split is persisted.
- **Connections**: SSH profiles and groups. From a profile: interactive terminal, SFTP files, Places, Macros, and a Linux Dashboard.
- **Docker**: local engine or a remote engine reached through an SSH profile. Containers, images (including unused and dangling), volumes, networks; per-container logs, shell, and files.
- **Logs**: parse and query log files. A source belongs to an SSH profile, a local container, or a remote container. Formats are configured in Settings.
- **Data**: saved sources for **PostgreSQL** and **MySQL/MariaDB**. Transport is an SSH local forward, or Docker local/remote access inside the container network (no published host port required). Table preview (filter, sort, pagination), SQL editor, `EXPLAIN`, and a confirmation step before `INSERT` / `UPDATE` / `DELETE` / DDL.
- **Settings**: Logs, Formats, Macros, Places, AI Mode, Data, Developer Mode (AI Logs when developer mode is on), Privacy (overview, database, profiles, dialogs, maintenance).
- **Agent** (not a mode): shown when AI Mode uses an OpenAI-compatible integration. The panel is available on **Connections** and **Docker**. Runs can be approved or cancelled; an Agent output tab records them.

The website demo in `promo/` mirrors these screens without a backend. See `promo/README.md`.

## Connections

### Profiles and auth

- Groups and profiles; encrypted import/export.
- Password, or a private key file with an optional passphrase.
- **Test** (expected: `daimon-ok`) and **Connect**.
- Dashboard uses an exec-only SSH session (no PTY).

### Quick start: SSH

1. Run the app (`wails dev`).
2. Open **Connections** and create or edit a profile (`Host` / `Port` / `User`).
3. Choose **Password** or **Key**.
4. Click **Test**, then **Connect**.

### Places

Saved remote paths per profile.

- **Save from terminal**: in an active SSH terminal, **+ Location** stores the current `pwd`.
- **Open a place**: **Terminal** runs `cd <path>`, **Files** opens SFTP at that directory.
- The **Files** button in the terminal title bar opens SFTP at the terminal’s current directory.

### Macros

A macro is a script template rendered locally and sent to the SSH terminal of a chosen profile.

- **Create/edit**: **+ Macro** (Script / Data / Params).
- **Run**: parameter form, preview, then send.
- **Favorites**: the star is stored per profile.

Template syntax:

- **Params**: `##param_name##` — values from the Run form.
- **Data items**: `??key??` — values from the macro Data tab (after param substitution). This is not the **Data** mode.

### Dashboard (Linux)

1. Select a profile and click **Dashboard**.
2. Add pages with **+ Tab** (“General” is locked).
3. Add rows (**+ Row**, 1/2/3 columns) and widgets in empty slots.

The collector runs Linux commands (`df`, `ps`) and reads `/proc/*`. The target host must be Linux. Layout is stored per profile.

## Host key verification

Profiles have **Insecure: ignore host key**. It is **on by default** (`InsecureIgnoreHostKey`). That is convenient and **not secure**.

When the option is **off**, interactive SSH uses `~/.ssh/known_hosts` (`ssh_manager.go`). If that file is missing, the backend returns an error.

SFTP does not follow that switch yet. `internal/sftp/manager.go` always installs `ssh.InsecureIgnoreHostKey`, including when the flag is off. See `docs/security/HARDENING_ROADMAP.md`.

## Development

From the project root (Wails CLI required):

```bash
wails dev
```

Go tests:

```bash
go test ./...
```

Pull requests and pushes to `main` run tests, lint, the frontend build, and `go build` in GitHub Actions. Commit subjects follow Conventional Commits. Details are in `CONTRIBUTING.md`.

Promo demo (no Wails):

```bash
cd promo
npm install
npm run dev
```

## Build

```bash
wails build
```

`wails build` writes `build/bin/daimon.exe`. `wails dev` writes `build/bin/daimon-dev.exe`. Build assets live under `build/` (`build/README.md`).

`go build` with no `-o`, from this directory, writes `daimon.exe` in the repo root: the main package lives here, so Go names the binary after the directory and leaves it in the working directory. That file is not the Wails output. Pass `-o build/bin/daimon.exe`, or use `wails build`.

## Architecture (high level)

- Go backend (Wails methods on `App` in the root package):
  - `app.go`: app lifecycle.
  - `profiles_api.go`, `ssh_manager.go`, `sftp_api.go`: profiles, PTY/exec SSH, SFTP and transfers.
  - `dashboard_api.go`: Linux snapshots and alert rules.
  - `local_pty_api.go`, `local_system_api.go`: local shell and filesystem.
  - `docker_*.go`: local and remote Docker (containers, images, volumes, networks, logs, exec, files).
  - `logs_api.go`: log sources, formats, sync, query.
  - `data_api.go`, `data_sql.go`: data sources, SSH tunnel or Docker sidecar, SQL classify/execute/explain.
  - `ai_api.go`, `ai_chat.go`, `ai_explain.go`: settings, chat, command resolve, explain.
  - `privacy_api.go`: local privacy report and maintenance.
  - `internal/storage`: SQLite models and gormigrate migrations.
  - `internal/secrets`: keyring and encrypted vault.
- Frontend (`frontend/src`):
  - `App.tsx`: mode shell, connections sessions, agent open state.
  - `components/local/LocalWorkspace.tsx`: local files and terminal.
  - `components/ConnectionsPanel.tsx`, `TerminalTabs.tsx`, `FilesManager.tsx`, `PlacesPanel.tsx`, `MacrosPanel.tsx`, `DashboardPanel.tsx`.
  - `components/docker/DockerMode.tsx`: Docker sidebar and session tabs.
  - `components/LogsWorkspace.tsx`, `components/DataWorkspace.tsx`, `components/SettingsPage.tsx`, `components/AgentPanel.tsx`.
- Promo (`promo/src`): the same screens on mock data, for embedding. Styles under `promo/src/styles/from-app/` are copies of frontend CSS and are updated by hand.
