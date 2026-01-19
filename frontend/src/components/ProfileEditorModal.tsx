import { useEffect, useMemo, useState } from "react";
import {
  GetSecretRef,
  PickPrivateKeyFile,
  SetSecret,
  SSHTestConnection,
  UpsertProfile,
  VaultSetup,
  VaultStatus,
  VaultUnlock,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import type { ProfileDTO, ProfileGroupDTO } from "../types/models";
import "./profile_editor.scss";

type SecretStorage = "none" | "keyring" | "internal" | "external";
type AuthKind = "password" | "private_key";

type Props = {
  open: boolean;
  groups: ProfileGroupDTO[];
  profile?: ProfileDTO;
  defaultGroupId?: string;
  onClose: () => void;
  onSaved: () => void;
};

export function ProfileEditorModal({
  open,
  groups,
  profile,
  defaultGroupId,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!profile?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupId, setGroupId] = useState(profile?.groupId ?? defaultGroupId ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [host, setHost] = useState(profile?.host ?? "");
  const [port, setPort] = useState<number>(profile?.port ?? 22);
  const [username, setUsername] = useState(profile?.username ?? "");

  const [authKind, setAuthKind] = useState<AuthKind>("password");

  // password secret
  const [passwordStorage, setPasswordStorage] = useState<Exclude<SecretStorage, "external">>("none");
  const [password, setPassword] = useState("");
  const [initialPasswordStorage, setInitialPasswordStorage] = useState<Exclude<SecretStorage, "external">>("none");

  // key secret
  const [keyStorage, setKeyStorage] = useState<SecretStorage>("external");
  const [keyPath, setKeyPath] = useState("");
  const [keyPEM, setKeyPEM] = useState("");
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [initialKeyStorage, setInitialKeyStorage] = useState<SecretStorage>("none");
  const [initialKeyPath, setInitialKeyPath] = useState("");

  const [insecureIgnoreHostKey, setInsecureIgnoreHostKey] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(10000);

  const [vaultSetupPw, setVaultSetupPw] = useState("");
  const [vaultUnlockPw, setVaultUnlockPw] = useState("");
  const [vault, setVault] = useState<{ setup: boolean; unlocked: boolean }>({ setup: false, unlocked: false });

  const [testState, setTestState] = useState<{
    status: "idle" | "running" | "success" | "error";
    message?: string;
  }>({ status: "idle" });

  async function safeGetSecretRef(profileId: string, kind: string) {
    try {
      return await GetSecretRef(profileId, kind);
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setGroupId(profile?.groupId ?? defaultGroupId ?? "");
    setName(profile?.name ?? "");
    setHost(profile?.host ?? "");
    setPort(profile?.port ?? 22);
    setUsername(profile?.username ?? "");
    // Defaults (may be overridden by loaded secret refs below)
    setAuthKind("password");
    setPasswordStorage("none");
    setInitialPasswordStorage("none");
    setPassword("");
    setKeyStorage("none");
    setInitialKeyStorage("none");
    setKeyPath("");
    setInitialKeyPath("");
    setKeyPEM("");
    setKeyPassphrase("");
    setInsecureIgnoreHostKey(true);
    setTimeoutMs(10000);
    setVaultSetupPw("");
    setVaultUnlockPw("");
    setTestState({ status: "idle" });
    void (async () => {
      try {
        const st = await VaultStatus();
        setVault({ setup: st.setup, unlocked: st.unlocked });
      } catch {
        // ignore
      }
    })();

    // Load secret refs for existing profile, so auth doesn't "reset" visually.
    void (async () => {
      if (!profile?.id) return;
      try {
        const [pwRef, keyRef] = await Promise.all([
          safeGetSecretRef(profile.id, "password"),
          safeGetSecretRef(profile.id, "private_key"),
        ]);

        if (pwRef) {
          const st = (pwRef.storage as Exclude<SecretStorage, "external">) ?? "none";
          setPasswordStorage(st);
          setInitialPasswordStorage(st);
        }

        if (keyRef) {
          const st = (keyRef.storage as SecretStorage) ?? "none";
          setKeyStorage(st);
          setInitialKeyStorage(st);
          if (st === "external") {
            setKeyPath(keyRef.ref ?? "");
            setInitialKeyPath(keyRef.ref ?? "");
          }
        }

        // Infer primary auth from stored refs (prefer key if configured)
        const keyConfigured = keyRef && keyRef.storage && keyRef.storage !== "none";
        const pwConfigured = pwRef && pwRef.storage && pwRef.storage !== "none";
        if (keyConfigured) setAuthKind("private_key");
        else if (pwConfigured) setAuthKind("password");
      } catch {
        // ignore
      }
    })();
  }, [open, profile, defaultGroupId]);

  // Reset test indicator when inputs change
  useEffect(() => {
    if (!open) return;
    setTestState({ status: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host, port, username, authKind, password, keyStorage, keyPath, keyPEM, keyPassphrase, insecureIgnoreHostKey, timeoutMs]);

  useEffect(() => {
    if (!open) return;
    if (groupId) return;
    if (defaultGroupId) return;
    if (groups.length > 0) setGroupId(groups[0].id);
  }, [open, groupId, groups, defaultGroupId]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!groupId) return false;
    if (!name.trim()) return false;
    if (!host.trim()) return false;
    if (!username.trim()) return false;
    if (!port || port <= 0) return false;
    // if user selected internal storage, vault must be unlocked to store secrets now
    if ((passwordStorage === "internal" || keyStorage === "internal") && !vault.unlocked) return false;
    // primary auth validation
    if (authKind === "password") {
      // For existing profiles: allow save without retyping password if storage unchanged.
      const storageChanged = passwordStorage !== initialPasswordStorage;
      if (passwordStorage !== "none" && !password && (!isEdit || storageChanged)) return false;
    } else {
      const storageChanged = keyStorage !== initialKeyStorage;
      const pathChanged = keyStorage === "external" && keyPath !== initialKeyPath;
      if (keyStorage === "external" && !keyPath.trim()) return false;
      // For existing profiles: allow save without re-pasting PEM if storage unchanged.
      if ((keyStorage === "internal" || keyStorage === "keyring") && !keyPEM.trim() && (!isEdit || storageChanged)) return false;
      // If switching external path, require new path (handled above by trim)
      void pathChanged;
    }
    return true;
  }, [busy, groupId, name, host, username, port, passwordStorage, keyStorage, vault.unlocked, authKind, password, keyPath, keyPEM, isEdit, initialPasswordStorage, initialKeyStorage, initialKeyPath]);

  const canTest = useMemo(() => {
    if (busy) return false;
    if (!host.trim()) return false;
    if (!username.trim()) return false;
    if (!port || port <= 0) return false;
    if (authKind === "password") {
      return password.length > 0;
    }
    // private key
    if (keyStorage === "external") return keyPath.trim().length > 0;
    if (keyStorage === "none") return false;
    return keyPEM.trim().length > 0;
  }, [busy, host, username, port, authKind, password, keyStorage, keyPath, keyPEM]);

  const testDisabledReason = useMemo(() => {
    if (busy) return "Busy";
    if (!host.trim()) return "Host is required";
    if (!username.trim()) return "User is required";
    if (!port || port <= 0) return "Port is required";
    if (authKind === "password") {
      if (!password) return "Password is required to test";
      return null;
    }
    // private key
    if (keyStorage === "external") return keyPath.trim() ? null : "Key file path is required to test";
    if (keyStorage === "none") return "Key is not configured";
    return keyPEM.trim() ? null : "Private key PEM is required to test";
  }, [busy, host, username, port, authKind, password, keyStorage, keyPath, keyPEM]);

  const pickKeyFile = async () => {
    setError(null);
    const path = await PickPrivateKeyFile();
    if (path) setKeyPath(path);
  };

  const testConnection = async () => {
    setBusy(true);
    setError(null);
    setTestState({ status: "running" });
    try {
      const cfg: any = {
        host,
        port: Number(port) || 22,
        username,
        insecureIgnoreHostKey,
        timeoutMs,
      };

      if (authKind === "password") {
        cfg.authType = "password";
        cfg.password = password;
      } else {
        cfg.authType = "privateKey";
        if (keyStorage === "external") {
          cfg.privateKeyPath = keyPath;
        } else {
          cfg.privateKeyPem = keyPEM;
          cfg.passphrase = keyPassphrase;
        }
      }

      const r = await SSHTestConnection(main.SSHConfig.createFrom(cfg));
      setTestState({ status: "success", message: r });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg);
      setTestState({ status: "error", message: msg });
    } finally {
      setBusy(false);
    }
  };

  const setupVault = async () => {
    setBusy(true);
    setError(null);
    try {
      await VaultSetup(vaultSetupPw);
      const st = await VaultStatus();
      setVault({ setup: st.setup, unlocked: st.unlocked });
      setVaultSetupPw("");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlockVault = async () => {
    setBusy(true);
    setError(null);
    try {
      await VaultUnlock(vaultUnlockPw);
      const st = await VaultStatus();
      setVault({ setup: st.setup, unlocked: st.unlocked });
      setVaultUnlockPw("");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const req = main.UpsertProfileRequest.createFrom({
        id: profile?.id ?? "",
        groupId,
        name,
        host,
        port: Number(port) || 22,
        username,
        sshOptionsJson: profile?.sshOptionsJson ?? "{}",
      });
      const saved = await UpsertProfile(req);

      // Save secrets based on selected *primary* auth.
      // We still persist the ref/secret of the chosen auth; the other kind is set to none
      // to match the UI and avoid surprising "SSHConnectProfile" preferring an old key.
      if (authKind === "password") {
        // If editing and storage unchanged and password not re-entered, keep existing secret.
        if (!isEdit || passwordStorage !== initialPasswordStorage || password !== "") {
          await SetSecret(
            main.SetSecretRequest.createFrom({
              profileId: saved.id,
              kind: "password",
              storage: passwordStorage,
              password: passwordStorage === "none" ? "" : password,
              metaJson: "{}",
            })
          );
        }
        await SetSecret(
          main.SetSecretRequest.createFrom({
            profileId: saved.id,
            kind: "private_key",
            storage: "none",
            metaJson: "{}",
          })
        );
      } else {
        await SetSecret(
          main.SetSecretRequest.createFrom({
            profileId: saved.id,
            kind: "password",
            storage: "none",
            metaJson: "{}",
          })
        );
        if (keyStorage === "external") {
          // If editing and path unchanged, keep existing ref.
          if (!isEdit || keyStorage !== initialKeyStorage || keyPath !== initialKeyPath) {
            await SetSecret(
              main.SetSecretRequest.createFrom({
                profileId: saved.id,
                kind: "private_key",
                storage: "external",
                ref: keyPath,
                metaJson: "{}",
              })
            );
          }
        } else if (keyStorage === "none") {
          await SetSecret(
            main.SetSecretRequest.createFrom({
              profileId: saved.id,
              kind: "private_key",
              storage: "none",
              metaJson: "{}",
            })
          );
        } else {
          // If editing and storage unchanged and PEM not re-pasted, keep existing secret.
          if (!isEdit || keyStorage !== initialKeyStorage || keyPEM !== "") {
            await SetSecret(
              main.SetSecretRequest.createFrom({
                profileId: saved.id,
                kind: "private_key",
                storage: keyStorage,
                privateKeyPem: keyPEM,
                passphrase: keyPassphrase,
                metaJson: "{}",
              })
            );
          }
        }
      }

      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-wide">
        <div className="modal-title">{isEdit ? "Edit profile" : "New profile"}</div>
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="modal-body modal-grid">
          <div className="section form">
            <div className="section-title">Connection</div>
            <div className="row">
              <label>Group</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={busy}>
                <option value="" disabled>
                  Select group…
                </option>
                {groups
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="row">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>

            <div className="row">
              <label>Host</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} disabled={busy} placeholder="example.com" />
            </div>

            <div className="row two">
              <div className="row">
                <label>Port</label>
                <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} disabled={busy} />
              </div>
              <div className="row">
                <label>User</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
              </div>
            </div>

            <div className="row">
              <label>Host key verification</label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={insecureIgnoreHostKey}
                  onChange={(e) => setInsecureIgnoreHostKey(e.target.checked)}
                  disabled={busy}
                />
                Insecure: ignore host key (MVP)
              </label>
            </div>

            <div className="row">
              <label>Timeout (ms)</label>
              <input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} disabled={busy} min={1000} step={500} />
            </div>
          </div>

          <div className="section form">
            <div className="section-title">Auth + Secrets</div>

            <div className="row">
              <label>Primary auth</label>
              <div className="segmented">
                <button className={`seg ${authKind === "password" ? "active" : ""}`} type="button" onClick={() => setAuthKind("password")} disabled={busy}>
                  Password
                </button>
                <button className={`seg ${authKind === "private_key" ? "active" : ""}`} type="button" onClick={() => setAuthKind("private_key")} disabled={busy}>
                  Private key
                </button>
              </div>
            </div>

            {authKind === "password" ? (
              <div className="subsection">
                <div className="subsection-title">Password storage</div>
                <div className="row two">
                  <div className="row">
                    <label>Storage</label>
                    <select value={passwordStorage} onChange={(e) => setPasswordStorage(e.target.value as any)} disabled={busy}>
                      <option value="none">none (ask each time)</option>
                      <option value="keyring">keyring (OS)</option>
                      <option value="internal">internal vault</option>
                    </select>
                  </div>
                  <div className="row">
                    <label>Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy || passwordStorage === "none"}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="subsection">
                <div className="subsection-title">Private key storage</div>
                <div className="row">
                  <label>Storage</label>
                  <select value={keyStorage} onChange={(e) => setKeyStorage(e.target.value as any)} disabled={busy}>
                    <option value="none">none (ask each time)</option>
                    <option value="external">external file path</option>
                    <option value="keyring">keyring (OS) (stores PEM)</option>
                    <option value="internal">internal vault (stores PEM)</option>
                  </select>
                </div>

                {keyStorage === "external" ? (
                  <>
                    <div className="row">
                      <label>Key file path</label>
                      <div className="inline">
                        <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} disabled={busy} />
                        <button className="btn" type="button" onClick={pickKeyFile} disabled={busy}>
                          Browse…
                        </button>
                      </div>
                    </div>
                  </>
                ) : keyStorage === "none" ? null : (
                  <>
                    <div className="row">
                      <label>Private key PEM</label>
                      <textarea
                        className="textarea"
                        value={keyPEM}
                        onChange={(e) => setKeyPEM(e.target.value)}
                        disabled={busy}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      />
                    </div>
                    <div className="row">
                      <label>Passphrase (optional)</label>
                      <input type="password" value={keyPassphrase} onChange={(e) => setKeyPassphrase(e.target.value)} disabled={busy} />
                    </div>
                  </>
                )}
              </div>
            )}

            {((authKind === "password" && passwordStorage === "internal") || (authKind === "private_key" && keyStorage === "internal")) ? (
              <div className="subsection">
                <div className="subsection-title">Vault</div>
                <div className="vault-status">
                  Status: {vault.setup ? "setup" : "not set"} / {vault.unlocked ? "unlocked" : "locked"}
                </div>
                {!vault.setup ? (
                  <div className="row two">
                    <div>
                      <label>Master password (setup)</label>
                      <input type="password" value={vaultSetupPw} onChange={(e) => setVaultSetupPw(e.target.value)} disabled={busy} />
                    </div>
                    <div className="vault-actions">
                      <button className="btn" type="button" onClick={setupVault} disabled={busy || !vaultSetupPw}>
                        Setup vault
                      </button>
                    </div>
                  </div>
                ) : !vault.unlocked ? (
                  <div className="row two">
                    <div>
                      <label>Master password (unlock)</label>
                      <input type="password" value={vaultUnlockPw} onChange={(e) => setVaultUnlockPw(e.target.value)} disabled={busy} />
                    </div>
                    <div className="vault-actions">
                      <button className="btn" type="button" onClick={unlockVault} disabled={busy || !vaultUnlockPw}>
                        Unlock vault
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="modal-actions">
          <div className="modal-actions-left">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={testConnection}
              disabled={!canTest}
              title={testDisabledReason ?? "Test SSH connection"}
            >
              Test
            </button>
            <div className="test-status">
              {!canTest && testDisabledReason ? (
                <span className="test-hint">{testDisabledReason}</span>
              ) : testState.status !== "idle" ? (
                <>
                  <span
                    className={`test-indicator test-${testState.status}`}
                    title={testState.message ?? ""}
                    aria-label={`test-${testState.status}`}
                  >
                    {testState.status === "running" ? (
                      "..."
                    ) : testState.status === "success" ? (
                      "✓"
                    ) : (
                      "✕"
                    )}
                  </span>
                  <span className={`test-text test-text-${testState.status}`}>
                    {testState.status === "running"
                      ? "Testing…"
                      : testState.status === "success"
                        ? "Connection successful"
                        : "Connection failed"}
                  </span>
                </>
              ) : (
                <span className="test-hint">Ready to test</span>
              )}
            </div>
          </div>
          <div className="modal-actions-right">
            <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn" type="button" onClick={save} disabled={!canSave}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

