import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentToolRun } from "../types/agentToolRun";
import type { AgentContext } from "../types/agent";
import { AgentExplainModal } from "./AgentExplainModal";
import { SaveAiToolExplain } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import "./agentoutputlog.css";

const EXPLAIN_SAVED_EVENT = "daimon-ai-tool-explain-saved";

type Props = {
  runs: AgentToolRun[];
  agentContext: AgentContext;
  /** Active conversation (for persisting explain on tool messages). */
  conversationId: string | null;
  /** When set, scroll that entry into view once, then call onFocusConsumed. */
  focusMessageId?: string | null;
  onFocusConsumed?: () => void;
  /** Persisted highlight for the block (e.g. after jump from chat). */
  highlightMessageId?: string | null;
};

export function AgentOutputLog({
  runs,
  agentContext,
  conversationId,
  focusMessageId,
  onFocusConsumed,
  highlightMessageId,
}: Props) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [explain, setExplain] = useState<{ command: string; output: string; messageId: string } | null>(null);
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  /** Until GetAiMessages reflects SaveAiToolExplain, treat as explained so we do not call the LLM again. */
  const [optimisticExplainById, setOptimisticExplainById] = useState<Record<string, string>>({});

  useEffect(() => {
    setOptimisticExplainById((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const ln = runs.find((r) => r.id === id);
        if (ln?.explainText?.trim()) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [runs]);

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

  const explainTextFor = (ln: AgentToolRun) => (ln.explainText?.trim() || optimisticExplainById[ln.id]?.trim() || "");
  const shouldCollapseOutput = (text: string) => text.length > 900 || text.split("\n").length > 14;

  const cachedReplyForOpenModal =
    explain != null
      ? runs.find((r) => r.id === explain.messageId)?.explainText?.trim() ||
        optimisticExplainById[explain.messageId]?.trim() ||
        ""
      : "";

  return (
    <div className="agent-output-log-root">
      <div className="agent-output-log-scroll">
        {runs.map((ln) => {
          const ctx = ln.contextLabel?.trim() ? ln.contextLabel.trim() : "Context unknown";
          const hasCachedExplain = !!explainTextFor(ln);
          const outputText = ln.cancelled ? "(cancelled by user)" : ln.output || (ln.error ? "" : "(no output)");
          const canCollapse = shouldCollapseOutput(outputText);
          const isExpanded = !!expandedById[ln.id];
          const showExplainBtn = !ln.cancelled && !ln.error;
          let badgeMod = " agent-output-badge--completed";
          let badgeLabel = "Completed";
          if (ln.cancelled) {
            badgeMod = " agent-output-badge--cancelled";
            badgeLabel = "Cancelled";
          } else if (ln.error) {
            badgeMod = " agent-output-badge--error";
            badgeLabel = `Error: ${ln.error}`;
          } else if (ln.inProgress) {
            badgeMod = " agent-output-badge--in_progress";
            badgeLabel = "In progress";
          }
          return (
            <div
              key={ln.id}
              ref={(el) => {
                refs.current[ln.id] = el;
              }}
              className={`agent-output-entry${highlightMessageId === ln.id ? " agent-output-entry--highlight" : ""}`}
            >
              <div className="agent-output-context-heading muted small">{ctx}</div>
              <div className="agent-output-block">
                <div className="agent-output-block-head">
                  <span className="mono agent-output-cmd">{ln.command || "(no command)"}</span>
                  <span className="agent-output-head-right">
                    <span className={`agent-output-badge${badgeMod}`}>{badgeLabel}</span>
                    {showExplainBtn ? (
                      <button
                        type="button"
                        className={`agent-output-explain-btn${hasCachedExplain ? " agent-output-explain-btn--cached" : ""}`}
                        title={hasCachedExplain ? "View saved explanation" : "Explain output"}
                        aria-label={hasCachedExplain ? "View saved explanation" : "Explain output"}
                        onClick={() =>
                          setExplain({
                            command: ln.command || "",
                            output: ln.output || (ln.error ? "" : "(no output)"),
                            messageId: ln.id,
                          })
                        }
                      >
                        ?
                      </button>
                    ) : null}
                  </span>
                </div>
                <pre className={`agent-output-pre${canCollapse && !isExpanded ? " agent-output-pre--collapsed" : ""}`}>{outputText}</pre>
                {canCollapse ? (
                  <div className="agent-output-expand-row">
                    <button
                      type="button"
                      className="agent-output-expand-btn"
                      onClick={() => setExpandedById((prev) => ({ ...prev, [ln.id]: !prev[ln.id] }))}
                    >
                      {isExpanded ? "Collapse output" : "Expand output"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <AgentExplainModal
        open={!!explain}
        onClose={() => setExplain(null)}
        agentContext={agentContext}
        kind="tool_output"
        command={explain?.command ?? ""}
        output={explain?.output ?? ""}
        cachedReplyText={cachedReplyForOpenModal}
        onPersistReply={
          conversationId && explain
            ? async (replyText) => {
                await SaveAiToolExplain(
                  new main.SaveAiToolExplainRequest({
                    conversationId,
                    messageId: explain.messageId,
                    explainText: replyText,
                  })
                );
                setOptimisticExplainById((m) => ({ ...m, [explain.messageId]: replyText }));
                window.dispatchEvent(new CustomEvent(EXPLAIN_SAVED_EVENT, { detail: { conversationId } }));
              }
            : undefined
        }
      />
    </div>
  );
}
