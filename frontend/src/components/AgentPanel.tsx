import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DIALOG_PREVIEW_TAIL = 8;

function parseAiMessageRows(rows: main.AiMessageDTO[]): {
  lines: ChatLine[];
  lastPending: { assistantMessageId: string; command: string } | null;
} {
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
  return { lines: next, lastPending };
}

type Props = {
  open: boolean;
  agentContext: AgentContext;
  activeConversationId: string | null;
  onActiveConversationIdChange: (id: string) => void;
};

export function AgentPanel({ open, agentContext, activeConversationId, onActiveConversationIdChange }: Props) {
  const [conversations, setConversations] = useState<main.AiConversationListDTO[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sysStrip, setSysStrip] = useState<string | null>(null);
  const [pending, setPending] = useState<{ assistantMessageId: string; command: string } | null>(null);
  const [dialogsOpen, setDialogsOpen] = useState(false);
  const [dialogPreviewForId, setDialogPreviewForId] = useState<string | null>(null);
  const [dialogPreviewLines, setDialogPreviewLines] = useState<ChatLine[]>([]);
  const [dialogPreviewLoading, setDialogPreviewLoading] = useState(false);
  const dialogPreviewForIdRef = useRef<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    const list = await ListAiConversations();
    setConversations(list || []);
    return list || [];
  }, []);

  const preferredConvIdRef = useRef<string | null>(activeConversationId);
  preferredConvIdRef.current = activeConversationId;

  const loadMessages = useCallback(async (id: string) => {
    const rows = await GetAiMessages(id);
    const { lines: next, lastPending } = parseAiMessageRows(rows);
    setLines(next);
    setPending(lastPending);
  }, []);

  const loadDialogPreview = useCallback(async (id: string) => {
    dialogPreviewForIdRef.current = id;
    setDialogPreviewForId(id);
    setDialogPreviewLoading(true);
    try {
      const rows = await GetAiMessages(id);
      const slice = rows.slice(-DIALOG_PREVIEW_TAIL);
      const { lines } = parseAiMessageRows(slice);
      setDialogPreviewLines(lines);
    } catch {
      setDialogPreviewLines([]);
    } finally {
      setDialogPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const list = await ListAiConversations();
        setConversations(list || []);
        const preferred = preferredConvIdRef.current;
        if (list && list.length > 0) {
          const pickId = preferred && list.some((c) => c.id === preferred) ? preferred : list[0].id;
          setConvId(pickId);
          onActiveConversationIdChange(pickId);
          await loadMessages(pickId);
        } else {
          const id = await CreateAiConversation("");
          setConvId(id);
          setLines([]);
          setPending(null);
          onActiveConversationIdChange(id);
          await loadConversations();
        }
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init when panel opens; preferred id read from ref
  }, [open]);

  useEffect(() => {
    if (!dialogsOpen || !convId) return;
    void loadDialogPreview(convId);
  }, [dialogsOpen, convId, loadDialogPreview]);

  const selectConv = async (id: string) => {
    setConvId(id);
    onActiveConversationIdChange(id);
    setPending(null);
    await loadMessages(id);
    setDialogsOpen(false);
  };

  const newChat = async () => {
    const list = await ListAiConversations();
    setConversations(list || []);
    const rows = list || [];
    let reuse: main.AiConversationListDTO | undefined;
    if (convId) {
      const cur = rows.find((c) => c.id === convId);
      if (cur && cur.byteSize === 0) {
        reuse = cur;
      }
    }
    if (!reuse) {
      reuse = rows.find((c) => c.byteSize === 0);
    }
    if (reuse) {
      if (reuse.id !== convId) {
        setConvId(reuse.id);
        onActiveConversationIdChange(reuse.id);
      }
      setLines([]);
      setPending(null);
      setDialogsOpen(false);
      return;
    }
    const id = await CreateAiConversation("");
    await loadConversations();
    setConvId(id);
    onActiveConversationIdChange(id);
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
        <button className="btn btn-ghost agent-panel-new" type="button" onClick={() => void newChat()} disabled={busy} title="New chat">
          +
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
            <div className="modal-body agent-dialogs-body">
              <div className="agent-dialogs-columns">
                <div className="agent-dialogs-list-wrap">
                  <ul className="agent-dialog-list">
                    {conversations.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`agent-dialog-pick ${c.id === convId ? "active" : ""} ${c.id === dialogPreviewForId ? "preview" : ""}`}
                          onClick={() => void loadDialogPreview(c.id)}
                        >
                          <span className="agent-dialog-title">{c.title || "(untitled)"}</span>
                          <span className="muted small">
                            {c.byteSize} B · {c.updatedAt?.slice(0, 10)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost agent-dialog-del"
                          title="Delete"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const previewWas = dialogPreviewForIdRef.current;
                            await DeleteAiConversation(c.id);
                            if (convId === c.id) {
                              await newChat();
                              return;
                            }
                            const list = await loadConversations();
                            if (c.id === previewWas) {
                              const nid = list.find((x) => x.id === convId)?.id ?? list[0]?.id;
                              if (nid) void loadDialogPreview(nid);
                            }
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="agent-dialogs-preview">
                  <div className="agent-dialogs-preview-head">
                    <span className="agent-dialogs-preview-label">Preview</span>
                    {dialogPreviewForId ? (
                      <span className="agent-dialogs-preview-sub muted small">
                        {conversations.find((x) => x.id === dialogPreviewForId)?.title?.trim() || "(untitled)"}
                      </span>
                    ) : null}
                  </div>
                  <div className="agent-dialogs-preview-inner">
                    {dialogPreviewLoading ? (
                      <div className="muted small agent-dialogs-preview-empty">Loading…</div>
                    ) : dialogPreviewLines.length === 0 ? (
                      <div className="muted small agent-dialogs-preview-empty">No messages yet</div>
                    ) : (
                      <div className="agent-dialogs-preview-scroll">
                        {dialogPreviewLines.map((ln, i) => (
                          <div
                            key={`preview-${ln.kind}-${i}-${ln.kind !== "sys" ? ln.id : i}`}
                            className={`agent-dialog-preview-msg agent-dialog-preview-msg--${
                              ln.kind === "user" ? "user" : ln.kind === "assistant" ? "assistant" : "sys"
                            }`}
                          >
                            <span className="agent-dialog-preview-role">
                              {ln.kind === "user" ? "You" : ln.kind === "assistant" ? "Assistant" : "System"}
                            </span>
                            <div className="agent-dialog-preview-text">{ln.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions agent-dialogs-actions">
              <div className="agent-dialogs-actions-left">
                <button className="btn" type="button" onClick={() => void newChat()}>
                  New chat
                </button>
              </div>
              <div className="agent-dialogs-actions-right">
                <button
                  className="btn"
                  type="button"
                  disabled={!dialogPreviewForId}
                  onClick={() => dialogPreviewForId && void selectConv(dialogPreviewForId)}
                >
                  Select dialog
                </button>
                <button className="btn" type="button" onClick={() => setDialogsOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
