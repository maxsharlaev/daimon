import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { LocalShellResize, LocalShellSend } from "../../../wailsjs/go/main/App";
import type { LocalOutputEvent, LocalStateEvent } from "../../types/local";
import { onLocalOutput, onLocalState, startLocalEventBridge } from "../../local/events";

type Props = {
  shellId: string | null;
  shellIdRef?: MutableRefObject<string | null>;
  onDisconnected?: (id: string, error?: string | null) => void;
};

export function LocalTerminal({ shellId, shellIdRef: externalShellIdRef, onDisconnected }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const internalShellIdRef = useRef<string | null>(shellId);
  useEffect(() => {
    internalShellIdRef.current = shellId;
  }, [shellId]);

  const shellIdRef = externalShellIdRef ?? internalShellIdRef;

  useEffect(() => {
    startLocalEventBridge();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 15,
        theme: {
          background: "#0b1220",
          foreground: "#c8d5e6",
          cursor: "#6ee7ff",
          selectionBackground: "rgba(110, 231, 255, 0.25)",
        },
        allowProposedApi: false,
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
        const id = shellIdRef.current;
        if (id) {
          void LocalShellResize(id, term.cols, term.rows);
        }
      };

      setTimeout(doFit, 0);

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
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(`Terminal init failed: ${msg}`);
    }
  }, [shellIdRef]);

  const prevShellIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!termRef.current) return;
    if (prevShellIdRef.current != null && prevShellIdRef.current !== shellId) {
      termRef.current.clear();
    }
    prevShellIdRef.current = shellId;
  }, [shellId]);

  useEffect(() => {
    const unsubOut = onLocalOutput((ev: LocalOutputEvent) => {
      const id = shellIdRef.current;
      if (!id || ev.id !== id) return;
      termRef.current?.write(ev.data ?? "");
    });
    const unsubState = onLocalState((ev: LocalStateEvent) => {
      const id = shellIdRef.current;
      if (!id || ev.id !== id) return;
      if (ev.state === "disconnected") {
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
  return <div ref={containerRef} className="local-terminal" />;
}
