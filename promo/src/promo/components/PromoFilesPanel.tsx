import { useMemo, useState } from "react";
import {
  breadcrumbsLocal,
  breadcrumbsRemote,
  DEFAULT_LOCAL,
  DEFAULT_REMOTE,
  listLocal,
  listRemote,
  parentLocalPath,
  parentRemotePath,
} from "../demo/files";

type Props = {
  sessionId: string;
  remotePath: string;
  onRemotePathChange: (next: string) => void;
};

export function PromoFilesPanel({ sessionId, remotePath, onRemotePathChange }: Props) {
  const [localPath, setLocalPath] = useState(DEFAULT_LOCAL);
  const [activePane, setActivePane] = useState<"local" | "remote">("remote");
  const [selLocal, setSelLocal] = useState<string | null>(null);
  const [selRemote, setSelRemote] = useState<string | null>(null);

  const localEntries = useMemo(() => listLocal(localPath), [localPath]);
  const remoteEntries = useMemo(() => listRemote(remotePath || DEFAULT_REMOTE), [remotePath]);

  const localCrumbs = useMemo(() => breadcrumbsLocal(localPath), [localPath]);
  const remoteCrumbs = useMemo(() => breadcrumbsRemote(remotePath || DEFAULT_REMOTE), [remotePath]);

  const localDisplay = useMemo(() => {
    const out = [];
    const up = parentLocalPath(localPath);
    if (localPath && up && up !== localPath) {
      out.push({ name: "..", path: up, isDir: true, size: 0 });
    }
    return out.concat(localEntries);
  }, [localEntries, localPath]);

  const remoteDisplay = useMemo(() => {
    const out = [];
    const up = parentRemotePath(remotePath || DEFAULT_REMOTE);
    if (remotePath && up && up !== remotePath) {
      out.push({ name: "..", path: up, isDir: true, size: 0 });
    }
    return out.concat(remoteEntries);
  }, [remoteEntries, remotePath]);

  const goLocal = (p: string) => {
    setLocalPath(p);
    setSelLocal(null);
  };

  const goRemote = (p: string) => {
    onRemotePathChange(p);
    setSelRemote(null);
  };

  return (
    <div className="files panel">
      <div className="panel-titlebar">
        <div className="panel-title">Files</div>
        <div className="panel-meta">
          <span className="muted">SFTP session: {sessionId.slice(0, 8)}</span>
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" disabled>
            Demo mode
          </button>
        </div>
      </div>

      <div className="files-toolbar">
        <button className={`btn btn-ghost ${activePane === "local" ? "active" : ""}`} type="button" onClick={() => setActivePane("local")}>
          Local
        </button>
        <button className={`btn btn-ghost ${activePane === "remote" ? "active" : ""}`} type="button" onClick={() => setActivePane("remote")}>
          Remote
        </button>
        <div className="spacer" />
        <button className="btn btn-ghost" type="button" disabled>
          Mkdir
        </button>
        <button className="btn btn-ghost" type="button" disabled>
          Rename
        </button>
        <button className="btn btn-ghost" type="button" disabled>
          Delete
        </button>
        <button className="btn" type="button" disabled>
          Upload →
        </button>
        <button className="btn" type="button" disabled>
          ← Download
        </button>
      </div>

      <div className="files-split">
        <div className={`pane ${activePane === "local" ? "active" : ""}`}>
          <div className="pathbar">
            <button className="pathlabel-btn" type="button">
              Local:
            </button>
            <div className="crumbs" title={localPath}>
              {localCrumbs.map((c, idx) => (
                <span key={c.path} className="crumbwrap">
                  <button className="crumb" type="button" onClick={() => goLocal(c.path)}>
                    {c.label}
                  </button>
                  {idx < localCrumbs.length - 1 ? <span className="crumbsep">/</span> : null}
                </span>
              ))}
            </div>
          </div>
          <div className="list">
            {localDisplay.map((e) => (
              <div
                key={e.path}
                className={`row ${selLocal === e.path ? "selected" : ""}`}
                onClick={() => {
                  setActivePane("local");
                  setSelLocal(e.path);
                }}
                onDoubleClick={() => {
                  if (e.isDir) goLocal(e.path);
                }}
              >
                <span className={`name ${e.isDir ? "dir" : ""}`}>{e.name}</span>
                <span className="meta">{e.isDir ? "" : fmtSize(e.size)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`pane ${activePane === "remote" ? "active" : ""}`}>
          <div className="pathbar">
            <button className="pathlabel-btn" type="button">
              Remote:
            </button>
            <div className="crumbs" title={remotePath || DEFAULT_REMOTE}>
              {remoteCrumbs.map((c, idx) => (
                <span key={c.path} className="crumbwrap">
                  <button className="crumb" type="button" onClick={() => goRemote(c.path)}>
                    {c.label}
                  </button>
                  {idx < remoteCrumbs.length - 1 ? (
                    <span className="crumbsep">{idx === 0 && c.path === "/" ? "" : "/"}</span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
          <div className="list">
            {remoteDisplay.map((e) => (
              <div
                key={e.path}
                className={`row ${selRemote === e.path ? "selected" : ""}`}
                onClick={() => {
                  setActivePane("remote");
                  setSelRemote(e.path);
                }}
                onDoubleClick={() => {
                  if (e.isDir) goRemote(e.path);
                }}
              >
                <span className={`name ${e.isDir ? "dir" : ""}`}>{e.name}</span>
                <span className="meta">{e.isDir ? "" : fmtSize(e.size)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
