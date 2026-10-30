# Product roadmap (index)

Single entry point for **what the app already does** and **what is still planned**. Detail lives in the linked documents.

## Shipped in the desktop app

Top-level modes in `frontend/src/App.tsx`: **Local**, **Connections**, **Docker**, **Logs**, **Data**, **Settings**.

- **Local**: local file panes and a local PTY.
- **Connections**: SSH terminal, SFTP, Places, Macros, Linux Dashboard.
- **Docker**: local daemon and remote daemon over an SSH profile (containers, images, volumes, networks, logs, shell, files).
- **Logs**: sources on an SSH profile or a Docker container, with configurable formats and a local query store.
- **Data**: PostgreSQL and MySQL/MariaDB over an SSH tunnel or Docker (local/remote). Status and remaining gaps: `docs/sql/LIGHT_SQL_ROADMAP.md`.
- **Agent**: optional. Requires an OpenAI-compatible integration in Settings. The panel is mounted on Connections and Docker only.
- **Settings**: logs/formats, macros, places, AI, data sources, developer AI logs, privacy.

Secrets: OS keyring and/or the encrypted internal vault. There is no cloud account inside the app.

## Principles

- **Trust first**: security defaults and disclosure before new surface area. Host key verification is on for SSH connections unless a profile opts out. `docs/security/HARDENING_ROADMAP.md`.
- **Local-first**: network use is explicit. Logs, chats, and data-source metadata stay on disk.
- **Extensions stay narrow**: Data is a light SQL client, not a database IDE. Kubernetes, if built, should follow the Docker UX, not replace `kubectl`.

## Priority order

1. **Security hardening** — remaining items in `docs/security/HARDENING_ROADMAP.md`. Context: `docs/security/THREAT_MODEL.md`, `SECURITY.md`, `PRIVACY.md`.

2. **Core stability** — bugs and rough edges in the modes already shipped (SSH/SFTP, Local, Docker, Logs, Data, Agent, Dashboard, Macros).

3. **Data / Light SQL gaps** — the Data mode exists. Still open: a dedicated insert-row form, CSV export, typed confirmation for DDL. `docs/sql/LIGHT_SQL_ROADMAP.md`.

4. **Kubernetes mode** — not started (no client, no UI). `docs/kubernetes/IMPLEMENTATION_ROADMAP.md`.

5. **Ecosystem** — not in this repository. A releases site, billing, or team features would live beside the app, not as a required backend. There is no separate ecosystem spec checked in; do not treat that work as part of the desktop tree until a repo or doc exists.

## Explicitly out of scope (until reconsidered)

- Full REST client competing with Postman-class tools.
- Universal in-browser terminal SaaS.
- Heavy enterprise backend (SSO, org policy server) before pilots justify it.
- Direct database TCP from the workstation in SSH Data mode (Docker modes reach the database from inside the container network).

## When to update this file

After a mode ships or a priority swaps (for example Kubernetes ahead of the remaining SQL gaps). Linked docs stay the source of detail; change the order in this file when the decision changes.
