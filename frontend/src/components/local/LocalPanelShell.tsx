import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { LocalShellResize, LocalShellSend } from "../../../wailsjs/go/main/App";
import type { LocalOutputEvent, LocalStateEvent } from "../../types/local";
import { onLocalOutput, onLocalState, startLocalEventBridge } from "../../local/events";

type Props = {
  shellId: string;
  onDisconnected?: () => void;
};

export function LocalPanelShell({ shellId, onDisconnected }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const shellIdRef = useRef(shellId);

  useEffect(() => {
    shellIdRef.current = shellId;
    termRef.current?.clear();
  }, [shellId]);

  useEffect(() => {
    startLocalEventBridge();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      theme: {
        background: "#0b1220",
        foreground: "#c8d5e6",
        cursor: "#6ee7ff",
        selectionBackground: "rgba(110, 231, 255, 0.25)",
      },
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
      if (id) void LocalShellResize(id, term.cols, term.rows);
    };
    setTimeout(doFit, 0);
    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);

    const disposeData = term.onData((data) => {
      const id = shellIdRef.current;
      if (id) void LocalShellSend(id, data);
    });

    return () => {
      disposeData.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unsubOut = onLocalOutput((ev: LocalOutputEvent) => {
      if (ev.id !== shellIdRef.current) return;
      termRef.current?.write(ev.data ?? "");
    });
    const unsubState = onLocalState((ev: LocalStateEvent) => {
      if (ev.id !== shellIdRef.current) return;
      if (ev.state === "disconnected") onDisconnected?.();
    });
    return () => {
      unsubOut();
      unsubState();
    };
  }, [onDisconnected]);

  return <div ref={containerRef} className="local-panel-shell" />;
}
