import { useEffect, useState } from "react";
import { DockerTerminal } from "./DockerTerminal";
import { DockerLocalExecStart, DockerRemoteExecStart, DockerStreamStop } from "../../../wailsjs/go/main/App";

type Scope = "local" | "remote";

type Props = {
  scope: Scope;
  sessionId: string | null;
  containerId: string;
  onClose: () => void;
};

export function DockerShellPanel({ scope, sessionId, containerId, onClose }: Props) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activeId: string | null = null;
    const start = async () => {
      try {
        if (scope === "local") {
          const id = await DockerLocalExecStart(containerId, 80, 24);
          activeId = id;
          setStreamId(id);
        } else {
          if (!sessionId) {
            setError("Remote session not connected");
            return;
          }
          const id = await DockerRemoteExecStart(sessionId, containerId, 80, 24);
          activeId = id;
          setStreamId(id);
        }
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    };
    void start();
    return () => {
      if (activeId) void DockerStreamStop(activeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, scope, sessionId]);

  if (error) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Shell</div>
          <div className="panel-meta error">{error}</div>
        </div>
      </div>
    );
  }

  return <DockerTerminal streamId={streamId} inputEnabled onDisconnected={() => onClose()} />;
}
