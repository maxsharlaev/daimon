import { useEffect, useState } from "react";
import type { DockerStatusDTO, DockerSystemDTO } from "../../types/docker";
import { DockerLocalSystemInfo, DockerRemoteSystemInfo } from "../../../wailsjs/go/main/App";
import "./docker.css";

type Scope = "local" | "remote";

type RemoteSessionState = {
  profileId: string;
  sessionId: string | null;
  status?: DockerStatusDTO | null;
  lastError?: string | null;
};

type Props = {
  scope: Scope;
  localStatus: DockerStatusDTO | null;
  remoteSession: RemoteSessionState | null;
};

export function DockerSystemView({ scope, localStatus, remoteSession }: Props) {
  const [info, setInfo] = useState<DockerSystemDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      if (scope === "local") {
        setInfo(await DockerLocalSystemInfo());
      } else {
        const sessionId = remoteSession?.sessionId;
        if (!sessionId) {
          setInfo(null);
        } else {
          setInfo(await DockerRemoteSystemInfo(sessionId));
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setInfo(null);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, remoteSession?.sessionId]);

  const showUnavailable =
    scope === "local" ? localStatus && !localStatus.available : remoteSession?.status && !remoteSession.status.available;

  return (
    <div className="panel">
      <div className="panel-titlebar">
        <div className="panel-title">System</div>
        <div className="panel-meta">{scope === "local" ? "Local" : "Remote"}</div>
      </div>
      <div className="panel-body">
        <div className="docker-actions" style={{ marginBottom: 10 }}>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {showUnavailable ? (
          <div className="empty">{scope === "local" ? localStatus?.message ?? "Docker unavailable" : remoteSession?.status?.message ?? "Docker unavailable"}</div>
        ) : null}
        {error ? <div className="error">{error}</div> : null}
        {info ? (
          <div>
            <div className="muted">
              Docker {info.status.version ?? ""} {info.status.os ?? ""} {info.status.arch ?? ""}
            </div>
            {info.diskUsageText ? (
              <pre className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {info.diskUsageText}
              </pre>
            ) : null}
            {info.infoText ? (
              <pre className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {info.infoText}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
