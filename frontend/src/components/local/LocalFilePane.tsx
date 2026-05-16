import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocalDelete,
  LocalHomeDir,
  LocalListDir,
  LocalListVolumes,
  LocalMkdir,
  LocalRename,
  PickLocalFolder,
} from "../../../wailsjs/go/main/App";
import type { LocalPanelConfig, LocalSystemInfo } from "../../types/local";
import {
  breadcrumbsLocal,
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
  onOpenTerminalHere?: (path: string) => void;
};

export function LocalFilePane({
  side,
  title,
  config,
  active,
  system,
  onConfigChange,
  onActivate,
  onOpenTerminalHere,
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
    if (!path) return;
    void refresh();
  }, [path, refresh]);

  const goTo = (nextPath: string) => {
    const vol = volumeForPath(nextPath, volumes) ?? config.volume;
    onConfigChange({ ...config, path: nextPath, volume: vol });
    setSelection(null);
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
        {volumeOptions.length > 0 ? (
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
          value="files"
          onChange={() => {}}
          options={[{ value: "files", label: "Files" }]}
          aria-label="Panel type"
        />
        <div className="crumbs" title={path}>
          {crumbs.map((c, idx) => (
            <span key={c.path} className="crumbwrap">
              <button className="crumb" type="button" onClick={() => goTo(c.path)}>
                {c.label}
              </button>
              {idx < crumbs.length - 1 ? <span className="crumbsep">/</span> : null}
            </span>
          ))}
        </div>
        {onOpenTerminalHere ? (
          <button className="iconbtn" type="button" title="Open terminal here" onClick={() => onOpenTerminalHere(path)}>
            ⌘
          </button>
        ) : null}
      </div>
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
      {error ? <div className="local-pane-error">{error}</div> : null}
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
