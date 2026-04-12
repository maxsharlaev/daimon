# Threat Model (MVP)

## Assets to Protect

- SSH credentials and private key material
- passphrases and user-defined secrets
- remote infrastructure metadata (hosts, paths, command output)
- exported profile containers
- **Logs workspace data**: ingested log lines and metadata persisted in the local database (paths, profile/container identifiers, parsed message and raw text, timestamps)
- **AI assistant data**: conversation threads, message payloads, optional conversation summaries, and local usage records (model, token counts, errors), plus the configured LLM API credential when stored
- **Settings / privacy UI state**: aggregated counts, database path references, and user actions that delete or retain the above

## Trust Boundaries

- local machine and user account
- remote hosts accessed through SSH/SFTP
- optional clipboard and OS-level integrations
- repository, release artifacts, and distribution channel
- **Optional LLM provider** (OpenAI-compatible HTTPS endpoint configured by the user): when AI integration is enabled, prompts and model responses cross this boundary; context may include session/profile/container metadata the agent uses for tools
- **Log sources**: file paths and log contents are read from configured SSH hosts or Docker contexts; ingested content is stored locally and may echo production secrets if present in logs

## Primary Threats

1. credential disclosure from local storage or memory
2. man-in-the-middle attacks when host key verification is weak
3. accidental leakage via exports, clipboard, screenshots, or logs
4. tampered binaries or compromised update/download channel
5. malicious or vulnerable dependencies (supply chain risk)
6. **Sensitive data in persisted log entries**: log lines may contain credentials, PII, or internal URLs; local DB backup or disk access exposes them
7. **Unintended disclosure to an LLM vendor**: enabling AI sends user text and agent/tool context to the configured remote API; misconfiguration (wrong endpoint), overly broad context, or malicious content in logs/terminals could increase exposure
8. **API key for LLM**: treated like other app secrets (keyring/vault); local malware or a compromised session could still attempt exfiltration

## Existing Controls

- optional OS keyring-backed secret storage
- optional internal encrypted vault
- encrypted profile export format
- mostly local-first architecture (no mandatory external backend)
- reduced DB logging verbosity in storage layer
- **Logs**: configurable retention and max read sizes; optional **redaction patterns** applied during ingestion (best-effort; not a guarantee against all secret formats)
- **AI**: integration defaults to off until configured; API key stored via the same secret mechanisms as other credentials (not returned to the UI after save); conversations and usage events stay in the local SQLite database unless the user deletes them via Settings
- **Privacy / data management**: Settings surfaces database location, approximate storage and row counts, and user-driven deletion of AI conversations (and related local data as implemented in the UI)

## Known Gaps (Current State)

- host key verification is not consistently strict by default
- SFTP path currently uses insecure host key callback in MVP behavior
- no formal reproducible-build verification pipeline documented yet
- security policy exists, but process maturity is still evolving
- **Logs**: redaction is pattern-based; novel secret formats may still be stored in cleartext in `LogEntry` rows until patterns are improved
- **AI**: no built-in enterprise DLP; users must trust the chosen LLM endpoint and model; prompt/context content should be reviewed against organizational policy
- **AI + tools**: agent actions (e.g. shell/docker) depend on user approval flows; threat modeling should include abuse of approved commands and confused-deputy scenarios as features evolve

## Assumptions

- user device is not already fully compromised
- OS keychain primitives are trustworthy for local secret storage
- users understand and intentionally choose insecure options when enabled
- users who enable AI understand that prompts and responses are processed by a third-party service they configure
- users who enable log ingestion understand that log content reflects whatever applications write to those files

## Non-Goals (for now)

- complete defense against local malware with user-level privileges
- centralized enterprise key management out of the box
- formal compliance certifications at MVP stage

## See also

- [`PRIVACY.md`](../../PRIVACY.md) — data categories, network behavior, and in-app privacy controls
- [`SECURITY.md`](../../SECURITY.md) — coordinated vulnerability disclosure
