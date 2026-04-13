import { useEffect, useRef, useState } from "react";
import { AiAgentExplain } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import type { AgentContext } from "../types/agent";
import { AgentAssistantMarkdown } from "./AgentAssistantMarkdown";
import "./agentexplainmodal.css";

export type AgentExplainKind = "tool_output" | "pending_command";

type Props = {
  open: boolean;
  onClose: () => void;
  agentContext: AgentContext;
  kind: AgentExplainKind;
  command: string;
  output: string;
  /** If set, show this text only — no LLM call (already persisted or optimistic). */
  cachedReplyText?: string;
  /** After a successful model reply; used to cache explain on the tool message (tool_output only). */
  onPersistReply?: (replyText: string) => Promise<void>;
};

function dtoFromAgentContext(agentContext: AgentContext) {
  return new main.AgentContextDTO({
    mode: agentContext.mode,
    sessionId: agentContext.sessionId,
    profileId: agentContext.profileId,
    dockerScope: agentContext.dockerScope,
    containerId: agentContext.containerId,
  });
}

export function AgentExplainModal({
  open,
  onClose,
  agentContext,
  kind,
  command,
  output,
  cachedReplyText,
  onPersistReply,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const persistRef = useRef(onPersistReply);
  persistRef.current = onPersistReply;

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setText("");
      setErr(null);
      return;
    }
    const cmd = command.trim();
    if (!cmd) {
      setErr("No command to explain");
      return;
    }
    const cached = (cachedReplyText || "").trim();
    if (cached) {
      setErr(null);
      setText(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setText("");
    setErr(null);
    void (async () => {
      try {
        const req = new main.AiAgentExplainRequest({
          kind,
          command: cmd,
          output: kind === "pending_command" ? "" : output,
          agentContext: dtoFromAgentContext(agentContext),
        });
        const res = await AiAgentExplain(req);
        if (cancelled) return;
        if (res.error) {
          setErr(res.error);
          setText("");
        } else {
          setErr(null);
          const t = (res.replyText || "").trim();
          setText(t);
          if (t && kind === "tool_output" && persistRef.current) {
            try {
              await persistRef.current(t);
            } catch (e) {
              console.error("SaveAiToolExplain:", e);
            }
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setText("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    kind,
    command,
    output,
    cachedReplyText,
    agentContext.mode,
    agentContext.sessionId,
    agentContext.profileId,
    agentContext.dockerScope,
    agentContext.containerId,
  ]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="agent-explain-title">
      <div className="modal agent-explain-modal">
        <div id="agent-explain-title" className="modal-title">
          Explain
        </div>
        <div className="modal-body agent-explain-body">
          {loading ? <div className="muted small">Loading…</div> : null}
          {err ? <div className="error-text">{err}</div> : null}
          {!loading && !err && text ? (
            <div className="agent-explain-text">
              <AgentAssistantMarkdown text={text} />
            </div>
          ) : null}
          {!loading && !err && !text ? <div className="muted small">No explanation returned.</div> : null}
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
