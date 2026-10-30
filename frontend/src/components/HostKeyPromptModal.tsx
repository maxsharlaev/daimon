import { useEffect, useState } from "react";
import { registerHostKeyHandler, type HostKeyPrompt } from "../ssh/hostKey";
import "./hostkeymodal.css";

type Decision = "trust" | "cancel";

export function HostKeyPromptModal() {
  const [prompt, setPrompt] = useState<HostKeyPrompt | null>(null);
  const [resolveDecision, setResolveDecision] = useState<((decision: Decision) => void) | null>(null);

  useEffect(() => {
    registerHostKeyHandler((next) => {
      return new Promise((resolve) => {
        setPrompt(next);
        setResolveDecision(() => resolve);
      });
    });
    return () => registerHostKeyHandler(null);
  }, []);

  if (!prompt || !resolveDecision) {
    return null;
  }

  const finish = (decision: Decision) => {
    const resolve = resolveDecision;
    setPrompt(null);
    setResolveDecision(null);
    resolve(decision);
  };

  const endpoint = `${prompt.host}:${prompt.port}`;

  return (
    <div className="hostkey-overlay" role="dialog" aria-modal="true" aria-labelledby="hostkey-modal-title">
      <div className="hostkey-modal">
        <div className="hostkey-title" id="hostkey-modal-title">
          {prompt.kind === "unknown" ? "Unknown host key" : "Host key changed"}
        </div>
        <div className="hostkey-body">
          {prompt.kind === "unknown" ? (
            <>
              <p>
                <strong>{endpoint}</strong> is not in the app known hosts file.
              </p>
              <p>Trust this key only if you expected this server.</p>
              <dl className="hostkey-facts">
                <dt>Key type</dt>
                <dd>{prompt.keyType || "unknown"}</dd>
                <dt>SHA256</dt>
                <dd className="hostkey-fp">{prompt.fingerprint}</dd>
              </dl>
            </>
          ) : (
            <>
              <p>
                <strong>{endpoint}</strong> presented a different host key than the one stored for this host.
              </p>
              <p>Daimon will not connect. If you rebuilt this server, open the profile and choose Forget host key, then connect again.</p>
              <dl className="hostkey-facts">
                <dt>Stored {prompt.oldKeyType || "key"}</dt>
                <dd className="hostkey-fp">{prompt.oldFingerprint}</dd>
                <dt>Offered {prompt.keyType || "key"}</dt>
                <dd className="hostkey-fp">{prompt.fingerprint}</dd>
              </dl>
            </>
          )}
        </div>
        <div className="hostkey-actions">
          {prompt.kind === "unknown" ? (
            <>
              <button className="btn" type="button" onClick={() => finish("cancel")}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => finish("trust")}>
                Trust and connect
              </button>
            </>
          ) : (
            <button className="btn" type="button" onClick={() => finish("cancel")}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
