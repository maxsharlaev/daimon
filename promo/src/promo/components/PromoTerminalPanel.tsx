import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { onTerminalOutput, registerTerminalSession, TerminalMeta } from "../demo/terminal";

type Props = {
  sessionId: string | null;
  meta: TerminalMeta;
  onShowFiles?: () => void;
  onOpenPlaces?: () => void;
  onOpenMacros?: () => void;
};

export function PromoTerminalPanel({ sessionId, meta, onShowFiles, onOpenPlaces, onOpenMacros }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [status, setStatus] = useState<"idle" | "connected">("idle");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
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
        } as any;
      }

      return () => {
        roRef.current?.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setStatus("idle");
      return;
    }
    setStatus("connected");
    registerTerminalSession(sessionId, meta);
    const unsub = onTerminalOutput(sessionId, (data) => termRef.current?.write(data));
    return () => {
      unsub();
    };
  }, [sessionId, meta.host, meta.user]);

  return (
    <div className="panel panel-terminal">
      <div className="panel-titlebar">
        <div className="panel-title">Terminal</div>
        <div className="panel-meta">
          <span className={`badge badge-${status}`}>{status}</span>
        </div>
        <div className="panel-actions">
          {onShowFiles ? (
            <button className="btn btn-ghost" type="button" onClick={onShowFiles} title="Open Files at demo path">
              📁 Files
            </button>
          ) : null}
          {onOpenPlaces ? (
            <button className="btn btn-ghost" type="button" onClick={onOpenPlaces} title="Open Places">
              🧭 Places
            </button>
          ) : null}
          {onOpenMacros ? (
            <button className="btn btn-ghost" type="button" onClick={onOpenMacros} title="Open Macros">
              🧰 Macros
            </button>
          ) : null}
          <button className="btn btn-ghost" onClick={() => termRef.current?.clear()} type="button">
            🧹 Clear
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={containerRef} />
    </div>
  );
}
