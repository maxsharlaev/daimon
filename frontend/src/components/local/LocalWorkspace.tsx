import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LocalShellCwd,
  LocalShellSend,
  LocalShellStart,
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
    if (persist.left) setLeft(persist.left);
    if (persist.right) setRight(persist.right);
    if (persist.activePane) setActivePane(persist.activePane);
    if (persist.split) setSplit((prev) => ({ ...prev, ...persist.split }));
  }, [persist]);

  useEffect(() => {
    startLocalEventBridge();
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

  const mainStartCwd = system?.homeDir || ".";

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

  const startShell = useCallback(async () => {
    if (!layout.terminal || startingRef.current) return;
    startingRef.current = true;
    try {
      if (shellIdRef.current) {
        await LocalShellStop(shellIdRef.current);
        shellIdRef.current = null;
        setShellId(null);
      }
      const id = await LocalShellStart(80, 24, mainStartCwd);
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
    } catch {
      shellIdRef.current = null;
      setShellId(null);
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
    void startShell();
    return () => {
      if (shellIdRef.current) {
        void LocalShellStop(shellIdRef.current);
        shellIdRef.current = null;
      }
    };
  }, [layout.terminal, startShell]);

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

  const terminalBlock = layout.terminal ? (
    <div className="local-terminal-wrap">
      <div className="local-terminal-header" title={mainCwd}>
        Local shell
        {system?.defaultShell ? ` · ${system.defaultShell}` : ""}
        {mainCwd ? ` · ${mainCwd}` : ""}
      </div>
      <LocalTerminal
        shellId={shellId}
        shellIdRef={shellIdRef}
        onDisconnected={() => {
          shellIdRef.current = null;
          setShellId(null);
          void startShell();
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
  const horizontalFirstPct = terminalOnLeft ? 100 - sidePanelsPct : sidePanelsPct;

  const body = useMemo((): ReactNode => {
    if (showTerminalOnly) {
      return <div className="local-body-fill">{terminalBlock}</div>;
    }
    if (showPanelsOnly) {
      return <div className="local-body-fill">{panelsRow}</div>;
    }
    if (!layout.terminal || !hasPanels) return null;

    return (
      <div className="local-body-layers">
        <div className={`local-layer${showOuterVertical ? "" : " local-layer-hidden"}`}>
          <SplitView
            key="local-split-outer-v"
            orientation="vertical"
            left={panelsDualSplit}
            right={terminalBlock}
            pct={split.verticalPct ?? 62}
            minLeftPx={160}
            minRightPx={140}
            onPctChange={(pct) => patchSplit({ verticalPct: pct })}
          />
        </div>
        <div className={`local-layer${showOuterHorizontal ? "" : " local-layer-hidden"}`}>
          <SplitView
            key="local-split-outer-h"
            orientation="horizontal"
            left={terminalOnLeft ? terminalBlock : panelsRow}
            right={terminalOnLeft ? panelsRow : terminalBlock}
            pct={horizontalFirstPct}
            minLeftPx={200}
            minRightPx={160}
            onPctChange={(firstPct) => {
              const panelsPct = terminalOnLeft ? 100 - firstPct : firstPct;
              patchSplit({ sidePanelsPct: panelsPct });
            }}
          />
        </div>
      </div>
    );
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
    leftPane,
    rightPane,
    split.verticalPct,
    horizontalFirstPct,
    terminalOnLeft,
    patchSplit,
  ]);

  return (
    <div className="local-workspace">
      <LocalLayoutToolbar layout={layout} system={system} onChange={setLayoutWrapped} />
      <div className="local-body">{body}</div>
    </div>
  );
}
