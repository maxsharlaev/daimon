import { useEffect, useState } from "react";
import type { DockerImageDTO, DockerStatusDTO } from "../../types/docker";
import {
  DockerLocalListImages,
  DockerLocalImageRemove,
  DockerLocalImagePull,
  DockerRemoteListImages,
  DockerRemoteImageRemove,
  DockerRemoteImagePull,
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
};

export function DockerImagesView({ scope, localStatus, remoteSession }: Props) {
  const [images, setImages] = useState<DockerImageDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        setImages(await DockerLocalListImages());
      } else {
        const sessionId = remoteSession?.sessionId;
        if (!sessionId) {
          setImages([]);
        } else {
          setImages(await DockerRemoteListImages(sessionId));
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setImages([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, remoteSession?.sessionId]);

  const pull = async () => {
    const name = prompt("Image name (e.g. nginx:latest):", "");
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        await DockerLocalImagePull(name);
      } else {
        const sessionId = remoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteImagePull(sessionId, name);
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove image?")) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        await DockerLocalImageRemove(id, true);
      } else {
        const sessionId = remoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteImageRemove(sessionId, id, true);
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
        <div className="panel-title">Images</div>
        <div className="panel-meta">{images.length} total</div>
      </div>
      <div className="panel-body">
        <div className="docker-actions" style={{ marginBottom: 10 }}>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
          <button className="btn" type="button" onClick={() => void pull()} disabled={busy}>
            Pull
          </button>
        </div>
        {showUnavailable ? (
          <div className="empty">{scope === "local" ? localStatus?.message ?? "Docker unavailable" : remoteSession?.status?.message ?? "Docker unavailable"}</div>
        ) : null}
        {error ? <div className="error">{error}</div> : null}
        {images.length === 0 && !showUnavailable ? (
          <div className="empty">No images found.</div>
        ) : (
          <table className="docker-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Tag</th>
                <th>Created</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {images.map((img) => (
                <tr key={img.id}>
                  <td>{img.repository}</td>
                  <td>{img.tag}</td>
                  <td>{img.createdSince ?? img.createdAt ?? "-"}</td>
                  <td>{img.size ?? "-"}</td>
                  <td>
                    <button className="btn btn-danger" type="button" onClick={() => void remove(img.id)} disabled={busy}>
                      Remove
                    </button>
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
