import { useEffect, useMemo, useState } from "react";
import type { DockerFileEntry } from "../../types/docker";
import {
  DockerLocalListDir,
  DockerRemoteListDir,
  DockerLocalFileDelete,
  DockerRemoteFileDelete,
  DockerLocalMkdir,
  DockerRemoteMkdir,
  DockerLocalRename,
  DockerRemoteRename,
  DockerLocalDownload,
  DockerRemoteDownload,
  DockerLocalUpload,
  DockerRemoteUpload,
  PickLocalFile,
  PickSaveFile,
} from "../../../wailsjs/go/main/App";
import "./docker.css";

type Scope = "local" | "remote";

type Props = {
  scope: Scope;
  sessionId: string | null;
  containerId: string;
};

function joinRemote(base: string, name: string) {
  if (!base || base === "/") return `/${name}`.replace("//", "/");
  const clean = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${clean}/${name}`;
}

function parentRemote(p: string) {
  if (!p || p === "/" || p === ".") return "/";
  const clean = p.endsWith("/") ? p.slice(0, -1) : p;
  const idx = clean.lastIndexOf("/");
  if (idx <= 0) return "/";
  return clean.slice(0, idx);
}

export function DockerFilesPanel({ scope, sessionId, containerId }: Props) {
  const [path, setPath] = useState<string>("/");
  const [entries, setEntries] = useState<DockerFileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DockerFileEntry | null>(null);

  const list = async (p = path) => {
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        setEntries(await DockerLocalListDir(containerId, p));
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        setEntries(await DockerRemoteListDir(sessionId, containerId, p));
      }
      setSelected(null);
      setPath(p);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void list(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sessionId, containerId]);

  const displayEntries = useMemo(() => {
    const out: DockerFileEntry[] = [];
    if (path !== "/") {
      out.push({ name: "..", path: parentRemote(path), isDir: true, size: 0, mtimeMs: 0 });
    }
    out.push(...entries);
    return out;
  }, [entries, path]);

  const doDelete = async () => {
    if (!selected || selected.name === "..") return;
    if (!confirm(`Delete ${selected.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        await DockerLocalFileDelete(containerId, selected.path);
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteFileDelete(sessionId, containerId, selected.path);
      }
      await list(path);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doMkdir = async () => {
    const name = prompt("Folder name:", "new_folder");
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const target = joinRemote(path, name);
      if (scope === "local") {
        await DockerLocalMkdir(containerId, target);
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteMkdir(sessionId, containerId, target);
      }
      await list(path);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doRename = async () => {
    if (!selected || selected.name === "..") return;
    const next = prompt("New name:", selected.name);
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const target = joinRemote(parentRemote(selected.path), next);
      if (scope === "local") {
        await DockerLocalRename(containerId, selected.path, target);
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteRename(sessionId, containerId, selected.path, target);
      }
      await list(path);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDownload = async () => {
    if (!selected || selected.isDir || selected.name === "..") return;
    const saveTo = await PickSaveFile(selected.name);
    if (!saveTo) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        await DockerLocalDownload(containerId, selected.path, saveTo);
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteDownload(sessionId, containerId, selected.path, saveTo);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doUpload = async () => {
    const localFile = await PickLocalFile();
    if (!localFile) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        await DockerLocalUpload(containerId, localFile, path);
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteUpload(sessionId, containerId, localFile, path);
      }
      await list(path);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="docker-files">
      <div className="docker-files-toolbar">
        <div className="mono">{path}</div>
        <div className="docker-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void list(path)} disabled={busy}>
            Refresh
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void list(parentRemote(path))} disabled={busy}>
            Up
          </button>
          <button className="btn" type="button" onClick={() => void doUpload()} disabled={busy}>
            Upload
          </button>
          <button className="btn" type="button" onClick={() => void doDownload()} disabled={busy || !selected || selected.isDir}>
            Download
          </button>
          <button className="btn" type="button" onClick={() => void doMkdir()} disabled={busy}>
            New folder
          </button>
          <button className="btn" type="button" onClick={() => void doRename()} disabled={busy || !selected || selected.name === ".."}>
            Rename
          </button>
          <button className="btn btn-danger" type="button" onClick={() => void doDelete()} disabled={busy || !selected || selected.name === ".."}>
            Delete
          </button>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="docker-files-list">
        <table className="docker-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
            </tr>
          </thead>
          <tbody>
            {displayEntries.map((e) => (
              <tr
                key={e.path}
                onDoubleClick={() => {
                  if (e.isDir) void list(e.path);
                }}
                onClick={() => setSelected(e)}
                style={{ background: selected?.path === e.path ? "rgba(110, 231, 255, 0.08)" : "transparent" }}
              >
                <td>{e.isDir ? `📁 ${e.name}` : e.name}</td>
                <td>{e.isDir ? "-" : String(e.size ?? 0)}</td>
                <td>{e.mtimeMs ? new Date(e.mtimeMs).toLocaleString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
