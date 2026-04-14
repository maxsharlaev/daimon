import { useEffect, useMemo, useState } from "react";
import type { ProfileDTO } from "../types/models";
import {
  CopySecretToClipboard,
  DeleteSecret,
  ListSecrets,
  UpsertSecret,
  VaultLock,
  VaultSetup,
  VaultStatus,
  VaultUnlock,
} from "../../wailsjs/go/main/App";
import "./secretsmodal.css";

type Props = {
  open: boolean;
  profileId: string | null;
  profiles: ProfileDTO[];
  onClose: () => void;
};

type SecretItem = {
  profileId: string;
  key: string;
  storage: string;
  metaJson?: string;
  updatedAt: number;
};

const KEY_MAX = 32;

export function SecretsModal({ open, profileId, profiles, onClose }: Props) {
  const [items, setItems] = useState<SecretItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [storage, setStorage] = useState<"keyring" | "internal" | "none">("keyring");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const [vaultStatus, setVaultStatus] = useState<{ setup: boolean; unlocked: boolean } | null>(null);
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId]);
  const needsVault = storage === "internal" || items.some((i) => i.storage === "internal");

  const refresh = async () => {
    if (!profileId) return;
    setBusy(true);
    setError(null);
    try {
      const list = (await ListSecrets(profileId)) as any[];
      const mapped: SecretItem[] = (list ?? []).map((i) => ({
        profileId: i.profileId,
        key: i.key,
        storage: i.storage,
        metaJson: i.metaJson,
        updatedAt: Number(i.updatedAt || 0),
      }));
      setItems(mapped);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshVault = async () => {
    try {
      const st = await VaultStatus();
      setVaultStatus({ setup: !!st?.setup, unlocked: !!st?.unlocked });
    } catch {
      setVaultStatus(null);
    }
  };

  useEffect(() => {
    if (!open || !profileId) return;
    setItems([]);
    setError(null);
    setCopiedKey(null);
    setKeyInput("");
    setValueInput("");
    setStorage("keyring");
    setEditingKey(null);
    setEditorOpen(false);
    void refresh();
    void refreshVault();
  }, [open, profileId]);

  if (!open || !profileId) return null;

  const keyTrimmed = keyInput.trim();
  const canSave =
    keyTrimmed.length > 0 &&
    keyTrimmed.length <= KEY_MAX &&
    (storage === "none" ? true : valueInput.trim().length > 0);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal secretsmodal">
        <div className="modal-title">Secrets {profile ? `• ${profile.name}` : ""}</div>

        <div className="modal-body form">
          {error ? <div className="notice err">{error}</div> : null}

          <div className="secrets-list">
            {items.length === 0 ? <div className="muted">No secrets yet.</div> : null}
            {items.map((s) => (
              <div key={s.key} className="secrets-row">
                <div className="secrets-main">
                  <div className="secrets-key">{s.key}</div>
                  <div className="secrets-meta">
                    <span className="secrets-storage">{s.storage}</span>
                    <span className="secrets-updated">
                      {s.updatedAt ? new Date(s.updatedAt * 1000).toLocaleString() : ""}
                    </span>
                  </div>
                </div>
                <div className="secrets-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={async () => {
                      try {
                        await CopySecretToClipboard(profileId, s.key);
                        setCopiedKey(s.key);
                        setTimeout(() => setCopiedKey((cur) => (cur === s.key ? null : cur)), 1500);
                      } catch (e: any) {
                        setError(e?.message ?? String(e));
                      }
                    }}
                    title={copiedKey === s.key ? "Copied" : "Copy"}
                  >
                    📋
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => {
                      setEditingKey(s.key);
                      setKeyInput(s.key);
                      setValueInput("");
                      const nextStorage = s.storage === "internal" ? "internal" : s.storage === "none" ? "none" : "keyring";
                      setStorage(nextStorage);
                      setEditorOpen(true);
                    }}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn-ghost danger"
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete secret "${s.key}"?`)) return;
                      try {
                        await DeleteSecret(profileId, s.key);
                        await refresh();
                      } catch (e: any) {
                        setError(e?.message ?? String(e));
                      }
                    }}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>

          {needsVault ? (
            <div className="secrets-vault">
              <div className="secrets-vault-title">
                Vault: {vaultStatus?.setup ? (vaultStatus.unlocked ? "Unlocked" : "Locked") : "Not set up"}
              </div>
              <div className="row">
                <label>Master password</label>
                <input
                  type="password"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  placeholder="Vault password"
                />
              </div>
              <div className="row actions">
                {!vaultStatus?.setup ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={vaultBusy || !vaultPassword}
                    onClick={async () => {
                      setVaultBusy(true);
                      try {
                        await VaultSetup(vaultPassword);
                        setVaultPassword("");
                        await refreshVault();
                      } finally {
                        setVaultBusy(false);
                      }
                    }}
                  >
                    Setup vault
                  </button>
                ) : !vaultStatus?.unlocked ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={vaultBusy || !vaultPassword}
                    onClick={async () => {
                      setVaultBusy(true);
                      try {
                        await VaultUnlock(vaultPassword);
                        setVaultPassword("");
                        await refreshVault();
                      } finally {
                        setVaultBusy(false);
                      }
                    }}
                  >
                    Unlock vault
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={vaultBusy}
                    onClick={async () => {
                      setVaultBusy(true);
                      try {
                        await VaultLock();
                        await refreshVault();
                      } finally {
                        setVaultBusy(false);
                      }
                    }}
                  >
                    Lock vault
                  </button>
                )}
              </div>
            </div>
          ) : null}

          <div className="muted secrets-note">Clipboard will be cleared after ~20 seconds (best-effort).</div>
        </div>

        <div className="modal-actions secrets-actions-footer">
          <button
            className="btn"
            type="button"
            onClick={() => {
              setEditingKey(null);
              setKeyInput("");
              setValueInput("");
              setStorage("keyring");
              setEditorOpen(true);
            }}
          >
            Add
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {editorOpen ? (
        <div className="secrets-editor-overlay" role="dialog" aria-modal="true" onClick={() => setEditorOpen(false)}>
          <div className="secrets-editor form" onClick={(e) => e.stopPropagation()}>
            <div className="secrets-editor-title">{editingKey ? "Edit secret" : "Add secret"}</div>
            <div className="row two">
              <div className="row">
                <label>Name</label>
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="sudo"
                  disabled={!!editingKey}
                />
                <div className="help">Max {KEY_MAX} chars.</div>
              </div>
              <div className="row">
                <label>Storage</label>
                <select value={storage} onChange={(e) => setStorage(e.target.value as any)}>
                  <option value="keyring">OS keyring</option>
                  <option value="internal">Internal vault</option>
                  <option value="none">Don’t store</option>
                </select>
              </div>
            </div>
            <div className="row">
              <label>{editingKey ? "New value (replace)" : "Value"}</label>
              <input
                type="password"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                placeholder={editingKey ? "Enter new value" : "Secret value"}
              />
            </div>
            <div className="row actions">
              <button
                className="btn"
                type="button"
                disabled={busy || !canSave}
                onClick={async () => {
                  try {
                    setBusy(true);
                    setError(null);
                    await UpsertSecret({
                      profileId,
                      key: keyInput.trim(),
                      storage,
                      value: valueInput,
                      metaJson: "{}",
                    } as any);
                    setKeyInput("");
                    setValueInput("");
                    setEditingKey(null);
                    setStorage("keyring");
                    setEditorOpen(false);
                    await refresh();
                  } catch (e: any) {
                    setError(e?.message ?? String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {editingKey ? "Update" : "Add"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setEditingKey(null);
                  setKeyInput("");
                  setValueInput("");
                  setStorage("keyring");
                  setEditorOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

