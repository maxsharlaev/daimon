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
  initialPath?: string;
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

function breadcrumbsRemote(p: string): Array<{ label: string; path: string }> {
  const raw = String(p ?? "").trim();
  if (raw === ".") return [{ label: ".", path: "." }];
  if (!raw || raw === "/") return [{ label: "/", path: "/" }];
  const parts = raw.split("/").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let cur = "";
  parts.forEach((part) => {
    cur += `/${part}`;
    out.push({ label: part, path: cur });
  });
  return out;
}

function fmtSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 10 || i === 0 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function fmtDate(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function DockerFilesPanel({ scope, sessionId, containerId, initialPath = "/" }: Props) {
  const [path, setPath] = useState<string>(initialPath);
  const [entries, setEntries] = useState<DockerFileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DockerFileEntry | null>(null);

  const list = async (p = path) => {
    setBusy(true);
    setError(null);
    try {
      if (scope === "local") {
        const next = await DockerLocalListDir(containerId, p);
        setEntries(Array.isArray(next) ? next : []);
      } else {
        if (!sessionId) throw new Error("Remote session not connected");
        const next = await DockerRemoteListDir(sessionId, containerId, p);
        setEntries(Array.isArray(next) ? next : []);
      }
      setSelected(null);
      setPath(p);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setEntries([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void list(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sessionId, containerId, initialPath]);

  const displayEntries = useMemo(() => {
    const out: DockerFileEntry[] = [];
    if (path !== "/") {
      out.push({ name: "..", path: parentRemote(path), isDir: true, size: 0, mtimeMs: 0 });
    }
    const sorted = [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    out.push(...sorted);
    return out;
  }, [entries, path]);

  const crumbs = useMemo(() => breadcrumbsRemote(path), [path]);

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
        <div className="docker-files-path" title={path}>
          <span className="pathlabel">Path:</span>
          <div className="crumbs">
            {crumbs.map((c, idx) => (
              <span key={c.path} className="crumbwrap">
                <button className="crumb" type="button" onClick={() => void list(c.path)}>
                  {c.label}
                </button>
                {idx < crumbs.length - 1 && c.path !== "/" ? <span className="crumbsep">/</span> : null}
              </span>
            ))}
          </div>
        </div>
        <div className="docker-files-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void list(path)} disabled={busy}>
            Refresh
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void list(parentRemote(path))} disabled={busy}>
            Up
          </button>
          <button className="btn" type="button" onClick={() => void doUpload()} disabled={busy}>
            Upload →
          </button>
          <button className="btn" type="button" onClick={() => void doDownload()} disabled={busy || !selected || selected.isDir}>
            ← Download
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
        <div className="list">
          {displayEntries.map((e) => {
            const isSelected = selected?.path === e.path;
            const meta =
              e.name === ".."
                ? ""
                : `${e.isDir ? "" : fmtSize(e.size ?? 0)}${e.mtimeMs ? `${e.isDir ? "" : " • "}${fmtDate(e.mtimeMs)}` : ""}`;
            return (
              <div
                key={e.path}
                className={`row ${isSelected ? "selected" : ""}`}
                onDoubleClick={() => {
                  if (e.isDir) void list(e.path);
                }}
                onClick={() => setSelected(e)}
              >
                <span className={`name ${e.isSymlink ? "link" : e.isDir ? "dir" : ""}`}>
                  {e.isDir ? "📁 " : ""}
                  {e.isSymlink && e.linkTarget ? `${e.name} -> ${e.linkTarget}` : e.name}
                </span>
                <span className="meta">{meta}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
