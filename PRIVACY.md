# Privacy and Data Handling

## Short Version

- The app is designed as a local desktop tool.
- Sensitive connection data is stored locally.
- No built-in analytics/telemetry pipeline is enabled by default in current code.
- **Logs** you configure are **read from remote or Docker sources and stored locally** in
  the same database; they may contain anything those applications write.
- **AI assistant** is **optional**. If you configure an LLM integration, prompts and
  replies are sent to **your chosen HTTPS API**; chat history and usage metadata stay on
  disk unless you delete them.
- **Settings** includes **privacy / data management** views (storage overview, counts,
  deletion of AI conversations, log-related controls as implemented).

## Data Categories

The app may process:

- connection metadata (host, port, username, profile/group names)
- secrets (passwords, private keys, passphrases) depending on storage mode
- terminal output and command results shown in the UI
- SFTP paths and file metadata used by the file manager
- dashboard snapshots collected from remote Linux hosts
- **Logs workspace**: log source configuration (paths, profile/container association,
  parser format), and **persisted log entries** (timestamps, levels, message text, raw
  line fragments, deduplication keys, and related metadata JSON)
- **AI assistant**: conversation titles, **message payloads** (user and assistant
  content, tool/system phases as stored), optional **long-context summaries** attached
  to a conversation, and **usage events** (model id, token counts, errors, linked
  conversation id)
- **AI settings** (non-secret): integration type, base URL, model name, token/context
  limits; the **API key** is stored only through the secret storage backends (see below),
  not as plaintext in settings JSON
- **Data tab**: saved **data source** metadata (engine, host, port, username, scope JSON)
  in SQLite; **database passwords** stored like other secrets (`keyring` / `internal`).
  **SSH mode** opens a **separate** SSH client from Connections and uses a localhost port
  forward to the remote DB endpoint. **Docker** modes run client tools against the DB
  **inside the container network** (including ephemeral sidecar images), which may pull
  images and run containers on the local or remote Docker engine you already use elsewhere
  in the app.

## Secret Storage Modes

Per profile, secrets can be configured in different storage modes:

- `none`: do not store secret values
- `keyring`: store in OS keychain/credential manager
- `internal`: encrypted local vault (master password-protected)
- `external` (private key only): keep key material in external file/reference

Internal vault uses local encryption with Argon2id-based key derivation and
ChaCha20-Poly1305 for payload encryption.

## Local Persistence

Project state is stored locally in SQLite under the user config directory
(for example: `<user-config-dir>/daimon/daimon.db`).

Database may include:

- profiles and UI state
- **Data sources** (connection profiles for the Data tab; passwords only via secret refs)
- secret references (`storage` mode + reference metadata)
- encrypted vault blobs (when `internal` storage mode is used)
- log formats, log sources, and log entry rows
- AI conversations, messages, usage events, and AI-related app settings (excluding API
  key material)
- logs-related settings (e.g. retention, redaction pattern list) stored as JSON

## Clipboard Behavior

Some operations can copy secrets to clipboard by explicit user action.
The app attempts to clear clipboard content after a short delay (best effort).
Clipboard handling ultimately depends on OS behavior and other running apps.

## Exports

Encrypted profile export can include secrets by design. If a private key is
configured as external file and readable, key material may be embedded into the
encrypted export container.

## Network Behavior

The app connects to remote systems via SSH/SFTP when requested by the user.
No always-on background data upload pipeline is intended by default.

When **AI integration** is enabled and you send a message, the app issues **HTTPS**
requests to the **configured OpenAI-compatible API** (default example: OpenAI’s API
host; you may point it elsewhere). Data sent includes your prompt, relevant
conversation history according to app settings, and **agent context** (e.g. active
session / Docker scope) needed for tools—**only while the feature is used**. The app
does not send this traffic to a vendor-operated “daimon” backend; the destination is
**your configured endpoint**.

Log ingestion uses existing SSH or Docker access paths to **read files** you
configured; data is processed locally and written into SQLite.

## Settings and Personal Data Controls

The **Settings** area includes tools to **inspect** and **manage** personal and
operational data held in the local database, for example:

- **Privacy / storage**: path to the database file, size estimates, and **row counts**
  for major tables (including profiles, secrets, AI conversations, log entries, etc.)
- **AI**: configure integration; **delete conversations** or usage-related data where
  the UI exposes it; API key is set/cleared through the secret storage flow
- **Logs**: settings such as retention and **redaction patterns** (applied as lines are
  ingested; not a complete guarantee)

Exact controls may evolve with releases; prefer the in-app labels and confirmations.

## Current Limitations

- Host key verification is not yet fully hardened across all SSH/SFTP paths.
- This is an active project; security posture improves over time.
- **Log redaction** depends on patterns you configure; unknown secret formats may still
  be stored.
- **LLM providers** are third parties; their privacy policy and data handling apply to
  traffic you send when AI is enabled.

See `docs/security/THREAT_MODEL.md` and `docs/security/HARDENING_ROADMAP.md`.
