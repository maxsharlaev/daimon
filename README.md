# daimon

`daimon` is a **Golang + Wails** desktop app for working with remote hosts: an **SSH terminal**, **SFTP file browser**, **Places** (saved remote paths), **Macros** (parameterized scripts), and a Linux **Dashboard** (metrics + alerts).

## License

- Source code: **MPL-2.0** (see `LICENSE`)
- Trademarks (name/logo usage): see `TRADEMARKS.md`

## Security and Privacy

- Security policy and vulnerability reporting: `SECURITY.md`
- Privacy and local data handling: `PRIVACY.md`
- Threat model: `docs/security/THREAT_MODEL.md`
- Hardening plan: `docs/security/HARDENING_ROADMAP.md`

## Features

- **Split layout**: two panels with a draggable divider.
- **SSH terminal**: xterm.js-based interactive PTY shell streaming via Wails events.
- **SFTP files**: multiple file sessions per profile.
- **Profiles & groups**: organize connections; import/export profiles (encrypted).
- **Places**: saved “entry points” (remote paths) per profile:
  - save current `pwd` from a terminal session (**+ Location**),
  - open a place directly in **Terminal** (`cd <path>`) or **Files** (navigate SFTP).
- **Macros**: parameterized scripts you can run against a profile:
  - search by name/tags, clone, delete
  - favorites are stored per-profile (bindings)
  - run with a parameter form + preview; the rendered script is sent to SSH.
- **Dashboard** (Linux): one dashboard session per profile (multiple profiles → multiple dashboards):
  - pages (tabs): create/rename/delete (with confirmation); “General” is locked
  - grid rows with 1/2/3 columns; add/remove widgets; row context menu (edit/move/delete)
  - layout persistence per profile
- **SSH auth**:
  - password
  - private key file (+ optional passphrase)
  - connection test (`Test`)
  - exec-only SSH connections for the Dashboard (no PTY / no shell).

## Development

From the project root:

```bash
wails dev
```

## Build

```bash
wails build
```

## Quick start: SSH

1. Run the app (`wails dev`).
2. In **Connection** set `Host/Port/User`.
3. Choose **Password** or **Key**:
   - **Password**: enter password.
   - **Key**: pick a private key file (Browse…); optionally provide passphrase.
4. Click **Test** (expected: `daimon-ok`).
5. Click **Connect** to open an interactive SSH shell session.

## Places

- **Save from terminal**: in an active SSH terminal click **+ Location** — current `pwd` is saved as a Place (you can name it).
- **Open a place**: in **Places** pick an entry and click:
  - **Terminal** — opens/activates a terminal session for the profile and runs `cd <path>`,
  - **Files** — opens/activates SFTP and navigates to the directory.

Tip: the **Files** button in the terminal titlebar opens SFTP at the terminal’s current directory (resolved via `pwd`).

## Macros

A macro is a script template that is rendered locally and then sent to the SSH terminal of a chosen profile.

- **Create/edit**: **+ Macro** (tabs: Script / Data / Params).
- **Run**: `Run` → fill params → preview → send to terminal.
- **Favorites**: the star is stored per profile (macro bindings).

### Template syntax

- **Params**: `##param_name##` — replaced with values from the Run form.
- **Data items**: `??key??` — replaced with values from the Data tab (after param substitution).


## Dashboard (Linux)

1. Create or select a profile.
2. Click **Dashboard** on the profile card.
3. Add dashboard pages with **+ Tab**.
4. Add rows via **+ Row** (choose 1/2/3 columns).
5. Use **+ Add widget** in empty slots.

Notes:
- Dashboard uses an exec-only SSH session and runs Linux commands like `df`, `ps`, and reads `/proc/*`.
- Target host must be Linux.

## Host key verification

There is an **Insecure: ignore host key (MVP)** option:

- **Enabled (default)**: uses `InsecureIgnoreHostKey` — convenient for quick testing, but **not secure**.
- **Disabled**: enables host key verification via `~/.ssh/known_hosts`.
  - If the file is missing, backend returns an error (either create `known_hosts` or enable insecure mode).

## Architecture (high level)

- Go backend:
  - `app.go`: Wails-exposed methods (`SSHConnect/SSHSend/SSHResize`, SFTP, Places, Macros, UI layout storage).
  - `ssh_manager.go`: SSH dial, PTY shell sessions, exec-only sessions, event streaming (`ssh:output`, `ssh:state`).
  - `dashboard_api.go`: Linux snapshot collector (df/ps/proc), DTOs, alert rules.
- Frontend:
  - `frontend/src/App.tsx`: global session state, left/right panes, Places/Macros modals.
  - `frontend/src/components/ConnectionsPanel.tsx`: profiles & groups, Connect/Files/Dashboard actions.
  - `frontend/src/components/TerminalTabs.tsx` + `TerminalPanel.tsx`: terminal sessions and xterm integration.
  - `frontend/src/components/FilesTabs.tsx`: SFTP sessions UI.
  - `frontend/src/components/PlacesPanel.tsx`: saved remote paths.
  - `frontend/src/components/MacrosPanel.tsx` + `MacroEditorModal.tsx` + `MacroRunModal.tsx`: macro authoring + run flow.
  - `frontend/src/components/DashboardTabs.tsx` + `DashboardPanel.tsx`: dashboard pages + grid widgets.
  - `frontend/src/components/SplitView.tsx`: resizable layout.
