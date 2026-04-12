import { useLayoutEffect, useRef, useState } from "react";
import type { AgentToolRun } from "../types/agentToolRun";
import type { AgentContext } from "../types/agent";
import { AgentExplainModal } from "./AgentExplainModal";
import "./agentoutputlog.css";

type Props = {
  runs: AgentToolRun[];
  agentContext: AgentContext;
  /** When set, scroll that entry into view once, then call onFocusConsumed. */
  focusMessageId?: string | null;
  onFocusConsumed?: () => void;
  /** Persisted highlight for the block (e.g. after jump from chat). */
  highlightMessageId?: string | null;
};

export function AgentOutputLog({ runs, agentContext, focusMessageId, onFocusConsumed, highlightMessageId }: Props) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [explain, setExplain] = useState<{ command: string; output: string } | null>(null);

  useLayoutEffect(() => {
    if (!focusMessageId) return;
    const id = focusMessageId;
    requestAnimationFrame(() => {
      refs.current[id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      onFocusConsumed?.();
    });
  }, [focusMessageId, onFocusConsumed]);

  if (runs.length === 0) {
    return (
      <div className="agent-output-log-root">
        <div className="muted small agent-output-log-empty">No command runs yet in this conversation.</div>
      </div>
    );
  }

  return (
    <div className="agent-output-log-root">
      <div className="agent-output-log-scroll">
        {runs.map((ln) => (
          <div
            key={ln.id}
            ref={(el) => {
              refs.current[ln.id] = el;
            }}
            className={`agent-output-block${highlightMessageId === ln.id ? " agent-output-block--highlight" : ""}`}
          >
            <div className="agent-output-context-line muted small">
              {ln.contextLabel?.trim() ? ln.contextLabel.trim() : "Context unknown"}
            </div>
            <div className="agent-output-block-head">
              <span className="mono agent-output-cmd">{ln.command || "(no command)"}</span>
              <span className="agent-output-head-right">
                <span className="agent-output-badge">
                  {ln.cancelled ? "Cancelled" : ln.error ? `Error: ${ln.error}` : "Completed"}
                </span>
                {!ln.cancelled ? (
                  <button
                    type="button"
                    className="agent-output-explain-btn"
                    title="Explain output"
                    aria-label="Explain output"
                    onClick={() =>
                      setExplain({
                        command: ln.command || "",
                        output: ln.output || (ln.error ? "" : "(no output)"),
                      })
                    }
                  >
                    ?
                  </button>
                ) : null}
              </span>
            </div>
            <pre className="agent-output-pre">
              {ln.cancelled ? "(cancelled by user)" : ln.output || (ln.error ? "" : "(no output)")}
            </pre>
          </div>
        ))}
      </div>
      <AgentExplainModal
        open={!!explain}
        onClose={() => setExplain(null)}
        agentContext={agentContext}
        kind="tool_output"
        command={explain?.command ?? ""}
        output={explain?.output ?? ""}
      />
    </div>
  );
}
