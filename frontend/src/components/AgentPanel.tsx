import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentToolRun } from "../types/agentToolRun";
import {
  AiChat,
  AiResolveCommand,
  CreateAiConversation,
  DeleteAiConversation,
  GetAiMessages,
  ListAiConversations,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import type { ProfileDTO } from "../types/models";
import type { AgentContext } from "../types/agent";
import { AgentAssistantMarkdown } from "./AgentAssistantMarkdown";
import { AgentExplainModal } from "./AgentExplainModal";
import type { TerminalSession } from "./TerminalTabs";
import "./agentpanel.css";

type ChatLine =
  | { kind: "user"; text: string; id: string }
  | { kind: "assistant"; text: string; id: string; raw?: string }
  | { kind: "sys"; text: string }
  | {
      kind: "tool_run";
      id: string;
      command: string;
      output: string;
      cancelled: boolean;
      error?: string;
      contextLabel?: string;
      explainText?: string;
    };

type PreviewChatLine = Extract<ChatLine, { kind: "user" } | { kind: "assistant" }>;

export type AgentTaskItem = { id: string; title: string; status: string };

const DIALOG_PREVIEW_TAIL = 8;

function parseAiMessageRows(rows: main.AiMessageDTO[]): {
  lines: ChatLine[];
  lastPending: { assistantMessageId: string; command: string } | null;
} {
  const next: ChatLine[] = [];
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
      } catch {
        next.push({ kind: "assistant", text: m.payloadJson, id: m.id });
      }
    } else if (m.role === "tool") {
      try {
        const p = JSON.parse(m.payloadJson || "{}");
        const cmd = typeof p.command === "string" ? p.command : "";
        const output = typeof p.output === "string" ? p.output : "";
        const cancelled = !!p.cancelled;
        const err = typeof p.error === "string" ? p.error : undefined;
        const ctxLb = typeof p.contextLabel === "string" && p.contextLabel.trim() !== "" ? p.contextLabel.trim() : undefined;
        next.push({ kind: "tool_run", id: m.id, command: cmd, output, cancelled, error: err, contextLabel: ctxLb });
      } catch {
        next.push({ kind: "tool_run", id: m.id, command: "", output: m.payloadJson, cancelled: false });
      }
    }
  }

  let lastPending: { assistantMessageId: string; command: string } | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i];
    if (m.role !== "assistant") {
      continue;
    }
    try {
      const p = JSON.parse(m.payloadJson || "{}");
      if (p.phase === "awaiting_command" && typeof p.pendingCommand === "string" && p.pendingCommand.trim() !== "") {
        lastPending = { assistantMessageId: m.id, command: p.pendingCommand.trim() };
      }
    } catch {
      /* ignore */
    }
    break;
  }

  return { lines: next, lastPending };
}

function parsePreviewLines(rows: main.AiMessageDTO[]): PreviewChatLine[] {
  const { lines } = parseAiMessageRows(rows);
  return lines.filter((ln): ln is PreviewChatLine => ln.kind === "user" || ln.kind === "assistant");
}

function toAgentToolRuns(lines: ChatLine[]): AgentToolRun[] {
  return lines
    .filter((ln): ln is Extract<ChatLine, { kind: "tool_run" }> => ln.kind === "tool_run")
    .map((ln) => ({
      id: ln.id,
      command: ln.command,
      output: ln.output,
      cancelled: ln.cancelled,
      error: ln.error,
      contextLabel: ln.contextLabel,
      explainText: ln.explainText,
    }));
}

function extractTasksFromAssistantRaw(raw: string | undefined): AgentTaskItem[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    const tasks = p.tasks;
    if (!Array.isArray(tasks)) return [];
    const out: AgentTaskItem[] = [];
    for (const t of tasks) {
      if (t && typeof t === "object") {
        const id = String((t as { id?: string }).id ?? "");
        const title = String((t as { title?: string }).title ?? "");
        const status = String((t as { status?: string }).status ?? "pending");
        if (title || id) {
          out.push({ id: id || String(out.length), title: title || id, status });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

type AgentTaskSnapshot = { messageId: string; tasks: AgentTaskItem[]; replyExcerpt: string };

function collectTaskSnapshots(lines: ChatLine[]): AgentTaskSnapshot[] {
  const out: AgentTaskSnapshot[] = [];
  for (const ln of lines) {
    if (ln.kind !== "assistant" || !ln.raw) continue;
    const tasks = extractTasksFromAssistantRaw(ln.raw);
    if (tasks.length === 0) continue;
    out.push({ messageId: ln.id, tasks, replyExcerpt: ln.text.trim().slice(0, 220) });
  }
  return out;
}

export type AgentRunContextStripProps = {
  label: string;
  interactive: boolean;
  onOpenPicker?: () => void;
  pickerOpen: boolean;
  onClosePicker: () => void;
  pickerSessions: TerminalSession[];
  profiles: ProfileDTO[];
  onPickSession: (sessionId: string) => void;
};

type Props = {
  open: boolean;
  agentContext: AgentContext;
  activeConversationId: string | null;
  onActiveConversationIdChange: (id: string) => void;
  /** Sync tool/command rows for the Agent output tab in the main workspace (terminal / Docker). */
  onToolRunsChange?: (runs: AgentToolRun[]) => void;
  /** Open the workspace Agent output tab and optionally scroll to a tool message. */
  onRequestOpenAgentOutput?: (opts: { messageId: string }) => void;
  /** SSH session override (Connections) or read-only Docker label — strip above the input. */
  runContextStrip?: AgentRunContextStripProps | null;
};

export function AgentPanel({
  open,
  agentContext,
  activeConversationId,
  onActiveConversationIdChange,
  onToolRunsChange,
  onRequestOpenAgentOutput,
  runContextStrip,
}: Props) {
  const [conversations, setConversations] = useState<main.AiConversationListDTO[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sysStrip, setSysStrip] = useState<string | null>(null);
  const [pending, setPending] = useState<{ assistantMessageId: string; command: string } | null>(null);
  const [dialogsOpen, setDialogsOpen] = useState(false);
  const [dialogPreviewForId, setDialogPreviewForId] = useState<string | null>(null);
  const [dialogPreviewLines, setDialogPreviewLines] = useState<PreviewChatLine[]>([]);
  const [dialogPreviewLoading, setDialogPreviewLoading] = useState(false);
  const dialogPreviewForIdRef = useRef<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingExplainOpen, setPendingExplainOpen] = useState(false);
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(null);
  const [transientRunCommand, setTransientRunCommand] = useState<string | null>(null);
  const [tasksModalOpen, setTasksModalOpen] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastUserBubbleRef = useRef<HTMLDivElement | null>(null);
  const optimisticUserBubbleRef = useRef<HTMLDivElement | null>(null);
  const lastAssistantBubbleRef = useRef<HTMLDivElement | null>(null);

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
      setDialogPreviewLines(parsePreviewLines(slice));
    } catch {
      setDialogPreviewLines([]);
    } finally {
      setDialogPreviewLoading(false);
    }
  }, []);

  const lastUserLineIndex = useMemo(() => {
    let idx = -1;
    lines.forEach((ln, i) => {
      if (ln.kind === "user") {
        idx = i;
      }
    });
    return idx;
  }, [lines]);

  const lastAssistantLineIndex = useMemo(() => {
    let idx = -1;
    lines.forEach((ln, i) => {
      if (ln.kind === "assistant") {
        idx = i;
      }
    });
    return idx;
  }, [lines]);

  const taskSnapshots = useMemo(() => collectTaskSnapshots(lines), [lines]);

  const taskSummaryLabel = useMemo(() => {
    if (taskSnapshots.length === 0) return "";
    const tasks = taskSnapshots[taskSnapshots.length - 1].tasks;
    const n = tasks.length;
    const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, "_");
    const cnt = (st: string) => tasks.filter((x) => norm(x.status) === st).length;
    return `Plan: ${n} step${n === 1 ? "" : "s"} · ${cnt("done")} done · ${cnt("skipped")} skipped · ${cnt("in_progress")} active · ${cnt("pending")} pending`;
  }, [taskSnapshots]);

  useEffect(() => {
    if (!open) {
      onToolRunsChange?.([]);
      return;
    }
    onToolRunsChange?.(toAgentToolRuns(lines));
  }, [open, lines, onToolRunsChange]);

  useLayoutEffect(() => {
    if (!open) return;
    const userEl =
      busy && optimisticUserText ? optimisticUserBubbleRef.current : lastUserBubbleRef.current;
    if (!userEl) return;
    userEl.scrollIntoView({ block: "start", behavior: "auto" });
  }, [lines, busy, open, optimisticUserText]);

  useLayoutEffect(() => {
    if (!open) return;
    const asstEl = lastAssistantBubbleRef.current;
    const scrollEl = chatScrollRef.current;
    if (!asstEl || !scrollEl) return;
    const scrollBottom = scrollEl.scrollTop + scrollEl.clientHeight;
    const asstBottom = asstEl.offsetTop + asstEl.offsetHeight;
    if (asstBottom > scrollBottom + 4) {
      asstEl.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [lines, open, lastAssistantLineIndex]);

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

  useEffect(() => {
    const onExplainSaved = (ev: Event) => {
      const ce = ev as CustomEvent<{ conversationId?: string }>;
      const cid = ce.detail?.conversationId;
      if (!open || !convId || cid !== convId) return;
      void loadMessages(convId);
    };
    window.addEventListener("daimon-ai-tool-explain-saved", onExplainSaved);
    return () => window.removeEventListener("daimon-ai-tool-explain-saved", onExplainSaved);
  }, [open, convId, loadMessages]);

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

  useEffect(() => {
    if (!pending) setPendingExplainOpen(false);
  }, [pending]);

  useEffect(() => {
    setTasksModalOpen(false);
  }, [convId]);

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
    setOptimisticUserText(t);
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
      setOptimisticUserText(null);
    }
  };

  const resolveCommand = async (approved: boolean) => {
    if (!convId || !pending) return;
    const cmdSnapshot = pending.command;
    if (approved) {
      setTransientRunCommand(cmdSnapshot);
    }
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
      setTransientRunCommand(null);
      setBusy(false);
    }
  };

  const openOutputForTool = (messageId: string) => {
    onRequestOpenAgentOutput?.({ messageId });
  };

  const profileById = useMemo(() => {
    const m = new Map<string, ProfileDTO>();
    (runContextStrip?.profiles ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [runContextStrip?.profiles]);

  const pickerCountsByProfile = useMemo(() => {
    const m = new Map<string, number>();
    (runContextStrip?.pickerSessions ?? []).forEach((s) => m.set(s.profileId, (m.get(s.profileId) ?? 0) + 1));
    return m;
  }, [runContextStrip?.pickerSessions]);

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
          {taskSnapshots.length > 0 ? (
            <div className="agent-task-board" aria-label="Task plan">
              <button type="button" className="agent-task-summary-btn" onClick={() => setTasksModalOpen(true)}>
                <span className="agent-task-summary-sub">{taskSummaryLabel}</span>
                <span className="muted small">History</span>
              </button>
            </div>
          ) : null}
          <div className="agent-chat-scroll" ref={chatScrollRef}>
            {err ? <div className="error-text agent-chat-error">{err}</div> : null}
            {lines.map((ln, i) => {
              if (ln.kind === "user") {
                return (
                  <div
                    key={`${ln.id}-${i}`}
                    ref={i === lastUserLineIndex ? lastUserBubbleRef : undefined}
                    className="agent-bubble agent-bubble-user"
                  >
                    {ln.text}
                  </div>
                );
              }
              if (ln.kind === "assistant") {
                return (
                  <div
                    key={`${ln.id}-${i}`}
                    ref={i === lastAssistantLineIndex ? lastAssistantBubbleRef : undefined}
                    className="agent-bubble agent-bubble-assistant"
                  >
                    <AgentAssistantMarkdown text={ln.text} />
                  </div>
                );
              }
              if (ln.kind === "tool_run") {
                const label = ln.cancelled ? "Cancelled" : ln.error ? "Error" : "Done";
                const cmdShort = ln.command.length > 72 ? `${ln.command.slice(0, 70)}…` : ln.command || "(command)";
                return (
                  <button
                    key={`${ln.id}-${i}`}
                    type="button"
                    className="agent-tool-run-compact"
                    onClick={() => openOutputForTool(ln.id)}
                  >
                    <span className="agent-tool-run-label">{label}</span>
                    <span className="mono agent-tool-run-cmd">{cmdShort}</span>
                    <span className="agent-tool-run-hint">Agent output tab</span>
                  </button>
                );
              }
              return (
                <div key={i} className="agent-bubble agent-bubble-sys">
                  {ln.text}
                </div>
              );
            })}
            {busy && transientRunCommand ? (
              <div className="agent-tool-run-compact agent-tool-run-compact--running" aria-live="polite">
                <span className="agent-tool-run-label">Running</span>
                <span className="mono agent-tool-run-cmd">
                  {transientRunCommand.length > 72 ? `${transientRunCommand.slice(0, 70)}…` : transientRunCommand}
                </span>
              </div>
            ) : null}
            {busy && optimisticUserText ? (
              <div ref={optimisticUserBubbleRef} className="agent-bubble agent-bubble-user">
                {optimisticUserText}
              </div>
            ) : null}
            {busy ? (
              <div className="agent-thinking" aria-live="polite">
                <span className="agent-thinking-dot" />
                <span className="agent-thinking-dot" />
                <span className="agent-thinking-dot" />
              </div>
            ) : null}
          </div>
          {pending ? (
            <div className="agent-system-strip">
              {sysStrip ? <div className="agent-sys-msg">{sysStrip}</div> : null}
              <div className="agent-cmd-block">
                <div className="agent-cmd-head">
                  <div className="mono agent-cmd-text">{pending.command}</div>
                  <button
                    type="button"
                    className="agent-cmd-explain-btn"
                    title="Explain proposed command"
                    aria-label="Explain proposed command"
                    disabled={busy}
                    onClick={() => setPendingExplainOpen(true)}
                  >
                    ?
                  </button>
                </div>
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
          {runContextStrip?.label ? (
            runContextStrip.interactive && runContextStrip.onOpenPicker ? (
              <button
                type="button"
                className="agent-run-context-strip"
                title="Choose SSH session for agent commands"
                onClick={() => runContextStrip.onOpenPicker?.()}
              >
                <span className="agent-run-context-strip-label">{runContextStrip.label}</span>
                <span className="agent-run-context-strip-chev" aria-hidden="true">
                  ▾
                </span>
              </button>
            ) : (
              <div className="agent-run-context-strip agent-run-context-strip--readonly" title="Execution context">
                <span className="agent-run-context-strip-label">{runContextStrip.label}</span>
              </div>
            )
          ) : null}
          {runContextStrip?.interactive && runContextStrip.pickerOpen ? (
            <div
              className="agent-conn-picker-backdrop"
              role="presentation"
              onClick={() => runContextStrip.onClosePicker()}
            >
              <div
                className="agent-conn-picker-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="SSH sessions"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="agent-conn-picker-grab" aria-hidden="true" />
                <div className="agent-conn-picker-title">Run commands on</div>
                <ul className="agent-conn-picker-list">
                  {runContextStrip.pickerSessions.map((s) => {
                    const prof = profileById.get(s.profileId);
                    const multi = (pickerCountsByProfile.get(s.profileId) ?? 0) > 1;
                    const rowLabel = prof
                      ? `${s.icon} ${prof.name}${multi ? ` ${s.ordinal}` : ""}`
                      : `${s.icon} ${multi ? s.ordinal : ""}`.trim();
                    const sub = prof ? `${prof.username}@${prof.host}:${prof.port}` : s.profileId;
                    return (
                      <li key={s.sessionId}>
                        <button
                          type="button"
                          className="agent-conn-picker-row"
                          onClick={() => runContextStrip.onPickSession(s.sessionId)}
                        >
                          <span className="agent-conn-picker-row-main">{rowLabel}</span>
                          <span className="agent-conn-picker-row-sub muted small">{sub}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="agent-conn-picker-actions">
                  <button className="btn btn-ghost" type="button" onClick={() => runContextStrip.onClosePicker()}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
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

      {tasksModalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal agent-task-history-modal">
            <div className="modal-title">Task plan history</div>
            <div className="modal-body">
              <div className="agent-task-history-list">
                {taskSnapshots.map((snap, idx) => (
                  <div key={`${snap.messageId}-${idx}`} className="agent-task-history-snap">
                    <div className="agent-task-history-snap-title">Update {idx + 1}</div>
                    {snap.replyExcerpt ? <div className="agent-task-history-excerpt">{snap.replyExcerpt}</div> : null}
                    {snap.tasks.map((t) => (
                      <div
                        key={t.id}
                        className={`agent-task-row agent-task-row--${(t.status || "pending").replace(/\s+/g, "_")}`}
                      >
                        <span className="agent-task-status">{t.status}</span>
                        <span className="agent-task-title">{t.title}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setTasksModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
                            key={`preview-${ln.kind}-${ln.id}-${i}`}
                            className={`agent-dialog-preview-msg agent-dialog-preview-msg--${
                              ln.kind === "user" ? "user" : "assistant"
                            }`}
                          >
                            <span className="agent-dialog-preview-role">{ln.kind === "user" ? "You" : "Assistant"}</span>
                            <div className="agent-dialog-preview-text">
                              {ln.kind === "assistant" ? <AgentAssistantMarkdown text={ln.text} /> : ln.text}
                            </div>
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
      {pending ? (
        <AgentExplainModal
          open={pendingExplainOpen}
          onClose={() => setPendingExplainOpen(false)}
          agentContext={agentContext}
          kind="pending_command"
          command={pending.command}
          output=""
        />
      ) : null}
    </div>
  );
}
