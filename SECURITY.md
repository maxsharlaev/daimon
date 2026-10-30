# Security Policy

## Scope

This project handles infrastructure connection data (SSH profiles, credentials, key
material, command output, remote file paths), **ingested log lines and metadata** (Logs
workspace), and **optional AI assistant** data (local chat history, usage metadata, and
user-configured LLM API access). Security reports are welcome and appreciated.

## Reporting a Vulnerability

Please do **not** open a public issue for unpatched security problems.

Preferred channels:

- GitHub: use the repository **Security Advisory / Report a vulnerability** flow
- Private contact: GitHub Private Vulnerability Reporting (preferred) or email max@sharlaev.com.

When possible, include:

- affected version/commit
- reproduction steps and impact
- proof of concept (minimal)
- suggested fix (optional)

## Response Targets

Best-effort targets (not an SLA):

- initial acknowledgement: within **72 hours**
- triage status: within **7 days**
- fix timeline: depends on severity and complexity

## Disclosure Process

1. Report received privately
2. Triage and impact assessment
3. Patch prepared and validated
4. Coordinated release
5. Public advisory/changelog entry after fix is available

## Supported Versions

Current development branch and latest release are supported on a best-effort basis.
Older releases may require upgrade before a patch can be applied.

## Current Security Notes (Important)

The project is under active development. Current known security limitations include:

- A profile can skip host key verification (off by default); such profiles are marked in the connections list.
- threat model and hardening roadmap are documented in `docs/security/`
- when **AI integration** is enabled, user content and agent context may be sent to the
  **third-party LLM endpoint** you configure; treat this as sensitive data crossing a
  trust boundary
- **Log ingestion** stores arbitrary log content locally; rely on retention/redaction
  settings and disk protections for sensitive environments

See:

- `PRIVACY.md`
- `docs/security/THREAT_MODEL.md`
- `docs/security/HARDENING_ROADMAP.md`
