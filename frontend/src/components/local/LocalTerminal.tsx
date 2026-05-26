import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
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
  shellId: string | null;
  shellIdRef?: MutableRefObject<string | null>;
  wantShell?: boolean;
  isWindows?: boolean;
  onStartShell?: (cols: number, rows: number) => void | Promise<void>;
  onDisconnected?: (id: string, error?: string | null) => void;
};

export function LocalTerminal({
  shellId,
  shellIdRef: externalShellIdRef,
  wantShell = false,
  isWindows,
  onStartShell,
  onDisconnected,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const lastPtySizeRef = useRef({ cols: 0, rows: 0 });
  const startRequestedRef = useRef(false);
  const syncedShellRef = useRef<string | null>(null);
  const suppressOutputRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());
  const [lastError, setLastError] = useState<string | null>(null);

  const internalShellIdRef = useRef<string | null>(shellId);
  useEffect(() => {
    internalShellIdRef.current = shellId;
  }, [shellId]);

  const shellIdRef = externalShellIdRef ?? internalShellIdRef;

  useEffect(() => {
    if (!shellId) {
      startRequestedRef.current = false;
      syncedShellRef.current = null;
    }
  }, [shellId]);

  useEffect(() => {
    if (!wantShell) {
      startRequestedRef.current = false;
    }
  }, [wantShell]);

  useEffect(() => {
    startLocalEventBridge();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      const term = new Terminal({
        ...localTerminalOptions,
        fontSize: 15,
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

        if (wantShell && onStartShell && !startRequestedRef.current) {
          startRequestedRef.current = true;
          lastPtySizeRef.current = { cols: ptyCols, rows: ptyRows };
          void onStartShell(ptyCols, ptyRows);
        }
      };

      setTimeout(doFit, 0);
      requestAnimationFrame(() => doFit());

      if (typeof ResizeObserver !== "undefined") {
        roRef.current = new ResizeObserver(() => doFit());
        roRef.current.observe(el);
      } else {
        const onResize = () => doFit();
        window.addEventListener("resize", onResize);
        roRef.current = {
          disconnect: () => window.removeEventListener("resize", onResize),
          observe: () => {},
          unobserve: () => {},
        } as ResizeObserver;
      }

      const disposeData = term.onData((data) => {
        const id = shellIdRef.current;
        if (!id) return;
        void LocalShellSend(id, data);
      });

      return () => {
        disposeData.dispose();
        roRef.current?.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
        lastPtySizeRef.current = { cols: 0, rows: 0 };
        decoderRef.current.decode();
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(`Terminal init failed: ${msg}`);
    }
  }, [shellIdRef, wantShell, onStartShell, isWindows]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !shellId) return;
    if (syncedShellRef.current === shellId) return;
    syncedShellRef.current = shellId;

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
        await syncLocalShellGeometry(term, decoderRef.current, shellId, { isWindows });
      } finally {
        suppressOutputRef.current = false;
      }
      void requestPromptIfEmpty(term, shellId, isWindows);
    })();
  }, [shellId, isWindows]);

  useEffect(() => {
    const unsubOut = onLocalOutput((ev: LocalOutputEvent) => {
      if (suppressOutputRef.current) return;
      const id = shellIdRef.current;
      if (!id || ev.id !== id) return;
      const term = termRef.current;
      if (term) {
        writeLocalOutput(term, decoderRef.current, ev);
      }
    });
    const unsubState = onLocalState((ev: LocalStateEvent) => {
      const id = shellIdRef.current;
      if (!id || ev.id !== id) return;
      if (ev.state === "disconnected") {
        syncedShellRef.current = null;
        startRequestedRef.current = false;
        onDisconnected?.(id, ev.error ?? null);
      }
    });
    return () => {
      unsubOut();
      unsubState();
    };
  }, [onDisconnected, shellIdRef]);

  if (lastError) {
    return <div className="error">{lastError}</div>;
  }
  return (
    <div className="local-terminal-shell">
      <div ref={containerRef} className="local-terminal" />
    </div>
  );
}
