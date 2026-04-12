import { useEffect, useState } from "react";
import {
  SSHConnectProfileWithPassword,
  SSHDashboardConnectProfileWithPassword,
  VaultSetup,
  VaultStatus,
  VaultUnlock,
} from "../../wailsjs/go/main/App";
import type { ProfileDTO } from "../types/models";
import "./sshpasswordmodal.css";

export type SshPasswordModalPurpose = "terminal" | "dashboard";

export type SshPasswordModalContext = {
  profile: ProfileDTO;
  purpose: SshPasswordModalPurpose;
};

type Props = {
  context: SshPasswordModalContext | null;
  onClose: () => void;
  /** Called after a successful SSH connect with the new session id. */
  onConnected: (sessionId: string, purpose: SshPasswordModalPurpose, profileId: string) => void;
};

type SavePasswordAs = "none" | "keyring" | "internal";

export function SshPasswordModal({ context, onClose, onConnected }: Props) {
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [sshPassword, setSshPassword] = useState("");
  const [saveAs, setSaveAs] = useState<SavePasswordAs>("none");
  const [vaultMasterPassword, setVaultMasterPassword] = useState("");
  const [vaultSetup, setVaultSetup] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);

  useEffect(() => {
    if (!context) {
      return;
    }
    setModalError(null);
    setSshPassword("");
    setSaveAs("none");
    setVaultMasterPassword("");
    setBusy(true);
    void VaultStatus()
      .then((st) => {
        setVaultSetup(!!st?.setup);
        setVaultUnlocked(!!st?.unlocked);
      })
      .catch(() => {
        setVaultSetup(false);
        setVaultUnlocked(false);
      })
      .finally(() => setBusy(false));
  }, [context]);

  if (!context) {
    return null;
  }

  const { profile, purpose } = context;
  const endpoint = `${profile.username}@${profile.host}${profile.port && profile.port !== 22 ? `:${profile.port}` : ""}`;

  const needVaultMasterInput = saveAs === "internal" && (!vaultSetup || !vaultUnlocked);

  const submit = async () => {
    const pw = sshPassword.trim();
    if (!pw) {
      setModalError("Enter the SSH account password for this connection.");
      return;
    }
    if (needVaultMasterInput && !vaultMasterPassword.trim()) {
      if (!vaultSetup) {
        setModalError("Choose a vault master password, or pick a different save option.");
      } else {
        setModalError("Enter your vault master password to unlock the vault.");
      }
      return;
    }

    setBusy(true);
    setModalError(null);
    try {
      if (saveAs === "internal") {
        const st = await VaultStatus();
        if (!st.setup) {
          await VaultSetup(vaultMasterPassword.trim());
        } else if (!st.unlocked) {
          await VaultUnlock(vaultMasterPassword.trim());
        }
      }

      const remember = saveAs;
      const sessionId =
        purpose === "terminal"
          ? await SSHConnectProfileWithPassword(profile.id, pw, remember)
          : await SSHDashboardConnectProfileWithPassword(profile.id, pw, remember);

      onConnected(sessionId, purpose, profile.id);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const purposeLead =
    purpose === "terminal"
      ? "To open a terminal session, this profile needs the SSH account password."
      : "To open the dashboard session, this profile needs the SSH account password.";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ssh-pw-modal-title">
      <div className="modal ssh-pw-modal">
        <div className="modal-title" id="ssh-pw-modal-title">
          SSH password
        </div>
        <div className="modal-body">
          <p className="ssh-pw-lead">
            <strong>{profile.name}</strong>
            <span className="muted"> — </span>
            <span className="mono">{endpoint}</span>
          </p>
          <p className="ssh-pw-sub">{purposeLead}</p>
          <p className="ssh-pw-sub">
            Nothing you type here is shown in the terminal. It is only used to authenticate over SSH and, if you choose,
            to store the password in this app.
          </p>

          <div className="ssh-pw-field">
            <label htmlFor="ssh-pw-account">SSH account password</label>
            <input
              id="ssh-pw-account"
              type="password"
              autoComplete="current-password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <div className="ssh-pw-field">
            <label htmlFor="ssh-pw-save">Save password for this profile</label>
            <select
              id="ssh-pw-save"
              value={saveAs}
              onChange={(e) => {
                const v = e.target.value as SavePasswordAs;
                setSaveAs(v);
                if (v !== "internal") {
                  setVaultMasterPassword("");
                }
              }}
              disabled={busy}
            >
              <option value="none">Do not save (ask again next time)</option>
              <option value="keyring">Operating system keyring</option>
              <option value="internal">App vault (encrypted with a master password)</option>
            </select>
          </div>

          {saveAs === "internal" && !vaultSetup ? (
            <div className="ssh-pw-vault-block">
              <p className="ssh-pw-vault-why">
                <strong>Why another password?</strong> The app vault stores secrets encrypted on this machine. You create one
                master password for the vault; it is not sent anywhere. You will need it again whenever the vault is locked
                (for example after restart), including to read keys or passwords stored in the vault.
              </p>
              <div className="ssh-pw-field" style={{ marginBottom: 0 }}>
                <label htmlFor="ssh-pw-vault-new">Vault master password (create)</label>
                <input
                  id="ssh-pw-vault-new"
                  type="password"
                  autoComplete="new-password"
                  value={vaultMasterPassword}
                  onChange={(e) => setVaultMasterPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          ) : null}

          {saveAs === "internal" && vaultSetup && !vaultUnlocked ? (
            <div className="ssh-pw-vault-block">
              <p className="ssh-pw-vault-why">
                <strong>Why another password?</strong> The app vault is locked. Enter the same master password you used when
                you set up the vault so this SSH password can be encrypted and saved there.
              </p>
              <div className="ssh-pw-field" style={{ marginBottom: 0 }}>
                <label htmlFor="ssh-pw-vault-unlock">Vault master password (unlock)</label>
                <input
                  id="ssh-pw-vault-unlock"
                  type="password"
                  autoComplete="current-password"
                  value={vaultMasterPassword}
                  onChange={(e) => setVaultMasterPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          ) : null}

          {modalError ? <div className="error-text">{modalError}</div> : null}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
