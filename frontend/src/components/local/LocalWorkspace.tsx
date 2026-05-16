import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocalShellSend,
  LocalShellStart,
  LocalShellStop,
  LocalSystemInfo as fetchLocalSystemInfo,
} from "../../../wailsjs/go/main/App";
import { startLocalEventBridge } from "../../local/events";
import {
  defaultLocalLayout,
  defaultLocalPanel,
  type LocalLayoutFlags,
  type LocalPanelConfig,
  type LocalSystemInfo,
  type LocalWorkspacePersist,
} from "../../types/local";
import { LocalFilePane } from "./LocalFilePane";
import { LocalLayoutToolbar } from "./LocalLayoutToolbar";
import { LocalTerminal } from "./LocalTerminal";
import "./localworkspace.css";

type Props = {
  persist?: LocalWorkspacePersist | null;
  onPersist?: (next: LocalWorkspacePersist) => void;
};

function layoutMode(layout: LocalLayoutFlags): string {
  const { leftPanel, rightPanel, terminal } = layout;
  if (!terminal) return "panels-only";
  if (leftPanel && rightPanel) return "both-term";
  if ((leftPanel || rightPanel) && terminal) return "side-term";
  return "panels-only";
}

export function LocalWorkspace({ persist, onPersist }: Props) {
  const [system, setSystem] = useState<LocalSystemInfo | null>(null);
  const [layout, setLayout] = useState<LocalLayoutFlags>(() => persist?.layout ?? defaultLocalLayout());
  const [left, setLeft] = useState<LocalPanelConfig>(() => persist?.left ?? defaultLocalPanel());
  const [right, setRight] = useState<LocalPanelConfig>(() => persist?.right ?? defaultLocalPanel());
  const [activePane, setActivePane] = useState<"left" | "right">(persist?.activePane ?? "left");
  const [shellId, setShellId] = useState<string | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  const emitPersist = useCallback(
    (patch: Partial<LocalWorkspacePersist>) => {
      onPersist?.({
        layout,
        left,
        right,
        activePane,
        ...patch,
      });
    },
    [layout, left, right, activePane, onPersist]
  );

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
  }, [persist?.left?.path, persist?.right?.path]);

  useEffect(() => {
    if (persist?.layout) setLayout(persist.layout);
    if (persist?.left) setLeft(persist.left);
    if (persist?.right) setRight(persist.right);
    if (persist?.activePane) setActivePane(persist.activePane);
  }, [persist]);

  const terminalCwd = useMemo(() => {
    const cfg = activePane === "left" ? left : right;
    return cfg.path || system?.homeDir || "";
  }, [activePane, left, right, system?.homeDir]);

  const startShell = useCallback(async () => {
    if (!layout.terminal || startingRef.current) return;
    startingRef.current = true;
    try {
      if (shellIdRef.current) {
        await LocalShellStop(shellIdRef.current);
        shellIdRef.current = null;
        setShellId(null);
      }
      const id = await LocalShellStart(80, 24, terminalCwd);
      shellIdRef.current = id;
      setShellId(id);
    } catch {
      shellIdRef.current = null;
      setShellId(null);
    } finally {
      startingRef.current = false;
    }
  }, [layout.terminal, terminalCwd]);

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

  const setLayoutWrapped = (next: LocalLayoutFlags) => {
    setLayout(next);
    emitPersist({ layout: next });
  };

  const openTerminalHere = (path: string) => {
    const isWin = system?.os === "windows";
    const cmd = isWin ? `cd /d "${path.replace(/"/g, '""')}"\r\n` : `cd ${JSON.stringify(path)}\n`;
    if (shellIdRef.current) {
      void LocalShellSend(shellIdRef.current, cmd);
    }
  };

  const mode = layoutMode(layout);
  const singlePanel = layout.leftPanel !== layout.rightPanel;

  return (
    <div className="local-workspace">
      <LocalLayoutToolbar layout={layout} system={system} onChange={setLayoutWrapped} />
      <div className="local-body" data-layout={mode}>
        {(layout.leftPanel || layout.rightPanel) && (
          <div className="local-panels-row" data-single={singlePanel ? "true" : "false"}>
            {layout.leftPanel ? (
              <div className="local-pane-wrap">
                <LocalFilePane
                  side="left"
                  title="Left"
                  config={left}
                  active={activePane === "left"}
                  system={system}
                  onConfigChange={(next) => {
                    setLeft(next);
                    emitPersist({ left: next });
                  }}
                  onActivate={() => {
                    setActivePane("left");
                    emitPersist({ activePane: "left" });
                  }}
                  onOpenTerminalHere={layout.terminal ? openTerminalHere : undefined}
                />
              </div>
            ) : null}
            {layout.rightPanel ? (
              <div className="local-pane-wrap">
                <LocalFilePane
                  side="right"
                  title="Right"
                  config={right}
                  active={activePane === "right"}
                  system={system}
                  onConfigChange={(next) => {
                    setRight(next);
                    emitPersist({ right: next });
                  }}
                  onActivate={() => {
                    setActivePane("right");
                    emitPersist({ activePane: "right" });
                  }}
                  onOpenTerminalHere={layout.terminal ? openTerminalHere : undefined}
                />
              </div>
            ) : null}
          </div>
        )}
        {layout.terminal ? (
          <div className="local-terminal-wrap">
            <div className="local-terminal-header">
              Local shell
              {system?.defaultShell ? ` · ${system.defaultShell}` : ""}
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
        ) : null}
      </div>
    </div>
  );
}
