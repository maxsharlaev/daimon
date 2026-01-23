import { useCallback, useEffect, useRef, useState } from "react";
import { DockerTerminal } from "./DockerTerminal";
import { DockerLocalExecStart, DockerRemoteExecStart, DockerStreamSend, DockerStreamStop } from "../../../wailsjs/go/main/App";
import { onDockerOutput } from "../../docker/events";
import "../terminalpanel.css";

type Scope = "local" | "remote";

type Props = {
  scope: Scope;
  sessionId: string | null;
  containerId: string;
  profileName: string;
  onOpenFiles?: (remotePath?: string) => void;
  onAddLocation?: (remotePath: string) => void;
  onOpenPlaces?: () => void;
  onOpenMacros?: () => void;
  onStreamId?: (streamId: string | null) => void;
  onClose: () => void;
};

export function DockerShellPanel({
  scope,
  sessionId,
  containerId,
  profileName,
  onOpenFiles,
  onAddLocation,
  onOpenPlaces,
  onOpenMacros,
  onStreamId,
  onClose,
}: Props) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    let activeId: string | null = null;
    const start = async () => {
      try {
        if (scope === "local") {
          const id = await DockerLocalExecStart(containerId, 80, 24);
          activeId = id;
          setStreamId(id);
        } else {
          if (!sessionId) {
            setError("Remote session not connected");
            return;
          }
          const id = await DockerRemoteExecStart(sessionId, containerId, 80, 24);
          activeId = id;
          setStreamId(id);
        }
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    };
    void start();
    return () => {
      if (activeId) void DockerStreamStop(activeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, scope, sessionId]);

  useEffect(() => {
    streamIdRef.current = streamId;
    onStreamId?.(streamId);
  }, [streamId]);

  const queryPwdFromStream = useCallback(async () => {
    const id = streamIdRef.current;
    if (!id) return "";
    let buf = "";
    return await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        unsub();
        resolve("");
      }, 2500);

      const stripAnsi = (s: string) =>
        s
          .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
          .replace(/\x1b\][^\x07]*\x07/g, "")
          .replace(/\x1b[()][A-Za-z0-9]/g, "");

      const unsub = onDockerOutput((ev) => {
        if (!ev || ev.id !== id) return;
        buf += ev.data ?? "";
        if (buf.length > 64 * 1024) buf = buf.slice(-64 * 1024);
        const clean = stripAnsi(buf).replace(/\r/g, "");
        const re = /(\/[^\s]+)/g;
        let m: RegExpExecArray | null = null;
        let last = "";
        while ((m = re.exec(clean))) last = m[1];
        const pathish = last.replace(/[#$>]+$/, "").replace(/[:]+$/, "").trim();
        if (pathish) {
          clearTimeout(timeout);
          unsub();
          resolve(pathish);
        }
      });

      void DockerStreamSend(id, "pwd\r");
    });
  }, []);

  if (error) {
    return (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Shell</div>
          <div className="panel-meta error">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel-terminal">
      <div className="panel-titlebar">
        <div className="panel-title">Terminal</div>
        <div className="panel-meta">
          <span className="muted">{profileName}</span>
        </div>
        <div className="panel-actions">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={async () => {
              const remotePath = await queryPwdFromStream();
              onOpenFiles?.((remotePath || ".").trim() || ".");
            }}
            disabled={!streamId}
            title="Open Files at current terminal path"
          >
            📁 Files
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={async () => {
              const remotePath = await queryPwdFromStream();
              onAddLocation?.((remotePath || ".").trim() || ".");
            }}
            disabled={!streamId}
            title="Add current directory to Places"
          >
            📍 Add Place
          </button>
          <button className="btn btn-ghost" type="button" onClick={onOpenPlaces} title="Open Places">
            🧭 Places
          </button>
          <button className="btn btn-ghost" type="button" onClick={onOpenMacros} title="Open Macros">
            🧰 Macros
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              const id = streamIdRef.current;
              if (!id) return;
              void DockerStreamSend(id, "\x0c");
            }}
          >
            🧹 Clear
          </button>
        </div>
      </div>
      <div className="terminal-body docker-terminal-wrap">
        <DockerTerminal streamId={streamId} inputEnabled onDisconnected={() => onClose()} />
      </div>
    </div>
  );
}
