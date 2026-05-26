import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  LocalShellCwd,
  LocalShellSend,
  LocalShellStart,
  LocalShellStopAll,
  LocalShellStop,
  LocalSystemInfo as fetchLocalSystemInfo,
} from "../../../wailsjs/go/main/App";
import { SplitView } from "../SplitView";
import { onLocalCwd, startLocalEventBridge } from "../../local/events";
import {
  defaultLocalLayout,
  defaultLocalPanel,
  defaultLocalSplit,
  sidePanelsPctFromSplit,
  type LocalLayoutFlags,
  type LocalPanelConfig,
  type LocalSystemInfo,
  type LocalWorkspacePersist,
  type LocalWorkspaceSplit,
} from "../../types/local";
import { LocalFilePane } from "./LocalFilePane";
import { LocalLayoutToolbar } from "./LocalLayoutToolbar";
import { LocalTerminal } from "./LocalTerminal";
import "./localworkspace.css";

type Props = {
  persist?: LocalWorkspacePersist | null;
  onPersist?: (next: LocalWorkspacePersist) => void;
};

const paneStub = <div className="local-pane-stub" aria-hidden />;

function dropShellId(panel: LocalPanelConfig): LocalPanelConfig {
  if (!panel.shellId) return panel;
  return { ...panel, shellId: undefined };
}

export function LocalWorkspace({ persist, onPersist }: Props) {
  const [system, setSystem] = useState<LocalSystemInfo | null>(null);
  const [layout, setLayout] = useState<LocalLayoutFlags>(() => persist?.layout ?? defaultLocalLayout());
  const [left, setLeft] = useState<LocalPanelConfig>(() => persist?.left ?? defaultLocalPanel());
  const [right, setRight] = useState<LocalPanelConfig>(() => persist?.right ?? defaultLocalPanel());
  const [activePane, setActivePane] = useState<"left" | "right">(persist?.activePane ?? "left");
  const [split, setSplit] = useState<LocalWorkspaceSplit>(() => ({
    ...defaultLocalSplit(),
    ...persist?.split,
  }));
  const [shellId, setShellId] = useState<string | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const [mainCwd, setMainCwd] = useState("");
  const shellIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pendingMainCdRef = useRef<string | null>(null);
  const hydratedFromPersistRef = useRef(false);

  const layoutRef = useRef(layout);
  const leftRef = useRef(left);
  const rightRef = useRef(right);
  const activePaneRef = useRef(activePane);
  const splitRef = useRef(split);
  layoutRef.current = layout;
  leftRef.current = left;
  rightRef.current = right;
  activePaneRef.current = activePane;
  splitRef.current = split;

  const emitPersist = useCallback(
    (patch: Partial<LocalWorkspacePersist>) => {
      onPersist?.({
        layout: layoutRef.current,
        left: leftRef.current,
        right: rightRef.current,
        activePane: activePaneRef.current,
        split: splitRef.current,
        ...patch,
      });
    },
    [onPersist]
  );

  const patchSplit = useCallback(
    (patch: Partial<LocalWorkspaceSplit>) => {
      setSplit((prev) => {
        const next = { ...prev, ...patch };
        splitRef.current = next;
        emitPersist({ split: next });
        return next;
      });
    },
    [emitPersist]
  );

  // Hydrate from persisted snapshot once (avoid resetting layout on every path/split save).
  useEffect(() => {
    if (hydratedFromPersistRef.current || !persist) return;
    hydratedFromPersistRef.current = true;
    if (persist.layout) {
      layoutRef.current = persist.layout;
      setLayout(persist.layout);
    }
    if (persist.left) setLeft(dropShellId(persist.left));
    if (persist.right) setRight(dropShellId(persist.right));
    if (persist.activePane) setActivePane(persist.activePane);
    if (persist.split) setSplit((prev) => ({ ...prev, ...persist.split }));
  }, [persist]);

  useEffect(() => {
    startLocalEventBridge();
    void LocalShellStopAll().catch(() => {});
    void fetchLocalSystemInfo()
      .then((info) => {
        const s = info as LocalSystemInfo;
        setSystem(s);
        if (!persist?.left?.path) {
          setLeft((p) => ({ ...p, path: s.homeDir, volume: s.homeDir }));
        }
        if (!persist?.right?.path) {
          setRight((p) => ({ ...p, path: s.homeDir, volume: s.homeDir }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mainStartCwd = system?.homeDir || "";

  const cdMainShell = useCallback(
    async (targetPath: string) => {
      const id = shellIdRef.current;
      if (!id) return;
      const isWin = system?.os === "windows";
      const cmd = isWin
        ? `cd /d "${targetPath.replace(/"/g, '""')}"\r\n`
        : `cd ${JSON.stringify(targetPath)}\n`;
      await LocalShellSend(id, cmd);
    },
    [system?.os]
  );

  const openMainTerminalHere = useCallback(
    (targetPath: string) => {
      if (!layoutRef.current.terminal) {
        pendingMainCdRef.current = targetPath;
        setLayoutWrapped({ ...layoutRef.current, terminal: true });
        return;
      }
      if (!shellIdRef.current || startingRef.current) {
        pendingMainCdRef.current = targetPath;
        return;
      }
      void cdMainShell(targetPath);
    },
    [cdMainShell]
  );

  const startShell = useCallback(async (cols: number, rows: number) => {
    if (!layout.terminal || startingRef.current) return;
    if (cols < 1 || rows < 1) return;
    if (!mainStartCwd) return;
    startingRef.current = true;
    setShellError(null);
    try {
      if (shellIdRef.current) {
        await LocalShellStop(shellIdRef.current);
        shellIdRef.current = null;
        setShellId(null);
      }
      const id = await LocalShellStart(cols, rows, mainStartCwd);
      shellIdRef.current = id;
      setShellId(id);
      try {
        setMainCwd(await LocalShellCwd(id));
      } catch {
        setMainCwd(mainStartCwd);
      }
      const pending = pendingMainCdRef.current;
      if (pending) {
        pendingMainCdRef.current = null;
        await cdMainShell(pending);
        try {
          setMainCwd(await LocalShellCwd(id));
        } catch {
          // ignore
        }
      }
    } catch (e: unknown) {
      shellIdRef.current = null;
      setShellId(null);
      setShellError(e instanceof Error ? e.message : String(e));
    } finally {
      startingRef.current = false;
    }
  }, [layout.terminal, mainStartCwd, cdMainShell]);

  useEffect(() => {
    if (!layout.terminal) {
      if (shellIdRef.current) {
        void LocalShellStop(shellIdRef.current);
        shellIdRef.current = null;
        setShellId(null);
      }
      return;
    }
    return () => {
      if (shellIdRef.current) {
        void LocalShellStop(shellIdRef.current);
        shellIdRef.current = null;
      }
    };
  }, [layout.terminal]);

  useEffect(() => {
    return onLocalCwd((ev) => {
      if (ev.id === shellIdRef.current) setMainCwd(ev.path);
    });
  }, []);

  const setLayoutWrapped = (next: LocalLayoutFlags) => {
    layoutRef.current = next;
    setLayout(next);
    emitPersist({ layout: next });
  };

  const terminalOnLeft = !layout.leftPanel && layout.rightPanel && layout.terminal;

  const onOuterDividerPointerDown = useCallback(
    (mode: "vertical" | "horizontal") => (e: ReactPointerEvent<HTMLDivElement>) => {
      const container = e.currentTarget.parentElement;
      if (!container) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const update = (ev: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        if (mode === "vertical") {
          const pct = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * 100;
          patchSplit({ verticalPct: Math.max(12, Math.min(88, pct)) });
          return;
        }
        const firstPct = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 100;
        const panelsPct = terminalOnLeft ? 100 - firstPct : firstPct;
        patchSplit({ sidePanelsPct: Math.max(12, Math.min(88, panelsPct)) });
      };
      const stop = () => {
        window.removeEventListener("pointermove", update);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", update);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [patchSplit, terminalOnLeft]
  );

  const terminalBlock = layout.terminal ? (
    <div className="local-terminal-wrap">
      <div className="local-terminal-header" title={mainCwd}>
        Local shell
        {system?.defaultShell ? ` · ${system.defaultShell}` : ""}
        {mainCwd ? ` · ${mainCwd}` : ""}
        {shellError ? ` · ${shellError}` : ""}
      </div>
      <LocalTerminal
        shellId={shellId}
        shellIdRef={shellIdRef}
        wantShell={layout.terminal && Boolean(mainStartCwd)}
        isWindows={system?.os === "windows"}
        onStartShell={startShell}
        onDisconnected={() => {
          shellIdRef.current = null;
          setShellId(null);
        }}
      />
    </div>
  ) : null;

  const leftPane = useMemo(
    () =>
      layout.leftPanel ? (
        <div className="local-pane-wrap">
          <LocalFilePane
            side="left"
            title="Left"
            config={left}
            active={activePane === "left"}
            system={system}
            onConfigChange={(next) => {
              setLeft(next);
              leftRef.current = next;
              emitPersist({ left: next });
            }}
            onActivate={() => {
              setActivePane("left");
              activePaneRef.current = "left";
              emitPersist({ activePane: "left" });
            }}
            onOpenMainTerminal={openMainTerminalHere}
          />
        </div>
      ) : null,
    [layout.leftPanel, left, activePane, system, emitPersist, openMainTerminalHere]
  );

  const rightPane = useMemo(
    () =>
      layout.rightPanel ? (
        <div className="local-pane-wrap">
          <LocalFilePane
            side="right"
            title="Right"
            config={right}
            active={activePane === "right"}
            system={system}
            onConfigChange={(next) => {
              setRight(next);
              rightRef.current = next;
              emitPersist({ right: next });
            }}
            onActivate={() => {
              setActivePane("right");
              activePaneRef.current = "right";
              emitPersist({ activePane: "right" });
            }}
            onOpenMainTerminal={openMainTerminalHere}
          />
        </div>
      ) : null,
    [layout.rightPanel, right, activePane, system, emitPersist, openMainTerminalHere]
  );

  /** Dual split stays mounted (stub panes) so panelsPct survives toggling a panel off/on. */
  const panelsDualSplit = useMemo(
    () => (
      <SplitView
        key="local-split-panels"
        left={leftPane ?? paneStub}
        right={rightPane ?? paneStub}
        pct={split.panelsPct ?? 50}
        minLeftPx={200}
        minRightPx={200}
        onPctChange={(pct) => patchSplit({ panelsPct: pct })}
      />
    ),
    [leftPane, rightPane, split.panelsPct, patchSplit]
  );

  const panelsRow = useMemo(() => {
    if (!layout.leftPanel && !layout.rightPanel) return null;
    if (layout.leftPanel && layout.rightPanel) return panelsDualSplit;
    return <div className="local-single-pane">{leftPane ?? rightPane}</div>;
  }, [layout.leftPanel, layout.rightPanel, leftPane, rightPane, panelsDualSplit]);

  const hasPanels = layout.leftPanel || layout.rightPanel;
  const dualPanels = layout.leftPanel && layout.rightPanel;
  const showTerminalOnly = layout.terminal && !hasPanels;
  const showPanelsOnly = hasPanels && !layout.terminal;
  const showOuterVertical = hasPanels && layout.terminal && dualPanels;
  const showOuterHorizontal = hasPanels && layout.terminal && !dualPanels;
  const sidePanelsPct = sidePanelsPctFromSplit(split, terminalOnLeft);

  const body = useMemo((): ReactNode => {
    if (showTerminalOnly) {
      return <div className="local-body-fill">{terminalBlock}</div>;
    }
    if (showPanelsOnly) {
      return <div className="local-body-fill">{panelsRow}</div>;
    }
    if (!layout.terminal || !hasPanels) return null;

    if (showOuterVertical || showOuterHorizontal) {
      const vertical = showOuterVertical;
      const panelsPct = vertical ? split.verticalPct ?? 62 : sidePanelsPct;
      const terminalPct = 100 - panelsPct;
      return (
        <div
          className={`local-composite ${vertical ? "local-composite-vertical" : "local-composite-horizontal"}${
            !vertical && terminalOnLeft ? " terminal-first" : ""
          }`}
        >
          <div className="local-composite-panels" style={{ flexBasis: `${panelsPct}%` }}>
            {vertical ? panelsDualSplit : panelsRow}
          </div>
          <div
            className="local-composite-divider"
            onPointerDown={onOuterDividerPointerDown(vertical ? "vertical" : "horizontal")}
          />
          <div className="local-composite-terminal" style={{ flexBasis: `${terminalPct}%` }}>
            {terminalBlock}
          </div>
        </div>
      );
    }

    return null;
  }, [
    showTerminalOnly,
    showPanelsOnly,
    layout.terminal,
    hasPanels,
    dualPanels,
    showOuterVertical,
    showOuterHorizontal,
    terminalBlock,
    panelsRow,
    panelsDualSplit,
    split.verticalPct,
    sidePanelsPct,
    terminalOnLeft,
    onOuterDividerPointerDown,
  ]);

  return (
    <div className="local-workspace">
      <LocalLayoutToolbar layout={layout} system={system} onChange={setLayoutWrapped} />
      <div className="local-body">{body}</div>
    </div>
  );
}
