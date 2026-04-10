# Privacy and Data Handling

## Short Version

- The app is designed as a local desktop tool.
- Sensitive connection data is stored locally.
- No built-in analytics/telemetry pipeline is enabled by default in current code.

## Data Categories

The app may process:

- connection metadata (host, port, username, profile/group names)
- secrets (passwords, private keys, passphrases) depending on storage mode
- terminal output and command results shown in the UI
- SFTP paths and file metadata used by the file manager
- dashboard snapshots collected from remote Linux hosts

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
- secret references (`storage` mode + reference metadata)
- encrypted vault blobs (when `internal` storage mode is used)

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

## Current Limitations

- Host key verification is not yet fully hardened across all SSH/SFTP paths.
- This is an active project; security posture improves over time.

See `docs/security/THREAT_MODEL.md` and `docs/security/HARDENING_ROADMAP.md`.
