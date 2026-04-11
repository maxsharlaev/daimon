import { useCallback, useEffect, useState } from "react";
import {
  AiTestOpenAIConnection,
  AiUsageSeries,
  GetAiSettings,
  SaveAiSettings,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

type Props = {
  onSettingsChanged?: () => void;
};

export function AiModePanel({ onSettingsChanged }: Props) {
  const [st, setSt] = useState<main.AiSettingsDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [series, setSeries] = useState<main.AiUsagePointDTO[]>([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const s = await GetAiSettings();
      setSt(s);
      const u = await AiUsageSeries(30);
      setSeries(u || []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!st) return;
    setBusy(true);
    setErr(null);
    try {
      const settings = new main.AiSettingsDTO({
        integrationType: st.integrationType,
        baseURL: st.baseURL,
        model: st.model,
        maxTokensPerRequest: st.maxTokensPerRequest,
        contextTokenLimit: st.contextTokenLimit,
        summaryKeepLastMessages: st.summaryKeepLastMessages,
        apiKeySet: st.apiKeySet,
      });
      const req = new main.SaveAiSettingsRequest({ settings, apiKey: apiKeyDraft.trim() });
      await SaveAiSettings(req);
      setApiKeyDraft("");
      await load();
      onSettingsChanged?.();
      window.dispatchEvent(new CustomEvent("daimon-ai-settings-changed"));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const testConn = async () => {
    setTestMsg(null);
    setBusy(true);
    try {
      await AiTestOpenAIConnection();
      setTestMsg("Connection OK");
    } catch (e: any) {
      setTestMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!st) {
    return <div className="settings-section muted">Loading AI settings…</div>;
  }

  const maxTok = Math.max(...series.map((p) => p.totalTokens || 0), 1);

  return (
    <div className="settings-section ai-mode-panel">
      <div className="settings-section-title">AI Mode</div>
      <p className="muted small">
        OpenAI-compatible API. The API key is stored in the OS keyring (or internal vault when selected in Secrets flows). Default integration is off.
      </p>
      {err ? <div className="error-text">{err}</div> : null}

      <div className="row">
        <label>Integration</label>
        <select
          value={st.integrationType}
          disabled={busy}
          onChange={(e) => setSt({ ...st, integrationType: e.target.value })}
        >
          <option value="none">None</option>
          <option value="openai_compatible">OpenAI compatible</option>
        </select>
      </div>

      {st.integrationType === "openai_compatible" ? (
        <>
          <div className="row">
            <label>Base URL</label>
            <input className="mono" value={st.baseURL} onChange={(e) => setSt({ ...st, baseURL: e.target.value })} disabled={busy} />
          </div>
          <div className="row">
            <label>Model</label>
            <input value={st.model} onChange={(e) => setSt({ ...st, model: e.target.value })} disabled={busy} />
          </div>
          <div className="row">
            <label>API key</label>
            <input
              type="password"
              autoComplete="off"
              placeholder={st.apiKeySet ? "(unchanged — enter to replace)" : "(required)"}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="row">
            <label>Max tokens / request</label>
            <input
              type="number"
              value={st.maxTokensPerRequest}
              onChange={(e) => setSt({ ...st, maxTokensPerRequest: Number(e.target.value) || 4096 })}
              disabled={busy}
            />
          </div>
          <div className="row">
            <label>Context token budget</label>
            <input
              type="number"
              value={st.contextTokenLimit}
              onChange={(e) => setSt({ ...st, contextTokenLimit: Number(e.target.value) || 12000 })}
              disabled={busy}
            />
          </div>
          <div className="row">
            <label>Keep last N msgs (summary)</label>
            <input
              type="number"
              value={st.summaryKeepLastMessages}
              onChange={(e) => setSt({ ...st, summaryKeepLastMessages: Number(e.target.value) || 16 })}
              disabled={busy}
            />
          </div>
          <div className="row">
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void testConn()}>
              Test connection
            </button>
            {testMsg ? <span className="muted small">{testMsg}</span> : null}
          </div>
        </>
      ) : null}

      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>

      <div className="ai-usage-chart">
        <div className="settings-section-title" style={{ marginTop: 16 }}>
          Token usage (30 days)
        </div>
        <div className="ai-usage-bars" aria-label="usage by day">
          {series.map((p) => (
            <div key={p.day} className="ai-usage-bar-wrap" title={`${p.day}: ${p.totalTokens} tokens`}>
              <div className="ai-usage-bar" style={{ height: `${Math.max(4, (p.totalTokens / maxTok) * 100)}%` }} />
              <span className="ai-usage-day">{p.day?.slice(5) ?? ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
