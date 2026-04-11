import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AiChat,
  AiResolveCommand,
  CreateAiConversation,
  DeleteAiConversation,
  GetAiMessages,
  ListAiConversations,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import type { AgentContext } from "../types/agent";
import "./agentpanel.css";

type ChatLine =
  | { kind: "user"; text: string; id: string }
  | { kind: "assistant"; text: string; id: string; raw?: string }
  | { kind: "sys"; text: string };

type Props = {
  open: boolean;
  agentContext: AgentContext;
  onClose: () => void;
};

export function AgentPanel({ open, agentContext, onClose }: Props) {
  const [conversations, setConversations] = useState<main.AiConversationListDTO[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sysStrip, setSysStrip] = useState<string | null>(null);
  const [pending, setPending] = useState<{ assistantMessageId: string; command: string } | null>(null);
  const [dialogsOpen, setDialogsOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    const list = await ListAiConversations();
    setConversations(list || []);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const rows = await GetAiMessages(id);
    const next: ChatLine[] = [];
    let lastPending: { assistantMessageId: string; command: string } | null = null;
    for (const m of rows) {
      if (m.role === "user") {
        try {
          const p = JSON.parse(m.payloadJson || "{}");
          next.push({ kind: "user", text: p.text ?? "", id: m.id });
        } catch {
          next.push({ kind: "user", text: m.payloadJson, id: m.id });
        }
      } else if (m.role === "assistant") {
        try {
          const p = JSON.parse(m.payloadJson || "{}");
          const rt = typeof p.replyText === "string" ? p.replyText : m.payloadJson;
          next.push({ kind: "assistant", text: rt, id: m.id, raw: m.payloadJson });
          if (p.phase === "awaiting_command" && typeof p.pendingCommand === "string") {
            lastPending = { assistantMessageId: m.id, command: p.pendingCommand };
          }
        } catch {
          next.push({ kind: "assistant", text: m.payloadJson, id: m.id });
        }
      }
    }
    setLines(next);
    setPending(lastPending);
  }, []);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const list = await ListAiConversations();
        setConversations(list || []);
        if (list && list.length > 0) {
          const id = list[0].id;
          setConvId(id);
          await loadMessages(id);
        } else {
          const id = await CreateAiConversation("");
          setConvId(id);
          setLines([]);
          setPending(null);
          await loadConversations();
        }
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init agent panel when opened
  }, [open]);

  const selectConv = async (id: string) => {
    setConvId(id);
    setPending(null);
    await loadMessages(id);
    setDialogsOpen(false);
  };

  const newChat = async () => {
    const id = await CreateAiConversation("");
    await loadConversations();
    setConvId(id);
    setLines([]);
    setPending(null);
    setDialogsOpen(false);
  };

  const sessionOk = useMemo(() => {
    if (agentContext.mode === "connections") return !!agentContext.sessionId;
    if (agentContext.mode === "docker") {
      if (!agentContext.containerId) return false;
      if (agentContext.dockerScope === "remote") return !!agentContext.sessionId;
      return agentContext.dockerScope === "local";
    }
    return false;
  }, [agentContext]);

  const send = async () => {
    const t = input.trim();
    if (!t || !convId || busy) return;
    setInput("");
    setErr(null);
    setSysStrip(null);
    setBusy(true);
    try {
      const req = new main.AiChatRequest({
        conversationId: convId,
        userText: t,
        agentContext: new main.AgentContextDTO({
          mode: agentContext.mode,
          sessionId: agentContext.sessionId,
          profileId: agentContext.profileId,
          dockerScope: agentContext.dockerScope,
          containerId: agentContext.containerId,
        }),
      });
      const res = await AiChat(req);
      if (res.error) {
        setErr(res.error);
        setSysStrip(res.error);
        return;
      }
      await loadMessages(convId);
      if (res.pendingCommand) {
        setPending({ assistantMessageId: res.pendingCommand.assistantMessageId, command: res.pendingCommand.command });
        if (!sessionOk) {
          setSysStrip("Для выполнения команды должна быть активна сессия терминала. Активируйте терминал чтобы продолжить.");
        }
      } else {
        setPending(null);
      }
      await loadConversations();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      setSysStrip(msg);
    } finally {
      setBusy(false);
    }
  };

  const resolveCommand = async (approved: boolean) => {
    if (!convId || !pending) return;
    setBusy(true);
    setErr(null);
    try {
      const req = new main.AiResolveCommandRequest({
        conversationId: convId,
        assistantMessageId: pending.assistantMessageId,
        approved,
        agentContext: new main.AgentContextDTO({
          mode: agentContext.mode,
          sessionId: agentContext.sessionId,
          profileId: agentContext.profileId,
          dockerScope: agentContext.dockerScope,
          containerId: agentContext.containerId,
        }),
      });
      const res = await AiResolveCommand(req);
      if (res.error) {
        setErr(res.error);
        setSysStrip(res.error);
      }
      setPending(null);
      await loadMessages(convId);
      if (res.pendingCommand) {
        setPending({ assistantMessageId: res.pendingCommand.assistantMessageId, command: res.pendingCommand.command });
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <div className="agent-panel-title">Agent</div>
        <button className="btn btn-ghost agent-panel-close" type="button" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="agent-panel-body">
        <div className="agent-chat-scroll">
          {err ? <div className="error-text agent-chat-error">{err}</div> : null}
          {lines.map((ln, i) =>
            ln.kind === "user" ? (
              <div key={`${ln.id}-${i}`} className="agent-bubble agent-bubble-user">
                {ln.text}
              </div>
            ) : ln.kind === "assistant" ? (
              <div key={`${ln.id}-${i}`} className="agent-bubble agent-bubble-assistant">
                {ln.text}
              </div>
            ) : (
              <div key={i} className="agent-bubble agent-bubble-sys">
                {ln.text}
              </div>
            )
          )}
          {busy ? <div className="muted small agent-thinking">…</div> : null}
        </div>
        {pending ? (
          <div className="agent-system-strip">
            {sysStrip ? <div className="agent-sys-msg">{sysStrip}</div> : null}
            <div className="agent-cmd-block">
              <div className="mono agent-cmd-text">{pending.command}</div>
              <div className="agent-cmd-actions">
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void resolveCommand(false)}>
                  Cancel
                </button>
                <button className="btn" type="button" disabled={busy} onClick={() => void resolveCommand(true)}>
                  Approve
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="agent-system-strip">{sysStrip ? <div className="agent-sys-msg">{sysStrip}</div> : null}</div>
        )}
        <div className="agent-input-row">
          <button className="btn btn-ghost agent-dialogs-btn" type="button" title="Dialogs" onClick={() => setDialogsOpen(true)}>
            ☰
          </button>
          <input
            className="agent-input"
            value={input}
            placeholder="Ask the agent…"
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="btn" type="button" disabled={busy} onClick={() => void send()}>
            Send
          </button>
        </div>
      </div>

      {dialogsOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal agent-dialogs-modal">
            <div className="modal-title">Dialogs</div>
            <div className="modal-body">
              <button className="btn" type="button" onClick={() => void newChat()}>
                New chat
              </button>
              <ul className="agent-dialog-list">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={`agent-dialog-pick ${c.id === convId ? "active" : ""}`} onClick={() => void selectConv(c.id)}>
                      <span className="agent-dialog-title">{c.title || "(untitled)"}</span>
                      <span className="muted small">{c.byteSize} B · {c.updatedAt?.slice(0, 10)}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost agent-dialog-del"
                      title="Delete"
                      onClick={async () => {
                        await DeleteAiConversation(c.id);
                        if (convId === c.id) await newChat();
                        else await loadConversations();
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setDialogsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
