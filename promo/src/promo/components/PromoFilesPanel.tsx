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
  const [transfer, setTransfer] = useState<{ direction: string; pct: number; state: string } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [localPath, setLocalPath] = useState(DEFAULT_LOCAL);
  const [activePane, setActivePane] = useState<"local" | "remote">("remote");
  const [selLocal, setSelLocal] = useState<string | null>(null);
  const [selRemote, setSelRemote] = useState<string | null>(null);

  const safeRemotePath = remotePath || DEFAULT_REMOTE;
  const localEntries = useMemo(() => listLocal(localPath) ?? [], [localPath]);
  const remoteEntries = useMemo(() => listRemote(safeRemotePath) ?? [], [safeRemotePath]);

  const localCrumbs = useMemo(() => breadcrumbsLocal(localPath), [localPath]);
  const remoteCrumbs = useMemo(() => breadcrumbsRemote(safeRemotePath), [safeRemotePath]);

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
    const up = parentRemotePath(safeRemotePath);
    if (safeRemotePath && up && up !== safeRemotePath) {
      out.push({ name: "..", path: up, isDir: true, size: 0 });
    }
    return out.concat(remoteEntries);
  }, [remoteEntries, safeRemotePath]);

  const goLocal = (p: string) => {
    setLocalPath(p);
    setSelLocal(null);
  };

  const goRemote = (p: string) => {
    onRemotePathChange(p);
    setSelRemote(null);
  };

  const startTransfer = (direction: string) => {
    setConflictOpen(false);
    setTransfer({ direction, pct: 35, state: "running" });
    window.setTimeout(() => setTransfer({ direction, pct: 100, state: "done" }), 700);
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
        <button className="btn" type="button" onClick={() => startTransfer("upload")}>
          Upload →
        </button>
        <button className="btn" type="button" onClick={() => (transfer ? setConflictOpen(true) : startTransfer("download"))}>
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
            <div className="crumbs" title={safeRemotePath}>
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
      {transfer ? (
        <div className="transferpanel">
          <div className={`transferrow ${transfer.state}`}>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${transfer.pct}%` }} />
              <div className="progress-text">{transfer.pct}%</div>
            </div>
            <div className="transfermeta mono">{transfer.direction} • 1.2 MB/3.4 MB • 420 KB/s • {transfer.state}</div>
            <button className="btn btn-ghost transfer-cancel" type="button" disabled={transfer.state !== "running"} onClick={() => setTransfer(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {conflictOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">File already exists</div>
            <div className="modal-body">
              <div className="conflict-grid">
                <div><div className="conflict-h">Local existing</div><div className="mono">readme.md • 12 KB</div></div>
                <div><div className="conflict-h">Incoming</div><div className="mono">readme.md • 14 KB</div></div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setConflictOpen(false)}>Cancel</button>
              <button className="btn" type="button" onClick={() => { setConflictOpen(false); startTransfer("download"); }}>Overwrite</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
