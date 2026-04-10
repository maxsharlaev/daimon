# Threat Model (MVP)

## Assets to Protect

- SSH credentials and private key material
- passphrases and user-defined secrets
- remote infrastructure metadata (hosts, paths, command output)
- exported profile containers

## Trust Boundaries

- local machine and user account
- remote hosts accessed through SSH/SFTP
- optional clipboard and OS-level integrations
- repository, release artifacts, and distribution channel

## Primary Threats

1. credential disclosure from local storage or memory
2. man-in-the-middle attacks when host key verification is weak
3. accidental leakage via exports, clipboard, screenshots, or logs
4. tampered binaries or compromised update/download channel
5. malicious or vulnerable dependencies (supply chain risk)

## Existing Controls

- optional OS keyring-backed secret storage
- optional internal encrypted vault
- encrypted profile export format
- mostly local-first architecture (no mandatory external backend)
- reduced DB logging verbosity in storage layer

## Known Gaps (Current State)

- host key verification is not consistently strict by default
- SFTP path currently uses insecure host key callback in MVP behavior
- no formal reproducible-build verification pipeline documented yet
- security policy exists, but process maturity is still evolving

## Assumptions

- user device is not already fully compromised
- OS keychain primitives are trustworthy for local secret storage
- users understand and intentionally choose insecure options when enabled

## Non-Goals (for now)

- complete defense against local malware with user-level privileges
- centralized enterprise key management out of the box
- formal compliance certifications at MVP stage
