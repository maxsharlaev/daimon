import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DockerLocalListDir,
  DockerLocalReadFileTail,
  DockerRemoteConnectProfile,
  DockerRemoteDisconnect,
  DockerRemoteListDir,
  DockerRemoteReadFileTail,
  PreviewLogParse,
  SFTPConnectProfile,
  SFTPDisconnect,
  SFTPGetwd,
  SFTPListDir,
  SFTPReadFileTail,
} from "../../wailsjs/go/main/App";
import type { DockerContainerDTO } from "../types/docker";
import type { LogFormatDTO, LogParsePreviewResultDTO } from "../types/logs";
import { presetPathForFormat } from "./logSourceFormatPresets";
import { parentUnix, pathToListSpec } from "./logSourcePathUtils";
import { DropdownSelect } from "./ui";

const TAIL_MAX_BYTES = 262144;

export type LogSourceEditorState = {
  open: boolean;
  id?: string;
  path: string;
  formatId: string;
  displayName: string;
};

type OwnerKind = "profile" | "docker_local" | "docker_remote";

type Props = {
  open: boolean;
  editor: LogSourceEditorState;
  setEditor: React.Dispatch<React.SetStateAction<LogSourceEditorState>>;
  formats: LogFormatDTO[];
  ownerKind: OwnerKind;
  activeProfileId: string;
  selectedLocalContainer: string;
  localContainers: DockerContainerDTO[];
  selectedRemoteProfileId: string;
  selectedRemoteContainer: string;
  remoteContainers: DockerContainerDTO[];
  onSave: () => void | Promise<void>;
  onClose: () => void;
};

type BrowseRow = { name: string; path: string; isDir: boolean };

export function LogSourceEditorModal({
  open,
  editor,
  setEditor,
  formats,
  ownerKind,
  activeProfileId,
  selectedLocalContainer,
  localContainers,
  selectedRemoteProfileId,
  selectedRemoteContainer,
  remoteContainers,
  onSave,
  onClose,
}: Props) {
  const sftpRef = useRef<string | null>(null);
  const remoteRef = useRef<string | null>(null);

  const [transportReady, setTransportReady] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [browseRoot, setBrowseRoot] = useState("/");

  const [localContainerId, setLocalContainerId] = useState<string | null>(null);

  const [debouncedPath, setDebouncedPath] = useState(editor.path);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedPath(editor.path), 260);
    return () => window.clearTimeout(t);
  }, [editor.path]);

  const [browseBusy, setBrowseBusy] = useState(false);
  const [browseRows, setBrowseRows] = useState<BrowseRow[]>([]);
  const [browseMsg, setBrowseMsg] = useState<string | null>(null);

  const [testMode, setTestMode] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testPreview, setTestPreview] = useState<LogParsePreviewResultDTO | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestMode(false);
    setTestPreview(null);
    setTestError(null);
  }, [open, editor.path, editor.formatId, editor.displayName]);

  useEffect(() => {
    if (!open) {
      setTransportReady(false);
      setTransportError(null);
      setBrowseRows([]);
      setBrowseMsg(null);
      setTestMode(false);
      setTestPreview(null);
      setTestError(null);
      if (sftpRef.current) {
        void SFTPDisconnect(sftpRef.current);
        sftpRef.current = null;
      }
      if (remoteRef.current) {
        void DockerRemoteDisconnect(remoteRef.current);
        remoteRef.current = null;
      }
      setLocalContainerId(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      setTransportError(null);
      setTransportReady(false);
      try {
        if (ownerKind === "profile") {
          if (!activeProfileId) throw new Error("No profile selected");
          const sid = await SFTPConnectProfile(activeProfileId);
          if (cancelled) {
            await SFTPDisconnect(sid);
            return;
          }
          sftpRef.current = sid;
          const wd = await SFTPGetwd(sid);
          setBrowseRoot(wd?.trim() ? wd : "/");
          setTransportReady(true);
        } else if (ownerKind === "docker_local") {
          const c = localContainers.find((x) => x.name === selectedLocalContainer);
          if (!c?.id) throw new Error("Container not found");
          setLocalContainerId(c.id);
          setBrowseRoot("/");
          setTransportReady(true);
        } else {
          if (!selectedRemoteProfileId) throw new Error("No remote profile");
          const rid = await DockerRemoteConnectProfile(selectedRemoteProfileId);
          if (cancelled) {
            await DockerRemoteDisconnect(rid);
            return;
          }
          remoteRef.current = rid;
          const c = remoteContainers.find((x) => x.name === selectedRemoteContainer);
          if (!c?.id) throw new Error("Container not found");
          setLocalContainerId(c.id);
          setBrowseRoot("/");
          setTransportReady(true);
        }
      } catch (e: any) {
        if (!cancelled) setTransportError(e?.message ?? String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (sftpRef.current) {
        void SFTPDisconnect(sftpRef.current);
        sftpRef.current = null;
      }
      if (remoteRef.current) {
        void DockerRemoteDisconnect(remoteRef.current);
        remoteRef.current = null;
      }
    };
  }, [
    open,
    ownerKind,
    activeProfileId,
    selectedLocalContainer,
    localContainers,
    selectedRemoteProfileId,
    selectedRemoteContainer,
    remoteContainers,
  ]);

  const listSpec = useMemo(() => pathToListSpec(debouncedPath, browseRoot), [debouncedPath, browseRoot]);

  const loadBrowse = useCallback(async () => {
    if (!open || !transportReady || testMode) return;
    if (ownerKind === "profile" && !sftpRef.current) return;
    if (ownerKind === "docker_remote" && (!remoteRef.current || !localContainerId)) return;
    if ((ownerKind === "docker_local" || ownerKind === "docker_remote") && !localContainerId) return;

    setBrowseBusy(true);
    setBrowseMsg(null);
    try {
      let raw: Array<{ name: string; path: string; isDir: boolean }> = [];
      if (ownerKind === "profile") {
        const sid = sftpRef.current!;
        const list = (await SFTPListDir(sid, listSpec.listDir)) as any[];
        raw = list.map((e) => ({
          name: e.name,
          path: e.path,
          isDir: !!e.isDir,
        }));
      } else if (ownerKind === "docker_local") {
        const list = (await DockerLocalListDir(localContainerId!, listSpec.listDir)) as any[];
        raw = list.map((e) => ({
          name: e.name,
          path: e.path,
          isDir: !!e.isDir,
        }));
      } else {
        const list = (await DockerRemoteListDir(remoteRef.current!, localContainerId!, listSpec.listDir)) as any[];
        raw = list.map((e) => ({
          name: e.name,
          path: e.path,
          isDir: !!e.isDir,
        }));
      }

      const rows: BrowseRow[] = [];
      if (listSpec.listDir !== "/") {
        rows.push({ name: "..", path: parentUnix(listSpec.listDir), isDir: true });
      }
      let rest = raw;
      if (listSpec.filterPrefix) {
        rest = raw.filter((e) => e.name.startsWith(listSpec.filterPrefix));
      }
      rest.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      rows.push(...rest);
      setBrowseRows(rows);
      if (listSpec.filterPrefix && rest.length === 0) {
        setBrowseMsg("Files not found");
      }
    } catch (e: any) {
      setBrowseRows([]);
      setBrowseMsg("Directory not found");
    } finally {
      setBrowseBusy(false);
    }
  }, [open, transportReady, testMode, ownerKind, listSpec, localContainerId]);

  useEffect(() => {
    void loadBrowse();
  }, [loadBrowse]);

  const applyPreset = () => {
    const p = presetPathForFormat(editor.formatId);
    if (p) setEditor((prev) => ({ ...prev, path: p }));
  };

  const runTest = async () => {
    if (testMode) {
      setTestMode(false);
      setTestPreview(null);
      setTestError(null);
      return;
    }
    const p = editor.path.trim();
    if (!p) {
      setTestError("Path is empty");
      return;
    }
    setTestBusy(true);
    setTestError(null);
    setTestPreview(null);
    try {
      let tail = "";
      if (ownerKind === "profile") {
        if (!sftpRef.current) throw new Error("Not connected");
        tail = await SFTPReadFileTail(sftpRef.current, p, TAIL_MAX_BYTES);
      } else if (ownerKind === "docker_local") {
        if (!localContainerId) throw new Error("No container");
        tail = await DockerLocalReadFileTail(localContainerId, p, TAIL_MAX_BYTES);
      } else {
        if (!remoteRef.current || !localContainerId) throw new Error("Not connected");
        tail = await DockerRemoteReadFileTail(remoteRef.current, localContainerId, p, TAIL_MAX_BYTES);
      }
      const r = (await PreviewLogParse(editor.formatId, tail)) as LogParsePreviewResultDTO;
      setTestPreview(r);
      setTestMode(true);
    } catch (e: any) {
      setTestError(e?.message ?? String(e));
      setTestMode(false);
      setTestPreview(null);
    } finally {
      setTestBusy(false);
    }
  };

  const onDblClickRow = (row: BrowseRow) => {
    if (row.name === "..") {
      const parent = row.path;
      setEditor((prev) => ({ ...prev, path: parent === "/" ? "/" : `${parent}/` }));
      return;
    }
    if (row.isDir) {
      const withSlash = row.path.endsWith("/") ? row.path : `${row.path}/`;
      setEditor((prev) => ({ ...prev, path: withSlash }));
    } else {
      setEditor((prev) => ({ ...prev, path: row.path }));
    }
  };

  const preset = presetPathForFormat(editor.formatId);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal--log-source">
        <div className="modal-title">{editor.id ? "Edit log file" : "Add log file"}</div>
        <div className="log-source-modal-body">
          <div className="log-source-modal-col log-source-modal-col--form form settings-logs-general">
            <label className="settings-field log-source-path-field">
              <span className="settings-field-label">Path</span>
              <div className="log-source-path-row">
                <input
                  className="settings-field-input mono"
                  value={editor.path}
                  onChange={(e) => setEditor((prev) => ({ ...prev, path: e.target.value }))}
                />
                {preset ? (
                  <button
                    type="button"
                    className="log-source-default-btn"
                    title={preset}
                    aria-label={`Default path: ${preset}`}
                    onClick={applyPreset}
                  >
                    <svg className="log-source-default-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z"
                      />
                    </svg>
                    <span>Default</span>
                  </button>
                ) : null}
              </div>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Format</span>
              <DropdownSelect
                className="settings-field-input"
                value={editor.formatId}
                onChange={(v) => setEditor((prev) => ({ ...prev, formatId: v }))}
                options={formats.map((f) => ({ value: f.id, label: f.name }))}
                aria-label="Log format"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Display name (optional)</span>
              <input
                className="settings-field-input"
                value={editor.displayName}
                onChange={(e) => setEditor((prev) => ({ ...prev, displayName: e.target.value }))}
              />
            </label>
          </div>
          <div className="log-source-modal-col log-source-modal-col--browse">
            {!transportReady && !transportError ? (
              <div className="muted">Connecting…</div>
            ) : transportError ? (
              <div className="error-text">{transportError}</div>
            ) : testBusy ? (
              <div className="muted">Reading file…</div>
            ) : testMode && testPreview ? (
              <div className="log-source-test-panel">
                {testPreview.compileError ? <div className="error-text">{testPreview.compileError}</div> : null}
                <div className="log-source-test-table-wrap">
                  <table className="log-source-test-table">
                    <thead>
                      <tr>
                        <th>Match</th>
                        <th>Route</th>
                        <th>Level</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(testPreview.records ?? []).slice(0, 40).map((rec, i) => (
                        <tr key={i}>
                          <td>{rec.matched ? "Yes" : "No"}</td>
                          <td className="mono">{rec.route}</td>
                          <td>{rec.level}</td>
                          <td className="log-source-test-msg">{rec.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted log-source-test-hint">
                  Showing up to 40 parsed records from the last {Math.round(TAIL_MAX_BYTES / 1024)} KiB of the file.
                </p>
              </div>
            ) : (
              <div className="log-source-browse-stack">
                <div className="log-source-browse-head mono muted">{listSpec.listDir}</div>
                {browseBusy ? <div className="muted">Loading…</div> : null}
                {browseMsg ? <div className="muted">{browseMsg}</div> : null}
                <ul className="log-source-browse-list">
                  {browseRows.map((row) => (
                    <li key={`${row.path}-${row.name}`}>
                      <button
                        type="button"
                        className="log-source-browse-item"
                        onDoubleClick={() => onDblClickRow(row)}
                      >
                        <span className="log-source-browse-name">{row.name}</span>
                        {row.isDir ? <span className="muted"> /</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {testError ? <div className="error-text log-source-test-err">{testError}</div> : null}
          </div>
        </div>
        <div className="modal-actions log-source-modal-actions">
          <button
            className="btn btn-ghost log-source-btn-test"
            type="button"
            disabled={testBusy}
            onClick={() => void runTest()}
          >
            {testMode ? "Browse" : testBusy ? "Testing…" : "Test"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={() => void onSave()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
