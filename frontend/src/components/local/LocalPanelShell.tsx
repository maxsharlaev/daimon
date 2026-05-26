import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { LocalShellSend } from "../../../wailsjs/go/main/App";
import type { LocalOutputEvent, LocalStateEvent } from "../../types/local";
import { onLocalOutput, onLocalState, startLocalEventBridge } from "../../local/events";
import {
  ptyColsForTerminal,
  ptyRowsForTerminal,
  requestPromptIfEmpty,
  resizeLocalShell,
  syncLocalShellGeometry,
} from "../../local/shellAttach";
import { writeLocalOutput } from "../../local/terminalBytes";
import { localTerminalOptions } from "../../local/terminalOptions";

type Props = {
  shellId: string | null | undefined;
  syncCwd?: string;
  isWindows?: boolean;
  onStartShell?: (cols: number, rows: number) => void | Promise<string | null>;
  onDisconnected?: () => void;
};

export function LocalPanelShell({ shellId, syncCwd, isWindows, onStartShell, onDisconnected }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const shellIdRef = useRef(shellId ?? null);
  const syncCwdRef = useRef(syncCwd);
  const lastPtySizeRef = useRef({ cols: 0, rows: 0 });
  const startRequestedRef = useRef(false);
  const syncedShellRef = useRef<string | null>(null);
  const suppressOutputRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());
  syncCwdRef.current = syncCwd;

  useEffect(() => {
    shellIdRef.current = shellId ?? null;
    if (!shellId) {
      startRequestedRef.current = false;
      syncedShellRef.current = null;
    }
  }, [shellId]);

  useEffect(() => {
    startLocalEventBridge();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new Terminal({
      ...localTerminalOptions,
      fontSize: 14,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(el);

    const doFit = () => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
      if (term.cols < 1 || term.rows < 1) return;

      const ptyCols = ptyColsForTerminal(term, isWindows);
      const ptyRows = ptyRowsForTerminal(term);
      const id = shellIdRef.current;

      if (id) {
        if (ptyCols !== lastPtySizeRef.current.cols || ptyRows !== lastPtySizeRef.current.rows) {
          lastPtySizeRef.current = { cols: ptyCols, rows: ptyRows };
          void resizeLocalShell(id, term, isWindows);
        }
        return;
      }

      if (onStartShell && !startRequestedRef.current) {
        startRequestedRef.current = true;
        lastPtySizeRef.current = { cols: ptyCols, rows: ptyRows };
        void onStartShell(ptyCols, ptyRows);
      }
    };
    setTimeout(doFit, 0);
    requestAnimationFrame(() => doFit());
    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);

    const disposeData = term.onData((data) => {
      const id = shellIdRef.current;
      if (!id) return;
      void LocalShellSend(id, data);
    });

    return () => {
      disposeData.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      lastPtySizeRef.current = { cols: 0, rows: 0 };
      decoderRef.current.decode();
    };
  }, [isWindows, onStartShell]);

  useEffect(() => {
    const term = termRef.current;
    const id = shellId ?? null;
    if (!term || !id) return;
    if (syncedShellRef.current === id) return;
    syncedShellRef.current = id;

    void (async () => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
      lastPtySizeRef.current = {
        cols: ptyColsForTerminal(term, isWindows),
        rows: ptyRowsForTerminal(term),
      };

      suppressOutputRef.current = true;
      decoderRef.current = new TextDecoder();
      try {
        await syncLocalShellGeometry(term, decoderRef.current, id, {
          syncCwd: syncCwdRef.current,
          isWindows,
        });
      } finally {
        suppressOutputRef.current = false;
      }
      void requestPromptIfEmpty(term, id, isWindows);
    })();
  }, [shellId, syncCwd, isWindows]);

  useEffect(() => {
    const unsubOut = onLocalOutput((ev: LocalOutputEvent) => {
      if (suppressOutputRef.current) return;
      if (ev.id !== shellIdRef.current) return;
      const term = termRef.current;
      if (term) {
        writeLocalOutput(term, decoderRef.current, ev);
      }
    });
    const unsubState = onLocalState((ev: LocalStateEvent) => {
      if (ev.id !== shellIdRef.current) return;
      if (ev.state === "disconnected") {
        syncedShellRef.current = null;
        startRequestedRef.current = false;
        onDisconnected?.();
      }
    });
    return () => {
      unsubOut();
      unsubState();
    };
  }, [onDisconnected]);

  return (
    <div className="local-panel-shell-wrap">
      <div ref={containerRef} className="local-panel-shell" />
    </div>
  );
}
