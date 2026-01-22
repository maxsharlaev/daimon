import { useEffect, useState } from "react";
import type { DockerContainerDTO, DockerStatusDTO } from "../../types/docker";
import {
  DockerLocalListContainers,
  DockerLocalContainerStart,
  DockerLocalContainerStop,
  DockerLocalContainerRestart,
  DockerLocalContainerRemove,
  DockerRemoteListContainers,
  DockerRemoteContainerStart,
  DockerRemoteContainerStop,
  DockerRemoteContainerRestart,
  DockerRemoteContainerRemove,
} from "../../../wailsjs/go/main/App";
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
  onOpenLogs: (containerId: string, name: string) => void;
  onOpenShell: (containerId: string, name: string) => void;
  onOpenFiles: (containerId: string, name: string) => void;
};

export function DockerContainersView({ scope, localStatus, remoteSession, onOpenLogs, onOpenShell, onOpenFiles }: Props) {
  const [containers, setContainers] = useState<DockerContainerDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        const list = await DockerLocalListContainers();
        setContainers(list);
      } else {
        const sessionId = remoteSession?.sessionId;
        if (!sessionId) {
          setContainers([]);
        } else {
          const list = await DockerRemoteListContainers(sessionId);
          setContainers(list);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setContainers([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, remoteSession?.sessionId]);

  const runAction = async (id: string, action: "start" | "stop" | "restart" | "remove") => {
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        if (action === "start") await DockerLocalContainerStart(id);
        if (action === "stop") await DockerLocalContainerStop(id);
        if (action === "restart") await DockerLocalContainerRestart(id);
        if (action === "remove") await DockerLocalContainerRemove(id);
      } else {
        const sessionId = remoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        if (action === "start") await DockerRemoteContainerStart(sessionId, id);
        if (action === "stop") await DockerRemoteContainerStop(sessionId, id);
        if (action === "restart") await DockerRemoteContainerRestart(sessionId, id);
        if (action === "remove") await DockerRemoteContainerRemove(sessionId, id);
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const showUnavailable =
    scope === "local" ? localStatus && !localStatus.available : remoteSession?.status && !remoteSession.status.available;

  return (
    <div className="panel">
      <div className="panel-titlebar">
        <div className="panel-title">Containers</div>
        <div className="panel-meta">{containers.length} total</div>
      </div>
      <div className="panel-body">
        <div className="docker-actions" style={{ marginBottom: 10 }}>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
        </div>
        {showUnavailable ? (
          <div className="empty">{scope === "local" ? localStatus?.message ?? "Docker unavailable" : remoteSession?.status?.message ?? "Docker unavailable"}</div>
        ) : null}
        {error ? <div className="error">{error}</div> : null}
        {containers.length === 0 && !showUnavailable ? (
          <div className="empty">No containers found.</div>
        ) : (
          <table className="docker-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Image</th>
                <th>Status</th>
                <th>Ports</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.image}</td>
                  <td>{c.status || c.state}</td>
                  <td>{c.ports || "-"}</td>
                  <td>
                    <div className="docker-actions">
                      <button className="btn btn-ghost" type="button" onClick={() => onOpenLogs(c.id, c.name)}>
                        Logs
                      </button>
                      <button className="btn btn-ghost" type="button" onClick={() => onOpenFiles(c.id, c.name)}>
                        Files
                      </button>
                      <button className="btn btn-ghost" type="button" onClick={() => onOpenShell(c.id, c.name)}>
                        Shell
                      </button>
                      <button className="btn" type="button" onClick={() => void runAction(c.id, "start")} disabled={busy}>
                        Start
                      </button>
                      <button className="btn" type="button" onClick={() => void runAction(c.id, "stop")} disabled={busy}>
                        Stop
                      </button>
                      <button className="btn" type="button" onClick={() => void runAction(c.id, "restart")} disabled={busy}>
                        Restart
                      </button>
                      <button className="btn btn-danger" type="button" onClick={() => void runAction(c.id, "remove")} disabled={busy}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
