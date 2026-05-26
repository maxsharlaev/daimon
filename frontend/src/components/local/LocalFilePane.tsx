import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocalDelete,
  LocalHomeDir,
  LocalListDir,
  LocalListVolumes,
  LocalMkdir,
  LocalRename,
  LocalShellCwd,
  LocalShellSend,
  LocalShellStart,
  PickLocalFolder,
} from "../../../wailsjs/go/main/App";
import type { LocalPanelConfig, LocalPanelKind, LocalSystemInfo } from "../../types/local";
import { PANEL_KIND_OPTIONS } from "../../types/local";
import { onLocalCwd, startLocalEventBridge } from "../../local/events";
import { LocalPanelShell } from "./LocalPanelShell";
import {
  breadcrumbsLocal,
  crumbSeparatorAfter,
  displayEntries,
  fmtDate,
  fmtSize,
  parentLocal,
  type LocalFileEntry,
  volumeForPath,
} from "../../utils/localFiles";
import { DropdownSelect } from "../ui";

type Props = {
  side: "left" | "right";
  title: string;
  config: LocalPanelConfig;
  active: boolean;
  system: LocalSystemInfo | null;
  onConfigChange: (next: LocalPanelConfig) => void;
  onActivate: () => void;
  /** cd in the workspace main terminal; enables it if hidden */
  onOpenMainTerminal?: (path: string) => void;
};

export function LocalFilePane({
  side,
  title,
  config,
  active,
  system,
  onConfigChange,
  onActivate,
  onOpenMainTerminal,
}: Props) {
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [volumes, setVolumes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const pathRef = useRef(config.path);
  pathRef.current = config.path;
  const listGenRef = useRef(0);

  const path = config.path;
  const display = useMemo(() => displayEntries(path, entries), [path, entries]);
  const crumbs = useMemo(() => breadcrumbsLocal(path), [path]);
  const currentVolume = useMemo(
    () => volumeForPath(path, volumes) ?? config.volume ?? volumes[0] ?? "",
    [path, volumes, config.volume]
  );
  const volumeOptions = useMemo(
    () => volumes.map((v) => ({ value: v, label: v.replace(/\\$/, "") })),
    [volumes]
  );

  const refresh = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    const gen = ++listGenRef.current;
    setBusy(true);
    setError(null);
    try {
      const rows = (await LocalListDir(p)) as LocalFileEntry[];
      if (gen !== listGenRef.current || pathRef.current !== p) return;
      setEntries(rows);
    } catch (e: unknown) {
      if (gen !== listGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === listGenRef.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const vols = (await LocalListVolumes()) as string[];
        setVolumes(vols);
        if (!config.path) {
          const home = system?.homeDir || (await LocalHomeDir());
          onConfigChange({ ...config, path: home, volume: vols[0] ?? home });
        }
      } catch {
        setVolumes(["/"]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (config.kind !== "files" || !path) return;
    void refresh();
  }, [path, refresh, config.kind]);

  useEffect(() => {
    startLocalEventBridge();
    return onLocalCwd((ev) => {
      if (ev.id !== config.shellId) return;
      const vol = volumeForPath(ev.path, volumes) ?? config.volume;
      onConfigChange({ ...config, path: ev.path, volume: vol });
    });
  }, [config, volumes, onConfigChange]);

  const sendCdToShell = async (shellId: string, dir: string) => {
    const isWin = system?.os === "windows";
    const cmd = isWin ? `cd /d "${dir.replace(/"/g, '""')}"\r\n` : `cd ${JSON.stringify(dir)}\n`;
    await LocalShellSend(shellId, cmd);
  };

  const startPanelShell = async (cols: number, rows: number): Promise<string | null> => {
    if (cols < 1 || rows < 1) return null;
    if (config.shellId) {
      try {
        await LocalShellCwd(config.shellId);
        return config.shellId;
      } catch {
        // stale id — start a new shell below
      }
    }
    try {
      const id = await LocalShellStart(cols, rows, path || system?.homeDir || ".");
      onConfigChange({ ...config, kind: "terminal", shellId: id });
      return id;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const enterTerminalMode = () => {
    setError(null);
    onConfigChange({ ...config, kind: "terminal", shellId: undefined });
  };

  const onTerminalIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onActivate();
    const dir = path || system?.homeDir || ".";
    if (e.altKey) {
      void enterTerminalMode();
      return;
    }
    onOpenMainTerminal?.(dir);
  };

  const enterFilesMode = async () => {
    let nextPath = path;
    if (config.shellId) {
      try {
        nextPath = await LocalShellCwd(config.shellId);
      } catch {
        // keep path
      }
    }
    const vol = volumeForPath(nextPath, volumes) ?? config.volume;
    onConfigChange({ ...config, kind: "files", path: nextPath, volume: vol });
  };

  const setPanelKind = (kind: LocalPanelKind) => {
    if (kind === config.kind) return;
    if (kind === "terminal") void enterTerminalMode();
    else void enterFilesMode();
  };

  const goTo = (nextPath: string) => {
    const vol = volumeForPath(nextPath, volumes) ?? config.volume;
    onConfigChange({ ...config, path: nextPath, volume: vol });
    setSelection(null);
    if (config.kind === "terminal" && config.shellId) {
      void sendCdToShell(config.shellId, nextPath);
    }
  };

  const pickFolder = async () => {
    try {
      const picked = await PickLocalFolder();
      if (picked) goTo(picked);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const mkdir = async () => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
      const base = path.replace(/[\\/]+$/, "");
      const target = `${base}${sep}${name.trim()}`;
      await LocalMkdir(target);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!selection) return;
    const ent = display.find((e) => e.path === selection);
    if (!ent || ent.name === "..") return;
    if (!window.confirm(`Delete ${ent.name}?`)) return;
    setBusy(true);
    try {
      await LocalDelete(selection);
      setSelection(null);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startRename = () => {
    if (!selection) return;
    const ent = display.find((e) => e.path === selection);
    if (!ent || ent.name === "..") return;
    setRenameValue(ent.name);
    setRenameOpen(true);
  };

  const applyRename = async () => {
    if (!selection || !renameValue.trim()) {
      setRenameOpen(false);
      return;
    }
    const ent = display.find((e) => e.path === selection);
    if (!ent) return;
    const parent = parentLocal(ent.path);
    const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
    const base = parent.replace(/[\\/]+$/, "");
    const target = `${base}${sep}${renameValue.trim()}`;
    setBusy(true);
    try {
      await LocalRename(ent.path, target);
      setRenameOpen(false);
      setSelection(null);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const volLabel = system?.volumeLabel ?? "Location";

  return (
    <div className={`local-file-pane ${active ? "active" : ""}`} onMouseDown={onActivate} data-side={side}>
      <div className="pathbar">
        <span className="pathlabel-btn">{title}</span>
        {config.kind === "files" && volumeOptions.length > 0 ? (
          <DropdownSelect
            className="drive-select"
            inline
            value={currentVolume}
            onChange={(v) => v && goTo(v)}
            options={volumeOptions}
            aria-label={`${volLabel} (${side})`}
          />
        ) : null}
        <DropdownSelect
          className="drive-select"
          inline
          value={config.kind}
          onChange={(v) => {
            if (v === "files" || v === "terminal") setPanelKind(v);
          }}
          options={PANEL_KIND_OPTIONS}
          aria-label="Panel type"
        />
        <div className="crumbs" title={path}>
          {crumbs.map((c, idx) => (
            <span key={c.path} className="crumbwrap">
              <button className="crumb" type="button" onClick={() => goTo(c.path)}>
                {c.label}
              </button>
              {(() => {
                const sep = crumbSeparatorAfter(idx, c, crumbs.length);
                return sep ? <span className="crumbsep">{sep}</span> : null;
              })()}
            </span>
          ))}
        </div>
        {config.kind === "files" ? (
          <button
            className="iconbtn"
            type="button"
            title="Open in main terminal (⌥ — panel terminal)"
            onClick={onTerminalIconClick}
          >
            ⌘
          </button>
        ) : null}
      </div>
      {config.kind === "files" ? (
        <div className="pane-toolbar">
          <button className="btn btn-ghost" type="button" onClick={() => void pickFolder()} disabled={busy}>
            Browse…
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void mkdir()} disabled={busy}>
            Mkdir
          </button>
          <button className="btn btn-ghost" type="button" onClick={startRename} disabled={busy || !selection}>
            Rename
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void del()} disabled={busy || !selection}>
            Delete
          </button>
        </div>
      ) : null}
      {error ? <div className="local-pane-error">{error}</div> : null}
      {config.kind === "terminal" ? (
        <LocalPanelShell
          shellId={config.shellId}
          syncCwd={path || system?.homeDir || "."}
          isWindows={system?.os === "windows"}
          onStartShell={startPanelShell}
          onDisconnected={() => {
            onConfigChange({ ...config, shellId: undefined });
            void enterFilesMode();
          }}
        />
      ) : config.kind === "files" ? (
        <div className="list">
          {display.map((e) => (
            <div
              key={e.path}
              className={`row ${selection === e.path ? "selected" : ""}`}
              onClick={() => {
                onActivate();
                setSelection(e.path);
              }}
              onDoubleClick={() => {
                if (e.isDir) goTo(e.path);
              }}
            >
              <span className={`name ${e.isDir ? "dir" : ""}`}>
                {e.isDir ? "📁 " : ""}
                {e.name}
              </span>
              <span className="meta">
                {e.name === ".."
                  ? ""
                  : `${e.isDir ? "" : fmtSize(e.size)}${e.mtimeMs ? `${e.isDir ? "" : " • "}${fmtDate(e.mtimeMs)}` : ""}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {renameOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Rename</div>
            <div className="modal-body form">
              <input value={renameValue} onChange={(ev) => setRenameValue(ev.target.value)} autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setRenameOpen(false)}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void applyRename()}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
