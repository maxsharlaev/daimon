# Contributing

Thanks for contributing.

By submitting a pull request, you agree that your contribution is licensed under the
**Mozilla Public License 2.0 (MPL-2.0)**, the same license as the project.

Please ensure you have the right to contribute the code (authorship or permission).

## Working on the app

Requirements and commands are in the root `README.md`.

- Desktop app: `wails dev` / `wails build` from the repository root.
- Go tests: `go test ./...`
- Website demo (no backend): `promo/README.md` (`cd promo && npm install && npm run dev`).

Promo screens under `promo/src` are a separate copy of the UI. CSS in `promo/src/styles/from-app/` is copied from `frontend` by hand. A visual change in the app is not visible in the demo until that copy is updated.

Do not commit build outputs (`daimon.exe`, `build/bin`, `promo/dist`).

## Security reports

Do not file a public issue for an unpatched vulnerability. Use `SECURITY.md`.
