import { useEffect, useRef, useState } from "react";
import { DockerTerminal } from "./DockerTerminal";
import { DockerLocalLogsStart, DockerRemoteLogsStart, DockerStreamStop } from "../../../wailsjs/go/main/App";

type Scope = "local" | "remote";

type Props = {
  scope: Scope;
  sessionId: string | null;
  containerId: string;
  onClose: () => void;
  onSessionInvalid?: () => void;
};

export function DockerLogsPanel({ scope, sessionId, containerId, onClose, onSessionInvalid }: Props) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    setError(null);
    streamIdRef.current = null;
    let activeId: string | null = null;
    const start = async () => {
      try {
        if (scope === "local") {
          const id = await DockerLocalLogsStart(containerId, "200", "");
          activeId = id;
          streamIdRef.current = id;
          setStreamId(id);
        } else {
          if (!sessionId) {
            setError("Remote session not connected");
            return;
          }
          const id = await DockerRemoteLogsStart(sessionId, containerId, "200", "");
          activeId = id;
          streamIdRef.current = id;
          setStreamId(id);
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setError(msg);
        if (scope === "remote" && typeof msg === "string" && (msg.includes("connect failed") || msg.includes("open failed") || msg.includes("rejected"))) {
          onSessionInvalid?.();
        }
      }
    };
    void start();
    return () => {
      if (activeId) void DockerStreamStop(activeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, scope, sessionId, retryKey]);

  if (error) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Logs</div>
          <div className="panel-meta error">{error}</div>
        </div>
        <div className="panel-body" style={{ padding: "10px 12px" }}>
          <button
            className="btn"
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="docker-terminal-wrap">
      <DockerTerminal streamId={streamId} streamIdRef={streamIdRef} inputEnabled={false} convertEol />
    </div>
  );
}
