import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LocalHomeDir,
  LocalListDrives,
  LocalListDir,
  LocalDelete,
  LocalMkdir,
  LocalRename,
  LocalStat,
  SFTPListDir,
  SFTPGetwd,
  SFTPDelete,
  SFTPMkdir,
  SFTPRename,
  SFTPStat,
  SFTPDownloadStart,
  SFTPUploadStart,
  SFTPTransferChunk,
  SFTPTransferCancel,
  PickLocalFile,
  PickLocalFolder,
} from "../../wailsjs/go/main/App";
import { onSFTPTransfer, startSFTPEventBridge } from "../sftp/events";
import "./filesmanager.css";

type Props = {
  sessionId: string;
  profileId: string;
  initialLocalPath?: string;
  initialRemotePath?: string;
  onPathsChanged?: (next: { localPath: string; remotePath: string }) => void;
  onOpenTerminalAtPath?: (remotePath: string) => void;
  onSessionPathsChanged?: (next: { localPath: string; remotePath: string }) => void;
  onOpenPlaces?: (profileId: string) => void;
  onAddLocation?: (profileId: string, remotePath: string) => void;
  navToRemote?: { path: string; token: number };
};

type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
};

type TransferStatus = {
  transferId: string;
  direction: "download" | "upload";
  state: "running" | "success" | "failed" | "cancelled" | string;
  doneBytes: number;
  totalBytes: number;
  bps: number; // bytes/sec (smoothed)
  etaSec: number | null;
};

type ConflictInfo = {
  open: boolean;
  remotePath: string;
  localPath: string;
  localExisting?: FileEntry | null;
  remoteFile?: FileEntry | null;
  renameName?: string;
  error?: string | null;
};

export function FilesManager({
  sessionId,
  profileId,
  initialLocalPath,
  initialRemotePath,
  onPathsChanged,
  onOpenTerminalAtPath,
  onSessionPathsChanged,
  onOpenPlaces,
  onAddLocation,
  navToRemote,
}: Props) {
  const [localPath, setLocalPath] = useState<string>("");
  const [remotePath, setRemotePath] = useState<string>(".");
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activePane, setActivePane] = useState<"local" | "remote">("remote");
  const [selLocal, setSelLocal] = useState<string | null>(null);
  const [selRemote, setSelRemote] = useState<string | null>(null);

  const [transfers, setTransfers] = useState<TransferStatus[]>([]);
  const speedByTransferRef = useRef<Map<string, { lastTs: number; lastDone: number; emaBps: number }>>(new Map());
  const cancelByTransferRef = useRef<Set<string>>(new Set());
  const [localDrives, setLocalDrives] = useState<string[]>([]);
  const [remoteGoOpen, setRemoteGoOpen] = useState(false);
  const [remotePathInput, setRemotePathInput] = useState<string>("");
  const [conflict, setConflict] = useState<ConflictInfo>({ open: false, remotePath: "", localPath: "" });
  const remotePathLockedRef = useRef(false);

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
      if (initialLocalPath && initialLocalPath.trim()) {
        setLocalPath(initialLocalPath);
      } else {
        const home = await LocalHomeDir();
        setLocalPath(home);
      }
      try {
        if (initialRemotePath && initialRemotePath.trim()) {
          if (!remotePathLockedRef.current) {
            setRemotePath(initialRemotePath);
            setRemotePathInput(initialRemotePath);
          }
        } else {
          const wd = await SFTPGetwd(sessionId);
          if (!remotePathLockedRef.current) {
            setRemotePath(wd || ".");
            setRemotePathInput(wd || ".");
          }
        }
      } catch {
        if (!remotePathLockedRef.current) {
          setRemotePath(".");
          setRemotePathInput(".");
        }
      }
      try {
        const drives = await LocalListDrives();
        setLocalDrives((drives as any) as string[]);
      } catch {
        setLocalDrives([]);
      }
    };
    void init();
  }, [sessionId, initialLocalPath, initialRemotePath]);

  useEffect(() => {
    setRemotePathInput(remotePath);
  }, [remotePath]);

  useEffect(() => {
    if (!navToRemote) return;
    const p = String(navToRemote.path ?? "").trim();
    if (!p) return;
    const go = async () => {
      setError(null);
      try {
        await validateRemoteDir(p);
        await goRemote(p);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    };
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToRemote?.token]);

  // persist dirs (per profile) in parent
  useEffect(() => {
    if (!onPathsChanged) return;
    if (!localPath) return;
    if (!remotePath) return;
    const t = setTimeout(() => onPathsChanged({ localPath, remotePath }), 250);
    return () => clearTimeout(t);
  }, [localPath, remotePath, onPathsChanged]);

  useEffect(() => {
    if (!onSessionPathsChanged) return;
    if (!localPath) return;
    if (!remotePath) return;
    const t = setTimeout(() => onSessionPathsChanged({ localPath, remotePath }), 250);
    return () => clearTimeout(t);
  }, [localPath, remotePath, onSessionPathsChanged]);


  // Keybindings (MVP): Tab switch pane, Enter open dir, Backspace up
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Disable FilesManager keybindings while any modal is open.
      // Important: do NOT preventDefault here, so inputs in modals keep working (Backspace, arrows, etc).
      const modalOpen = !!document.querySelector(".modal-overlay");
      if (modalOpen) return;

      const t = e.target as any;
      const tag = String(t?.tagName ?? "").toLowerCase();
      const isEditable =
        tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable;
      if (isEditable) return;

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
    setBusy(true);
    try {
      const jobs: Promise<void>[] = [];

      if (localPath) {
        jobs.push(
          LocalListDir(localPath).then((l) => {
            setLocalEntries((l as any) as FileEntry[]);
          })
        );
      }

      if (remotePath) {
        jobs.push(
          SFTPListDir(sessionId, remotePath).then((r) => {
            setRemoteEntries((r as any) as FileEntry[]);
          })
        );
      }

      await Promise.all(jobs);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPath, remotePath, sessionId]);

  useEffect(() => {
    startSFTPEventBridge();
    const unsub = onSFTPTransfer((ev) => {
      setTransfers((prev) =>
        prev.map((t) => {
          if (t.transferId !== ev.transferId) return t;

          const now = Date.now();
          const doneBytes = Number(ev.doneBytes ?? 0);
          const totalBytes = Number(ev.totalBytes ?? 0);

          const prevSpeed = speedByTransferRef.current.get(ev.transferId);
          let emaBps = prevSpeed?.emaBps ?? 0;
          if (!prevSpeed) {
            speedByTransferRef.current.set(ev.transferId, { lastTs: now, lastDone: doneBytes, emaBps: 0 });
          } else {
            const dt = Math.max(1, now - prevSpeed.lastTs);
            const delta = Math.max(0, doneBytes - prevSpeed.lastDone);
            const inst = (delta * 1000) / dt;
            emaBps = emaBps <= 0 ? inst : emaBps * 0.85 + inst * 0.15;
            speedByTransferRef.current.set(ev.transferId, { lastTs: now, lastDone: doneBytes, emaBps });
          }

          const etaSec = totalBytes > 0 && emaBps > 1 ? Math.max(0, Math.floor((totalBytes - doneBytes) / emaBps)) : null;
          return { ...t, state: ev.state, doneBytes, totalBytes, bps: emaBps, etaSec };
        })
      );

      if (ev.state === "success" || ev.state === "failed" || ev.state === "cancelled") {
        setTimeout(() => {
          setTransfers((cur) => cur.filter((t) => t.transferId !== ev.transferId));
          speedByTransferRef.current.delete(ev.transferId);
          cancelByTransferRef.current.delete(ev.transferId);
        }, 1500);
      }
    });
    return () => unsub();
  }, []);

  const goLocal = async (p: string) => {
    // Avoid showing previous directory entries under the new path while refresh is in-flight.
    setLocalEntries([]);
    setLocalPath(p);
    setSelLocal(null);
  };

  const goRemote = async (p: string) => {
    remotePathLockedRef.current = true;
    // Avoid showing previous directory entries under the new path while refresh is in-flight.
    setRemoteEntries([]);
    setRemotePath(p);
    setSelRemote(null);
  };

  const validateRemoteDir = async (p: string) => {
    // Validate path exists / is readable
    await SFTPListDir(sessionId, p);
  };

  const goRemoteByInput = async () => {
    const p = remotePathInput.trim() || ".";
    setError(null);
    try {
      await validateRemoteDir(p);
      await goRemote(p);
      setRemoteGoOpen(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const openTerminalHere = () => {
    onOpenTerminalAtPath?.(remotePath);
  };

  const openTerminalAtInput = () => {
    const p = remotePathInput.trim() || ".";
    onOpenTerminalAtPath?.(p);
    setRemoteGoOpen(false);
  };

  const runTransferToEnd = async (transferId: string) => {
    while (true) {
      if (cancelByTransferRef.current.has(transferId)) break;
      try {
        const ev: any = await SFTPTransferChunk(transferId, 256 * 1024);
        const state = String(ev?.state ?? "running");
        if (state !== "running") break;
        // yield to UI
        await new Promise((r) => setTimeout(r, 0));
      } catch {
        break;
      }
    }
  };

  const cancelTransfer = async (transferId: string) => {
    const t = transfers.find((x) => x.transferId === transferId);
    if (!t || t.state !== "running") return;
    cancelByTransferRef.current.add(transferId);
    try {
      await SFTPTransferCancel(transferId);
    } catch {
      // ignore
    }
    setTransfers((cur) => cur.map((x) => (x.transferId === transferId ? { ...x, state: "cancelled" } : x)));
  };

  const download = async () => {
    const remote = selRemote;
    if (!remote) return;
    const saveTo = joinLocal(localPath, extractName(remote));

    try {
      const st: any = await LocalStat(saveTo);
      // exists -> show conflict modal
      let remoteInfo: any = remoteEntries.find((e) => e.path === remote) ?? null;
      try {
        remoteInfo = (await SFTPStat(sessionId, remote)) as any;
      } catch {
        // keep list info if stat fails
      }
      setConflict({
        open: true,
        remotePath: remote,
        localPath: saveTo,
        localExisting: (st as any) as FileEntry,
        remoteFile: remoteInfo,
        renameName: extractName(saveTo),
        error: null,
      });
      return;
    } catch {
      // doesn't exist -> proceed
    }

    try {
      const start: any = await SFTPDownloadStart(sessionId, remote, saveTo);
      const transferId = String(start?.transferId ?? start?.TransferID ?? "");
      const totalBytes = Number(start?.totalBytes ?? start?.TotalBytes ?? 0);
      if (!transferId) throw new Error("failed to start download");
      speedByTransferRef.current.set(transferId, { lastTs: Date.now(), lastDone: 0, emaBps: 0 });
      setTransfers((prev) => [...prev, { transferId, direction: "download", state: "running", doneBytes: 0, totalBytes, bps: 0, etaSec: null }]);
      void runTransferToEnd(transferId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const doStartDownload = async (remote: string, dest: string) => {
    const start: any = await SFTPDownloadStart(sessionId, remote, dest);
    const transferId = String(start?.transferId ?? start?.TransferID ?? "");
    const totalBytes = Number(start?.totalBytes ?? start?.TotalBytes ?? 0);
    if (!transferId) throw new Error("failed to start download");
    speedByTransferRef.current.set(transferId, { lastTs: Date.now(), lastDone: 0, emaBps: 0 });
    setTransfers((prev) => [...prev, { transferId, direction: "download", state: "running", doneBytes: 0, totalBytes, bps: 0, etaSec: null }]);
    void runTransferToEnd(transferId);
  };

  const resolveConflictOverwrite = async () => {
    const remote = conflict.remotePath;
    const dest = conflict.localPath;
    setConflict({ open: false, remotePath: "", localPath: "" });
    try {
      await doStartDownload(remote, dest);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const resolveConflictRename = async () => {
    const remote = conflict.remotePath;
    const dest0 = conflict.localPath;
    setConflict({ open: false, remotePath: "", localPath: "" });
    try {
      const dest = await nextAvailablePath(dest0);
      await doStartDownload(remote, dest);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const resolveConflictRenameManual = async () => {
    const remote = conflict.remotePath;
    const dir = parentLocal(conflict.localPath);
    const name = String(conflict.renameName ?? "").trim();
    if (!name) {
      setConflict((c) => ({ ...c, error: "Enter a filename." }));
      return;
    }
    const dest = joinLocal(dir, name);
    try {
      await LocalStat(dest);
      setConflict((c) => ({ ...c, error: "That name already exists." }));
      return;
    } catch {
      // ok
    }
    setConflict({ open: false, remotePath: "", localPath: "" });
    try {
      await doStartDownload(remote, dest);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const upload = async () => {
    const localFile = await PickLocalFile();
    if (!localFile) return;
    const baseName = extractName(localFile);
    // naive: upload into current remote dir
    const remoteTarget = joinRemote(remotePath, baseName);
    try {
      const start: any = await SFTPUploadStart(sessionId, localFile, remoteTarget);
      const transferId = String(start?.transferId ?? start?.TransferID ?? "");
      const totalBytes = Number(start?.totalBytes ?? start?.TotalBytes ?? 0);
      if (!transferId) throw new Error("failed to start upload");
      speedByTransferRef.current.set(transferId, { lastTs: Date.now(), lastDone: 0, emaBps: 0 });
      setTransfers((prev) => [...prev, { transferId, direction: "upload", state: "running", doneBytes: 0, totalBytes, bps: 0, etaSec: null }]);
      void runTransferToEnd(transferId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
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
          <span className="muted">SFTP session: {sessionId.slice(0, 8)}</span>
          {error ? <span className="error-text">{error}</span> : null}
        </div>
        <div className="panel-actions">
          {onOpenPlaces ? (
            <button className="btn btn-ghost" type="button" onClick={() => onOpenPlaces(profileId)} disabled={busy}>
              Places
            </button>
          ) : null}
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
      </div>

      <div className="files-split">
        <div className={`pane ${activePane === "local" ? "active" : ""}`}>
          <div className="pathbar">
            <button className="pathlabel-btn" type="button" onClick={() => void pickLocalDir()} title="Pick local folder">
              Local:
            </button>
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
            <button
              className="pathlabel-btn"
              type="button"
              onClick={() => {
                setRemotePathInput(remotePath);
                setRemoteGoOpen(true);
              }}
              title="Go to remote path"
            >
              Remote:
            </button>
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
            <button className="iconbtn" type="button" onClick={() => void openTerminalHere()} title="Open terminal here">
              ⌘
            </button>
            {onAddLocation ? (
              <button className="iconbtn" type="button" onClick={() => onAddLocation(profileId, remotePath)} title="Save location">
                +
              </button>
            ) : null}
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

      {transfers.length > 0 ? (
        <div className="transferpanel">
          {transfers.map((t) => {
            const pct = t.totalBytes > 0 ? Math.min(100, Math.floor((t.doneBytes / t.totalBytes) * 100)) : 0;
            const canCancel = t.state === "running";
            return (
              <div key={t.transferId} className={`transferrow ${t.state}`}>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                  <div className="progress-text">{pct}%</div>
                </div>
                <div className="transfermeta mono">
                  {t.direction} • {fmtBytes(t.doneBytes)}/{fmtBytes(t.totalBytes)} • {fmtBps(t.bps)}
                  {t.etaSec !== null ? ` • ETA ${fmtEta(t.etaSec)}` : ""} • {t.state}
                </div>
                <button className="btn btn-ghost transfer-cancel" type="button" onClick={() => void cancelTransfer(t.transferId)} disabled={!canCancel}>
                  Cancel
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {conflict.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">File already exists</div>
            <div className="modal-body">
              <div className="conflict-grid">
                <div>
                  <div className="conflict-h">Local existing</div>
                  <div className="mono">{conflict.localPath}</div>
                  <div className="muted">
                    {conflict.localExisting ? `${fmtBytes(conflict.localExisting.size)} • ${fmtDate(conflict.localExisting.mtimeMs)}` : "—"}
                  </div>
                </div>
                <div>
                  <div className="conflict-h">Downloading</div>
                  <div className="mono">{conflict.remotePath}</div>
                  <div className="muted">
                    {conflict.remoteFile ? `${fmtBytes(conflict.remoteFile.size)} • ${fmtDate(conflict.remoteFile.mtimeMs)}` : "—"}
                  </div>
                </div>
              </div>
              <label>Rename to</label>
              <input
                value={conflict.renameName ?? ""}
                onChange={(e) => setConflict((c) => ({ ...c, renameName: e.target.value, error: null }))}
                placeholder="new name"
              />
              {conflict.error ? <div className="error-text">{conflict.error}</div> : null}
              <div className="muted">Choose what to do:</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setConflict({ open: false, remotePath: "", localPath: "" })}>
                Cancel
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => void resolveConflictRenameManual()}>
                Rename…
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => void resolveConflictRename()}>
                Rename (2,3…)
              </button>
              <button className="btn" type="button" onClick={() => void resolveConflictOverwrite()}>
                Overwrite
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {remoteGoOpen
        ? createPortal(
            <div className="modal-overlay" role="dialog" aria-modal="true">
              <div className="modal">
                <div className="modal-title">Remote path</div>
                <div className="modal-body">
                  <label>Path</label>
                  <input
                    className="mono"
                    value={remotePathInput}
                    onChange={(e) => setRemotePathInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void goRemoteByInput();
                      }
                    }}
                    spellCheck={false}
                  />
                  <div className="muted">Enter a directory path (e.g. /root) and press Enter.</div>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost" type="button" onClick={() => setRemoteGoOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => void openTerminalAtInput()}>
                    Terminal
                  </button>
                  <button className="btn" type="button" onClick={() => void goRemoteByInput()}>
                    Go
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
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

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fmtBps(bps: number) {
  if (!Number.isFinite(bps) || bps <= 0) return "—/s";
  return `${fmtBytes(Math.floor(bps))}/s`;
}

function fmtPct(done: number, total: number) {
  if (!total || total <= 0) return "—%";
  return `${Math.min(100, Math.floor((done / total) * 100))}%`;
}

function fmtEta(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm < 60) return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  const hh = Math.floor(mm / 60);
  const rem = mm % 60;
  return `${String(hh).padStart(2, "0")}:${String(rem).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function fmtDate(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

async function nextAvailablePath(p: string) {
  const name = extractName(p);
  const dir = parentLocal(p);
  const m = name.match(/^(.*?)(\.[^.]*)?$/);
  const stem = m?.[1] ?? name;
  const ext = m?.[2] ?? "";

  for (let i = 2; i < 10000; i++) {
    const candidate = joinLocal(dir, `${stem} ${i}${ext}`);
    try {
      await LocalStat(candidate);
      // exists -> keep searching
    } catch {
      return candidate;
    }
  }
  throw new Error("no free filename found");
}

