# Product roadmap (index)

Single entry point for **in-app** and **adjacent** plans. Depth lives in linked documents; this file tracks priority and scope.

## Principles (summary)

- **Core**: reliable SSH/SFTP, Macros, Places, Linux Dashboard — local-first, explicit network use.
- **Extensions**: Docker today; Kubernetes and Data/SQL as documented tracks.
- **Trust**: security defaults and disclosure process before expanding surface area.
- **Ecosystem**: releases, signing, optional commercial services — separate from core UX (see ecosystem doc).

## Priority order (living document)

1. **Security hardening** — host keys, SFTP parity, safe defaults: `docs/security/HARDENING_ROADMAP.md`  
   Context: `docs/security/THREAT_MODEL.md`, `SECURITY.md`, `PRIVACY.md`.

2. **Core stability** — SSH/SFTP/Dashboard/Macros UX and bugs; optional settings to disable heavy modes (e.g. Docker) where not needed.

3. **Data / Light SQL** (SSH tunnel only, Postgres + MySQL/MariaDB): `docs/sql/LIGHT_SQL_ROADMAP.md`.

4. **Kubernetes mode** (browse / exec / files / logs — phased): `docs/kubernetes/IMPLEMENTATION_ROADMAP.md`.

5. **Ecosystem** (releases site, billing, team features — scope only until built): `docs/ecosystem/AROUND_DAIMON.md`.

## Explicitly out of scope (until reconsidered)

- Full REST client competing with Postman-class tools.
- Universal in-browser terminal SaaS.
- Heavy enterprise backend (SSO, org policy server) **before** pilots justify it.

## When to update this file

After each major release or when priorities shift (e.g. K8s before SQL if the audience demands it). Linked docs should stay the source of detail; adjust **section 2–5 order** here when the decision changes.
