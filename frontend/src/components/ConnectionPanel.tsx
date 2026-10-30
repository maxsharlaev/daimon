import { useMemo, useState } from "react";
import { PickPrivateKeyFile, SSHConnect, SSHDisconnect, SSHTestConnection } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import type { SSHAuthType, SSHConfig } from "../types/ssh";
import { withHostKey } from "../ssh/hostKey";
import "./connectionpanel.css";

type Props = {
  connectionId: string | null;
  onConnected: (id: string) => void;
  onDisconnected: () => void;
};

export function ConnectionPanel({ connectionId, onConnected, onDisconnected }: Props) {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const [cfg, setCfg] = useState<SSHConfig>({
    host: "127.0.0.1",
    port: 22,
    username: "root",
    authType: "password",
    password: "",
    privateKeyPath: "",
    passphrase: "",
    insecureIgnoreHostKey: false,
    timeoutMs: 10000,
  });

  const isConnected = !!connectionId;

  const canConnect = useMemo(() => {
    if (busy) return false;
    if (isConnected) return false;
    if (!cfg.host.trim()) return false;
    if (!cfg.username.trim()) return false;
    if (!cfg.port || cfg.port <= 0) return false;
    if (cfg.authType === "password") return (cfg.password ?? "").length > 0;
    return (cfg.privateKeyPath ?? "").trim().length > 0;
  }, [busy, isConnected, cfg]);

  const update = <K extends keyof SSHConfig>(key: K, value: SSHConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
  };

  const setAuthType = (t: SSHAuthType) => {
    setCfg((c) => ({ ...c, authType: t }));
  };

  const pickKey = async () => {
    setLastError(null);
    const path = await PickPrivateKeyFile();
    if (path) update("privateKeyPath", path);
  };

  const test = async () => {
    setBusy(true);
    setLastResult(null);
    setLastError(null);
    try {
      const r = await withHostKey(() => SSHTestConnection(main.SSHConfig.createFrom(cfg)));
      setLastResult(r);
    } catch (e: any) {
      setLastError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setLastResult(null);
    setLastError(null);
    try {
      const id = await withHostKey(() => SSHConnect(main.SSHConfig.createFrom(cfg)));
      onConnected(id);
    } catch (e: any) {
      setLastError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!connectionId) return;
    setBusy(true);
    setLastResult(null);
    setLastError(null);
    try {
      await SSHDisconnect(connectionId);
      onDisconnected();
    } catch (e: any) {
      setLastError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel panel-connection">
      <div className="panel-titlebar">
        <div className="panel-title">Connection</div>
        <div className="panel-meta">
          {connectionId ? <span className="mono">id: {connectionId}</span> : <span className="muted">not connected</span>}
        </div>
      </div>

      <div className="form">
        <div className="row">
          <label>Host</label>
          <input value={cfg.host} onChange={(e) => update("host", e.target.value)} disabled={busy || isConnected} />
        </div>
        <div className="row two">
          <div>
            <label>Port</label>
            <input
              value={cfg.port}
              onChange={(e) => update("port", Number(e.target.value))}
              type="number"
              min={1}
              max={65535}
              disabled={busy || isConnected}
            />
          </div>
          <div>
            <label>User</label>
            <input value={cfg.username} onChange={(e) => update("username", e.target.value)} disabled={busy || isConnected} />
          </div>
        </div>

        <div className="row">
          <label>Auth</label>
          <div className="segmented">
            <button
              className={`seg ${cfg.authType === "password" ? "active" : ""}`}
              onClick={() => setAuthType("password")}
              type="button"
              disabled={busy || isConnected}
            >
              Password
            </button>
            <button
              className={`seg ${cfg.authType === "privateKey" ? "active" : ""}`}
              onClick={() => setAuthType("privateKey")}
              type="button"
              disabled={busy || isConnected}
            >
              Key
            </button>
          </div>
        </div>

        {cfg.authType === "password" ? (
          <div className="row">
            <label>Password</label>
            <input
              value={cfg.password ?? ""}
              onChange={(e) => update("password", e.target.value)}
              type="password"
              disabled={busy || isConnected}
              autoComplete="off"
            />
          </div>
        ) : (
          <>
            <div className="row">
              <label>Private key file</label>
              <div className="inline">
                <input
                  value={cfg.privateKeyPath ?? ""}
                  onChange={(e) => update("privateKeyPath", e.target.value)}
                  disabled={busy || isConnected}
                  placeholder="C:\\Users\\...\\.ssh\\id_rsa"
                />
                <button className="btn" onClick={pickKey} type="button" disabled={busy || isConnected}>
                  Browse…
                </button>
              </div>
            </div>
            <div className="row">
              <label>Passphrase (optional)</label>
              <input
                value={cfg.passphrase ?? ""}
                onChange={(e) => update("passphrase", e.target.value)}
                type="password"
                disabled={busy || isConnected}
                autoComplete="off"
              />
            </div>
          </>
        )}

        <div className="row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={cfg.insecureIgnoreHostKey}
              onChange={(e) => update("insecureIgnoreHostKey", e.target.checked)}
              disabled={busy || isConnected}
            />
            Skip host key verification
          </label>
          <div className="help">
            Use this for a load balancer that presents a different key on each connection, or for servers that are
            recreated often. The connection will not check the server key, so a substituted server is not detected.
          </div>
        </div>

        <div className="row">
          <label>Timeout (ms)</label>
          <input
            value={cfg.timeoutMs ?? 10000}
            onChange={(e) => update("timeoutMs", Number(e.target.value))}
            type="number"
            min={1000}
            step={500}
            disabled={busy || isConnected}
          />
        </div>

        <div className="actions">
          <button className="btn" onClick={test} type="button" disabled={busy || isConnected || !cfg.host || !cfg.username}>
            Test
          </button>
          <button className="btn" onClick={connect} type="button" disabled={!canConnect}>
            Connect
          </button>
          <button className="btn btn-danger" onClick={disconnect} type="button" disabled={busy || !isConnected}>
            Disconnect
          </button>
        </div>

        {lastResult ? <div className="notice ok">Result: {lastResult}</div> : null}
        {lastError ? <div className="notice err">{lastError}</div> : null}
      </div>
    </div>
  );
}

