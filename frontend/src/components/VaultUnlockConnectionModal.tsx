import { useEffect, useState } from "react";
import { SSHConnectProfile, SSHDashboardConnectProfile, VaultStatus, VaultUnlock } from "../../wailsjs/go/main/App";
import type { ProfileDTO } from "../types/models";
import type { SshPasswordModalPurpose } from "./SshPasswordModal";
import "./sshpasswordmodal.css";

export type VaultUnlockConnectionContext = {
  profile: ProfileDTO;
  purpose: SshPasswordModalPurpose;
};

type Props = {
  context: VaultUnlockConnectionContext | null;
  onClose: () => void;
  onConnected: (sessionId: string, purpose: SshPasswordModalPurpose, profileId: string) => void;
};

export function VaultUnlockConnectionModal({ context, onClose, onConnected }: Props) {
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [masterPassword, setMasterPassword] = useState("");

  useEffect(() => {
    if (!context) return;
    setModalError(null);
    setMasterPassword("");
  }, [context]);

  if (!context) {
    return null;
  }

  const { profile, purpose } = context;
  const endpoint = `${profile.username}@${profile.host}${profile.port && profile.port !== 22 ? `:${profile.port}` : ""}`;

  const submit = async () => {
    const mpw = masterPassword.trim();
    if (!mpw) {
      setModalError("Enter your vault master password.");
      return;
    }
    setBusy(true);
    setModalError(null);
    try {
      const st = await VaultStatus();
      if (!st.setup) {
        setModalError("The app vault is not set up yet. Configure it in Settings or when saving a secret to the vault.");
        return;
      }
      await VaultUnlock(mpw);
      const sessionId =
        purpose === "terminal"
          ? await SSHConnectProfile(profile.id)
          : await SSHDashboardConnectProfile(profile.id);
      onConnected(sessionId, purpose, profile.id);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const purposeLine =
    purpose === "terminal"
      ? "After unlock, the terminal connection will be retried automatically."
      : "After unlock, the dashboard connection will be retried automatically.";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="vault-unlock-conn-title">
      <div className="modal ssh-pw-modal">
        <div className="modal-title" id="vault-unlock-conn-title">
          Vault locked
        </div>
        <div className="modal-body">
          <p className="ssh-pw-lead">
            <strong>{profile.name}</strong>
            <span className="muted"> — </span>
            <span className="mono">{endpoint}</span>
          </p>
          <p className="ssh-pw-sub">
            The SSH private key for this profile is stored in the <strong>app vault</strong>, which is currently locked.
            Unlock the vault with your master password so the key can be read — this is not your SSH login password.
          </p>
          <p className="ssh-pw-sub">{purposeLine}</p>

          <div className="ssh-pw-field">
            <label htmlFor="vault-unlock-conn-mpw">Vault master password</label>
            <input
              id="vault-unlock-conn-mpw"
              type="password"
              autoComplete="current-password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          {modalError ? <div className="error-text">{modalError}</div> : null}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? "Connecting…" : "Unlock and connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
