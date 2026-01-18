import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { SSHResize, SSHSend } from "../../wailsjs/go/main/App";
import type { SSHOutputEvent, SSHStateEvent } from "../types/ssh";
import { onSSHOutput, onSSHState, startSSHEventBridge } from "../ssh/events";

import "./terminalpanel.css";

type Props = {
  connectionId: string | null;
  onDisconnected?: (id: string) => void;
  onShowPwd?: () => void;
};

export function TerminalPanel({ connectionId, onDisconnected, onShowPwd }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connected" | "disconnected">("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const activeId = connectionId ?? "";

  useEffect(() => {
    connectionIdRef.current = connectionId;
    if (connectionId) {
      // If we missed the initial ssh:state connected event, don't stay in idle forever.
      setStatus("connected");
      setLastError(null);
      // Clear screen on session switch to avoid mixing outputs.
      termRef.current?.clear();
    } else {
      setStatus("idle");
      setLastError(null);
    }
  }, [connectionId]);

  useEffect(() => {
    startSSHEventBridge();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // StrictMode-safe: create a fresh Terminal per mount.
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
        const id = connectionIdRef.current;
        if (id) {
          void SSHResize(id, term.cols, term.rows);
        }
      };

      // Defer fit to next tick so layout has a stable size.
      setTimeout(doFit, 0);

      // ResizeObserver is not guaranteed in all WebView environments.
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

      const disposeData = term.onData((data) => {
        const id = connectionIdRef.current;
        if (!id) return;
        void SSHSend(id, data);
      });

      return () => {
        disposeData.dispose();
        roRef.current?.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setLastError(`Terminal init failed: ${msg}`);
      return;
    }
  }, []);

  useEffect(() => {
    // Track state changes
    const unsub = onSSHState((ev: SSHStateEvent) => {
      if (!ev || ev.id !== activeId) return;
      if (ev.state === "connected") {
        setStatus("connected");
        setLastError(null);
        termRef.current?.write("\r\n\x1b[38;5;245m[daimon] connected\x1b[0m\r\n");
        // force a fit after connect (helps if xterm was mounted before layout settled)
        setTimeout(() => {
          try {
            fitRef.current?.fit();
          } catch {
            // ignore
          }
        }, 0);
      } else {
        setStatus("disconnected");
        setLastError(ev.error ?? null);
        if (onDisconnected) onDisconnected(ev.id);
      }
    });
    return () => unsub();
  }, [activeId, onDisconnected]);

  useEffect(() => {
    const unsub = onSSHOutput((ev: SSHOutputEvent) => {
      if (!ev || ev.id !== activeId) return;
      termRef.current?.write(ev.data);
    });
    return () => unsub();
  }, [activeId]);

  useEffect(() => {
    if (!connectionId) {
      setStatus("idle");
      setLastError(null);
      termRef.current?.write("\r\n\x1b[38;5;245m[daimon] disconnected\x1b[0m\r\n");
      return;
    }
    setLastError(null);
  }, [connectionId]);

  return (
    <div className="panel panel-terminal">
      <div className="panel-titlebar">
        <div className="panel-title">Terminal</div>
        <div className="panel-meta">
          <span className={`badge badge-${status}`}>{status}</span>
          {lastError ? <span className="error-text">{lastError}</span> : null}
        </div>
        <div className="panel-actions">
          {onShowPwd ? (
            <button className="btn btn-ghost" type="button" onClick={onShowPwd} title="Open Files at current terminal path">
              Files
            </button>
          ) : null}
          <button
            className="btn btn-ghost"
            onClick={() => termRef.current?.clear()}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={containerRef} />
    </div>
  );
}

