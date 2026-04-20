import { useCallback, useEffect, useState } from "react";
import {
  AiTestOpenAIConnectionWithSettings,
  AiUsageSeries,
  GetAiSettings,
  SaveAiSettings,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { SETTINGS_REFRESH_ALL_EVENT } from "../settingsEvents";
import { DropdownSelect } from "./ui";

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

  useEffect(() => {
    const onRefreshAll = () => void load();
    window.addEventListener(SETTINGS_REFRESH_ALL_EVENT, onRefreshAll);
    return () => window.removeEventListener(SETTINGS_REFRESH_ALL_EVENT, onRefreshAll);
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
        preferredLanguage: st.preferredLanguage,
        developerModeEnabled: !!st.developerModeEnabled,
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
    if (!st) return;
    setTestMsg(null);
    setBusy(true);
    try {
      const settings = new main.AiSettingsDTO({
        integrationType: st.integrationType,
        baseURL: st.baseURL,
        model: st.model,
        preferredLanguage: st.preferredLanguage,
        developerModeEnabled: !!st.developerModeEnabled,
        maxTokensPerRequest: st.maxTokensPerRequest,
        contextTokenLimit: st.contextTokenLimit,
        summaryKeepLastMessages: st.summaryKeepLastMessages,
        apiKeySet: st.apiKeySet,
      });
      const req = new main.SaveAiSettingsRequest({ settings, apiKey: apiKeyDraft.trim() });
      await AiTestOpenAIConnectionWithSettings(req);
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
    <div className="settings-section settings-logs-general ai-mode-panel">
      <div className="settings-toolbar">
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
      {err ? <div className="error-text">{err}</div> : null}

      <div className="settings-section-title" style={{ marginTop: 4 }}>
        AI Mode
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        OpenAI-compatible API. The API key is stored in the OS keyring (or internal vault when selected in Secrets flows).
        Default integration is off.
      </p>

      <div className="settings-form-grid settings-logs-general-grid">
        <label className="settings-field">
          <span className="settings-field-label">Integration</span>
          <DropdownSelect
            className="settings-field-input"
            value={st.integrationType}
            disabled={busy}
            onChange={(v) => setSt({ ...st, integrationType: v })}
            options={[
              { value: "none", label: "None" },
              { value: "openai_compatible", label: "OpenAI compatible" },
            ]}
            aria-label="AI integration"
          />
        </label>

        {st.integrationType === "openai_compatible" ? (
          <>
            <label className="settings-field">
              <span className="settings-field-label">Base URL</span>
              <input
                className="settings-field-input mono"
                value={st.baseURL}
                onChange={(e) => setSt({ ...st, baseURL: e.target.value })}
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Model</span>
              <input
                className="settings-field-input"
                value={st.model}
                onChange={(e) => setSt({ ...st, model: e.target.value })}
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Preferred language</span>
              <input
                className="settings-field-input"
                value={st.preferredLanguage || ""}
                onChange={(e) => setSt({ ...st, preferredLanguage: e.target.value })}
                disabled={busy}
                placeholder="e.g. Russian, English, Deutsch"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">API key</span>
              <input
                className="settings-field-input"
                type="password"
                autoComplete="off"
                placeholder={st.apiKeySet ? "(unchanged — enter to replace)" : "(required)"}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Max tokens / request</span>
              <input
                className="settings-field-input"
                type="number"
                value={st.maxTokensPerRequest}
                onChange={(e) => setSt({ ...st, maxTokensPerRequest: Number(e.target.value) || 4096 })}
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Context token budget</span>
              <input
                className="settings-field-input"
                type="number"
                value={st.contextTokenLimit}
                onChange={(e) => setSt({ ...st, contextTokenLimit: Number(e.target.value) || 12000 })}
                disabled={busy}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Keep last N msgs (summary)</span>
              <input
                className="settings-field-input"
                type="number"
                value={st.summaryKeepLastMessages}
                onChange={(e) => setSt({ ...st, summaryKeepLastMessages: Number(e.target.value) || 16 })}
                disabled={busy}
              />
            </label>
            <div className="settings-field settings-field--full">
              <div className="settings-field-label">Connection check</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void testConn()}>
                  Test connection
                </button>
                {testMsg ? <span className="muted small">{testMsg}</span> : null}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="ai-usage-chart">
        <div className="settings-section-title" style={{ marginTop: 20 }}>
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
