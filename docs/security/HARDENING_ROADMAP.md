# Security Hardening Roadmap

This roadmap tracks practical improvements that raise trust for users handling
sensitive infrastructure data.

## Priority 0 (Critical)

- Make SSH host key verification secure-by-default
- Implement proper SFTP host key verification (known_hosts parity with SSH path)
- Add explicit UX warnings and friction for insecure connection modes

## Priority 1 (High)

- Add immediate vault password validation sentinel/check during unlock
- Improve secret redaction in errors and UI-visible failure messages
- Add security-focused tests for credential and host-key behavior
- Document exact data flows and persistence per feature
- **Logs**: expand regression tests around redaction, retention pruning, and large-file read limits; document recommended patterns for high-sensitivity environments
- **AI**: document exactly which fields are sent to the LLM on each request (including agent context and tool payloads); add tests around secret handling for the API key path

## Priority 2 (High)

- Publish signed release artifacts with checksum files
- Provide deterministic/reproducible build instructions
- Add dependency vulnerability scanning in CI
- Publish a machine-readable SBOM for releases

## Priority 3 (Medium)

- Add secure diagnostics mode with explicit opt-in
- Add optional secret access audit trail (local only, redacted)
- Improve clipboard safety UX for secret copy operations
- **AI**: optional explicit “preview what will be sent” before the first message in a session; optional per-profile allowlist/denylist for agent context fields
- **Privacy UI**: ensure destructive actions (delete conversations, clear log data) are clearly scoped and confirmed; consider export-before-delete for user-owned archives

## Priority 4 (Medium)

- External security review / targeted code audit
- Structured incident response checklist for maintainers
- Expanded platform hardening guidance for enterprise users

## Status Notes

This project is in active development. Items are planned and may be reordered
based on reported risks, user feedback, and available maintainer capacity.
