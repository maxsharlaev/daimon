# Contributing

Thanks for contributing.

By submitting a pull request, you agree that your contribution is licensed under the
**Mozilla Public License 2.0 (MPL-2.0)**, the same license as the project.

Please ensure you have the right to contribute the code (authorship or permission).

## Working on the app

Requirements and commands are in the root `README.md`.

- Desktop app: `wails dev` / `wails build` from the repository root.
- Go tests: `go test ./...`
- Go lint: `golangci-lint run` (config in `.golangci.yml`).
- Website demo (no backend): `promo/README.md` (`cd promo && npm install && npm run dev`).

Promo screens under `promo/src` are a separate copy of the UI. CSS in `promo/src/styles/from-app/` is copied from `frontend` by hand. A visual change in the app is not visible in the demo until that copy is updated.

Do not commit build outputs (`daimon.exe`, `build/bin`, `promo/dist`).

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pull requests and on pushes to `main`:

- on pull requests, commit subjects against [Conventional Commits](#commit-messages);
- `npm run build` in `frontend`, then `go test ./...`, `go vet` and `golangci-lint` for Linux and Windows, and `go build`.

`go build` needs `frontend/dist`, so the frontend build runs first. This workflow does not run `wails build`.

## Commit messages

New commits use [Conventional Commits](https://www.conventionalcommits.org/). Existing history is left as it is. Merge commits are ignored.

```text
<type>: <subject>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`, `build`.

- The subject is a short English summary. The header, including the type, is at most 100 characters.
- A body, when present, starts after a blank line.
- A scope is optional: `feat(data): add row filter`.

```text
fix: verify SSH host keys for SFTP

Use the same known_hosts callback as interactive SSH.
```

## Security reports

Do not file a public issue for an unpatched vulnerability. Use `SECURITY.md`.
