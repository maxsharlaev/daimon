import { useEffect, useMemo, useState } from "react";
import { GetAiUsageEventDetail, ListAiUsageEvents, ReadAiDebugLog } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import "./developerailogs.css";
import { DropdownSelect } from "./ui";

type QuickFilter = "today" | "all";

function todayStartUnixMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

export function DeveloperAiLogsPanel() {
  const [items, setItems] = useState<main.AiUsageEventDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuickFilter>("today");
  const [kind, setKind] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<main.AiUsageEventDTO | null>(null);
  const [rawLog, setRawLog] = useState<string>("");
  const [rawBusy, setRawBusy] = useState(false);

  const loadList = async () => {
    setBusy(true);
    setErr(null);
    try {
      const req = new main.ListAiUsageEventsRequest({
        limit: 200,
        offset: 0,
        kind: kind === "all" ? "" : kind,
        sinceUnixMs: filter === "today" ? todayStartUnixMs() : 0,
      });
      const res = await ListAiUsageEvents(req);
      const next = res.items || [];
      setItems(next);
      setTotal(Number(res.total || 0));
      if (next.length === 0) {
        setSelectedId(null);
      } else if (!selectedId || !next.some((x) => x.id === selectedId)) {
        setSelectedId(next[0].id);
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, kind]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setRawLog("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await GetAiUsageEventDetail(selectedId);
        if (cancelled) return;
        setDetail(d);
        if (!d.logFile) {
          setRawLog("");
          return;
        }
        setRawBusy(true);
        const raw = await ReadAiDebugLog(new main.ReadAiDebugLogRequest({ usageEventId: d.id, logFile: d.logFile }));
        if (cancelled) return;
        setRawLog(raw.content || "");
      } catch {
        if (!cancelled) setRawLog("");
      } finally {
        if (!cancelled) setRawBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, x) => {
        acc.prompt += Number(x.promptTokens || 0);
        acc.completion += Number(x.completionTokens || 0);
        acc.total += Number(x.totalTokens || 0);
        return acc;
      },
      { prompt: 0, completion: 0, total: 0 }
    );
  }, [items]);

  return (
    <div className="settings-section developer-ai-logs">
      <div className="settings-section-title">Developer · AI Logs</div>
      <p className="muted small">
        Per-call diagnostics from chat/explain/test_connection requests. Values below are local usage events, not provider billing.
      </p>
      <div className="developer-ai-logs-toolbar">
        <div className="developer-ai-logs-filters">
          <button className={`btn btn-ghost ${filter === "today" ? "active" : ""}`} type="button" onClick={() => setFilter("today")}>
            Today
          </button>
          <button className={`btn btn-ghost ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")}>
            All
          </button>
          <DropdownSelect
            inline
            className="docker-select"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "All kinds" },
              { value: "chat_round", label: "chat_round" },
              { value: "explain", label: "explain" },
              { value: "test_connection", label: "test_connection" },
            ]}
            aria-label="Event kind"
          />
        </div>
        <button className="btn btn-ghost" type="button" onClick={() => void loadList()} disabled={busy}>
          Refresh
        </button>
      </div>
      <div className="developer-ai-logs-summary muted small">
        Events: {total} · Prompt: {fmtTokens(totals.prompt)} · Completion: {fmtTokens(totals.completion)} · Total: {fmtTokens(totals.total)}
      </div>
      {err ? <div className="error-text">{err}</div> : null}
      <div className="developer-ai-logs-split">
        <div className="developer-ai-logs-list">
          {busy ? <div className="muted small">Loading…</div> : null}
          {!busy && items.length === 0 ? <div className="muted small">No events found for current filters.</div> : null}
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`developer-ai-log-item ${selectedId === it.id ? "active" : ""}`}
              onClick={() => setSelectedId(it.id)}
            >
              <div className="developer-ai-log-item-head">
                <span className="mono">{it.kind || "unknown"}</span>
                <span className="muted small">{it.createdAt?.replace("T", " ").slice(0, 19)}</span>
              </div>
              <div className="developer-ai-log-item-sub mono">
                total={fmtTokens(it.totalTokens)} · prompt={fmtTokens(it.promptTokens)} · completion={fmtTokens(it.completionTokens)}
              </div>
              <div className="developer-ai-log-item-sub">
                {it.phase ? `phase: ${it.phase}` : "phase: —"} {it.model ? `· ${it.model}` : ""}
              </div>
            </button>
          ))}
        </div>
        <div className="developer-ai-logs-detail">
          {!detail ? (
            <div className="muted small">Select an event to view details.</div>
          ) : (
            <>
              <div className="developer-ai-log-kv mono">
                <div>ID: {detail.id}</div>
                <div>kind: {detail.kind}</div>
                <div>phase: {detail.phase || "—"}</div>
                <div>conversation: {detail.conversationId || "—"}</div>
                <div>messages: {detail.messageCount ?? 0}</div>
                <div>prompt_chars: {detail.promptChars ?? 0}</div>
                <div>log_file: {detail.logFile || "—"}</div>
              </div>
              {detail.error ? <div className="error-text">Error: {detail.error}</div> : null}
              <div className="developer-ai-log-raw-head">Raw debug log</div>
              {rawBusy ? <div className="muted small">Loading raw log…</div> : null}
              {!rawBusy && !rawLog ? <div className="muted small">No raw log available.</div> : null}
              {rawLog ? <pre className="developer-ai-log-raw mono">{rawLog}</pre> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

