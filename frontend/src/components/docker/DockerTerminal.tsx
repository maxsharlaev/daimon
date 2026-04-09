import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { DockerStreamResize, DockerStreamSend } from "../../../wailsjs/go/main/App";
import type { DockerOutputEvent, DockerStateEvent } from "../../types/docker";
import { onDockerOutput, onDockerState, startDockerEventBridge } from "../../docker/events";

type Props = {
  streamId: string | null;
  /** When set, used for output/state matching so early events aren't missed (parent sets this sync when stream starts). */
  streamIdRef?: MutableRefObject<string | null>;
  inputEnabled?: boolean;
  convertEol?: boolean;
  onDisconnected?: (id: string, error?: string | null) => void;
};

export function DockerTerminal({ streamId, streamIdRef: externalStreamIdRef, inputEnabled = false, convertEol = false, onDisconnected }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const internalStreamIdRef = useRef<string | null>(streamId);
  useEffect(() => {
    internalStreamIdRef.current = streamId;
  }, [streamId]);

  const streamIdRef = externalStreamIdRef ?? internalStreamIdRef;

  useEffect(() => {
    startDockerEventBridge();
  }, []);

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
        allowProposedApi: false,
        convertEol,
        disableStdin: !inputEnabled,
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
        const id = streamIdRef.current;
        if (id) {
          void DockerStreamResize(id, term.cols, term.rows);
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

      const disposeData = term.onData((data) => {
        const id = streamIdRef.current;
        if (!id || !inputEnabled) return;
        void DockerStreamSend(id, data);
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
  }, [inputEnabled]);

  const prevStreamIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!termRef.current) return;
    if (prevStreamIdRef.current != null && prevStreamIdRef.current !== streamId) {
      termRef.current.clear();
    }
    prevStreamIdRef.current = streamId;
  }, [streamId]);

  useEffect(() => {
    const unsubOut = onDockerOutput((ev: DockerOutputEvent) => {
      const id = streamIdRef.current;
      if (!id || ev.id !== id) return;
      termRef.current?.write(ev.data ?? "");
    });
    const unsubState = onDockerState((ev: DockerStateEvent) => {
      const id = streamIdRef.current;
      if (!id || ev.id !== id) return;
      if (ev.state === "disconnected") {
        onDisconnected?.(id, ev.error ?? null);
      }
    });
    return () => {
      unsubOut();
      unsubState();
    };
  }, [onDisconnected]);

  if (lastError) {
    return <div className="error">{lastError}</div>;
  }
  return <div ref={containerRef} className="docker-terminal" />;
}
