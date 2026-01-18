import { useEffect, useMemo, useState } from "react";
import {
  LocalHomeDir,
  LocalListDrives,
  LocalListDir,
  LocalDelete,
  LocalMkdir,
  LocalRename,
  SFTPListDir,
  SFTPGetwd,
  SFTPDelete,
  SFTPMkdir,
  SFTPRename,
  SFTPDownloadToLocal,
  SFTPUploadFromLocal,
  PickLocalFile,
  PickSaveFile,
  PickLocalFolder,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import "./filesmanager.css";

type Props = {
  sessionId: string;
};

type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
};

export function FilesManager({ sessionId }: Props) {
  const [localPath, setLocalPath] = useState<string>("");
  const [remotePath, setRemotePath] = useState<string>(".");
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activePane, setActivePane] = useState<"local" | "remote">("remote");
  const [selLocal, setSelLocal] = useState<string | null>(null);
  const [selRemote, setSelRemote] = useState<string | null>(null);

  const [transferText, setTransferText] = useState<string | null>(null);
  const [localDrives, setLocalDrives] = useState<string[]>([]);

  const localDisplayEntries = useMemo(() => {
    const out: FileEntry[] = [];
    const up = parentLocal(localPath);
    if (localPath && up && up !== localPath) {
      out.push({ name: "..", path: up, isDir: true, size: 0, mtimeMs: 0 });
    }
    out.push(...localEntries);
    return out;
  }, [localEntries, localPath]);

  const remoteDisplayEntries = useMemo(() => {
    const out: FileEntry[] = [];
    const up = parentRemote(remotePath);
    if (remotePath && up && up !== remotePath) {
      out.push({ name: "..", path: up, isDir: true, size: 0, mtimeMs: 0 });
    }
    out.push(...remoteEntries);
    return out;
  }, [remoteEntries, remotePath]);

  const localCrumbs = useMemo(() => breadcrumbsLocal(localPath), [localPath]);
  const remoteCrumbs = useMemo(() => breadcrumbsRemote(remotePath), [remotePath]);

  const localDrive = useMemo(() => driveFromLocalPath(localPath), [localPath]);

  useEffect(() => {
    const init = async () => {
      const home = await LocalHomeDir();
      setLocalPath(home);
      try {
        const wd = await SFTPGetwd(sessionId);
        setRemotePath(wd || ".");
      } catch {
        setRemotePath(".");
      }
      try {
        const drives = await LocalListDrives();
        setLocalDrives((drives as any) as string[]);
      } catch {
        setLocalDrives([]);
      }
    };
    void init();
  }, [sessionId]);

  // Keybindings (MVP): Tab switch pane, Enter open dir, Backspace up
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        setActivePane((p) => (p === "local" ? "remote" : "local"));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -1 : 1;
        if (activePane === "local") {
          const next = moveSelection(localDisplayEntries, selLocal, delta);
          if (next) setSelLocal(next);
        } else {
          const next = moveSelection(remoteDisplayEntries, selRemote, delta);
          if (next) setSelRemote(next);
        }
        return;
      }
      if (e.key === "Enter") {
        const sel = activePane === "local" ? selLocal : selRemote;
        if (!sel) return;
        if (activePane === "local") {
          const ent = localDisplayEntries.find((x) => x.path === sel);
          if (ent?.isDir) void goLocal(ent.path);
        } else {
          const ent = remoteDisplayEntries.find((x) => x.path === sel);
          if (ent?.isDir) void goRemote(ent.path);
        }
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (activePane === "local") {
          const up = parentLocal(localPath);
          if (up && up !== localPath) void goLocal(up);
        } else {
          const up = parentRemote(remotePath);
          if (up && up !== remotePath) void goRemote(up);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePane, selLocal, selRemote, localPath, remotePath, localDisplayEntries, remoteDisplayEntries]);

  const refresh = async () => {
    if (!localPath) return;
    setBusy(true);
    setError(null);
    try {
      const [l, r] = await Promise.all([
        LocalListDir(localPath),
        SFTPListDir(sessionId, remotePath),
      ]);
      setLocalEntries((l as any) as FileEntry[]);
      setRemoteEntries((r as any) as FileEntry[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!localPath) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPath, remotePath, sessionId]);

  useEffect(() => {
    // progress events
    EventsOn("sftp:transfer", (...args: any[]) => {
      const ev = normalizeEvent<any>(args);
      if (!ev) return;
      const pct = ev.totalBytes ? Math.floor((ev.doneBytes / ev.totalBytes) * 100) : 0;
      setTransferText(`${ev.direction} ${pct}% (${ev.doneBytes}/${ev.totalBytes}) ${ev.state}`);
      if (ev.state === "success" || ev.state === "failed") {
        setTimeout(() => setTransferText(null), 1500);
      }
    });
  }, []);

  const goLocal = async (p: string) => {
    // Avoid showing previous directory entries under the new path while refresh is in-flight.
    setLocalEntries([]);
    setLocalPath(p);
    setSelLocal(null);
  };

  const goRemote = async (p: string) => {
    // Avoid showing previous directory entries under the new path while refresh is in-flight.
    setRemoteEntries([]);
    setRemotePath(p);
    setSelRemote(null);
  };

  const download = async () => {
    const remote = selRemote;
    if (!remote) return;
    const saveTo = await PickSaveFile(extractName(remote));
    if (!saveTo) return;
    setBusy(true);
    setError(null);
    try {
      await SFTPDownloadToLocal(sessionId, remote, saveTo);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    const localFile = await PickLocalFile();
    if (!localFile) return;
    const baseName = extractName(localFile);
    // naive: upload into current remote dir
    const remoteTarget = joinRemote(remotePath, baseName);
    setBusy(true);
    setError(null);
    try {
      await SFTPUploadFromLocal(sessionId, localFile, remoteTarget);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickLocalDir = async () => {
    const dir = await PickLocalFolder();
    if (dir) setLocalPath(dir);
  };

  const mkdir = async () => {
    const name = prompt("Folder name:", "new_folder");
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      if (activePane === "local") {
        await LocalMkdir(joinLocal(localPath, name));
      } else {
        await SFTPMkdir(sessionId, joinRemote(remotePath, name));
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const sel = activePane === "local" ? selLocal : selRemote;
    if (!sel) return;
    const newName = prompt("New name:", extractName(sel));
    if (!newName) return;
    setBusy(true);
    setError(null);
    try {
      if (activePane === "local") {
        await LocalRename(sel, joinLocal(parentLocal(sel), newName));
      } else {
        await SFTPRename(sessionId, sel, joinRemote(parentRemote(sel), newName));
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    const sel = activePane === "local" ? selLocal : selRemote;
    if (!sel) return;
    if (!confirm(`Delete ${extractName(sel)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      if (activePane === "local") {
        await LocalDelete(sel);
      } else {
        await SFTPDelete(sessionId, sel);
      }
      if (activePane === "local") setSelLocal(null);
      else setSelRemote(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const fmtSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="files panel">
      <div className="panel-titlebar">
        <div className="panel-title">Files</div>
        <div className="panel-meta">
          {transferText ? <span className="mono">{transferText}</span> : <span className="muted">SFTP session: {sessionId.slice(0, 8)}</span>}
          {error ? <span className="error-text">{error}</span> : null}
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={refresh} disabled={busy}>
            Refresh
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
        <button className="btn btn-ghost" type="button" onClick={mkdir} disabled={busy}>
          Mkdir
        </button>
        <button className="btn btn-ghost" type="button" onClick={rename} disabled={busy || (!selLocal && !selRemote)}>
          Rename
        </button>
        <button className="btn btn-ghost" type="button" onClick={del} disabled={busy || (!selLocal && !selRemote)}>
          Delete
        </button>
        <button className="btn" type="button" onClick={upload} disabled={busy}>
          Upload →
        </button>
        <button className="btn" type="button" onClick={download} disabled={busy || !selRemote}>
          ← Download
        </button>
        <button className="btn btn-ghost" type="button" onClick={pickLocalDir} disabled={busy}>
          Local…
        </button>
      </div>

      <div className="files-split">
        <div className={`pane ${activePane === "local" ? "active" : ""}`}>
          <div className="pathbar">
            <span className="pathlabel">Local:</span>
            {localDrives.length > 0 ? (
              <select
                className="drive-select"
                value={localDrive || ""}
                onChange={(e) => {
                  const d = e.target.value;
                  if (d) void goLocal(d);
                }}
              >
                {localDrives.map((d) => (
                  <option key={d} value={d}>
                    {d.replace(/\\$/, "")}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="crumbs" title={localPath}>
              {localCrumbs.map((c, idx) => (
                <span key={c.path} className="crumbwrap">
                  <button className="crumb" type="button" onClick={() => void goLocal(c.path)}>
                    {c.label}
                  </button>
                  {idx < localCrumbs.length - 1 ? <span className="crumbsep">/</span> : null}
                </span>
              ))}
            </div>
          </div>
          <div className="list">
            {localDisplayEntries.map((e) => (
              <div
                key={e.path}
                className={`row ${selLocal === e.path ? "selected" : ""}`}
                onClick={() => {
                  setActivePane("local");
                  setSelLocal(e.path);
                }}
                onDoubleClick={() => {
                  if (e.isDir) void goLocal(e.path);
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
            <span className="pathlabel">Remote:</span>
            <div className="crumbs" title={remotePath}>
              {remoteCrumbs.map((c, idx) => (
                <span key={c.path} className="crumbwrap">
                  <button className="crumb" type="button" onClick={() => void goRemote(c.path)}>
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
            {remoteDisplayEntries.map((e) => (
              <div
                key={e.path}
                className={`row ${selRemote === e.path ? "selected" : ""}`}
                onClick={() => {
                  setActivePane("remote");
                  setSelRemote(e.path);
                }}
                onDoubleClick={() => {
                  if (e.isDir) void goRemote(e.path);
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

function extractName(p: string) {
  const parts = p.replace(/\\\\/g, "/").split("/");
  return parts[parts.length - 1] || "file";
}

function joinRemote(dir: string, name: string) {
  if (!dir || dir === ".") return name;
  if (dir === "/") return `/${name}`;
  const base = dir.replace(/\/+$/, "");
  return `${base}/${name}`;
}

function parentRemote(p: string) {
  if (!p || p === ".") return ".";
  const s = p.replace(/\/+$/, "") || "/";
  if (s === "/") return "/";
  const i = s.lastIndexOf("/");
  if (i <= 0) return "/";
  return s.slice(0, i) || "/";
}

function joinLocal(dir: string, name: string) {
  // Windows paths are OK; backend will clean.
  return dir.replace(/[\\\/]+$/, "") + "\\" + name;
}

function parentLocal(p: string) {
  if (!p) return "";
  const norm = p.replace(/[\\\/]+$/, "");
  // Drive root handling: "C:" or "C:\" should stay at "C:\"
  if (/^[a-zA-Z]:$/.test(norm)) return norm + "\\";
  if (/^[a-zA-Z]:\\$/.test(norm)) return norm.slice(0, 2) + "\\";
  const i = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (i <= 0) return norm;
  // Keep "C:\" as root
  if (i === 2 && /^[a-zA-Z]:/.test(norm)) return norm.slice(0, 2) + "\\";
  return norm.slice(0, i);
}

function moveSelection(entries: FileEntry[], current: string | null, delta: number): string | null {
  if (!entries || entries.length === 0) return null;
  const idx = current ? entries.findIndex((e) => e.path === current) : -1;
  const nextIdx = clamp((idx >= 0 ? idx : 0) + delta, 0, entries.length - 1);
  return entries[nextIdx]?.path ?? null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function driveFromLocalPath(p: string): string | null {
  if (!p) return null;
  const m = p.match(/^([a-zA-Z]:)(\\|\/)?/);
  if (!m) return null;
  return m[1] + "\\";
}

function breadcrumbsLocal(p: string): Array<{ label: string; path: string }> {
  if (!p) return [];
  const norm = p.replace(/\//g, "\\");
  const m = norm.match(/^([a-zA-Z]:)\\?/);
  if (!m) {
    // fallback: split by "\"
    const parts = norm.split("\\").filter(Boolean);
    const out: Array<{ label: string; path: string }> = [];
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}\\${part}` : part;
      out.push({ label: part, path: cur });
    }
    return out;
  }
  const drive = m[1] + "\\";
  const rest = norm.slice(drive.length).split("\\").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: drive.replace(/\\$/, ""), path: drive }];
  let cur = drive.replace(/[\\\/]+$/, "") + "\\";
  for (const part of rest) {
    cur = cur.replace(/[\\\/]+$/, "") + "\\" + part;
    out.push({ label: part, path: cur });
  }
  return out;
}

function breadcrumbsRemote(p: string): Array<{ label: string; path: string }> {
  if (!p) return [];
  if (p === ".") return [{ label: ".", path: "." }];
  const clean = p.replace(/\/+$/, "") || "/";
  if (clean === "/") return [{ label: "/", path: "/" }];
  const parts = clean.split("/").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : `/${part}`;
    out.push({ label: part, path: cur });
  }
  return out;
}

function normalizeEvent<T>(args: any[]): T | null {
  if (!args || args.length === 0) return null;
  let v = args[0];
  if (Array.isArray(v) && v.length === 1) v = v[0];
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  if (typeof v === "object") return v as T;
  return null;
}

