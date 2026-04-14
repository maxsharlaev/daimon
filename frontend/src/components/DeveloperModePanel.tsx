import { useEffect, useState } from "react";
import { GetAiSettings, SaveAiSettings } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

type Props = {
  onModeChanged?: (enabled: boolean) => void;
};

export function DeveloperModePanel({ onModeChanged }: Props) {
  const [st, setSt] = useState<main.AiSettingsDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const s = await GetAiSettings();
      setSt(s);
      onModeChanged?.(!!s?.developerModeEnabled);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setSt(null);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await SaveAiSettings(new main.SaveAiSettingsRequest({ settings, apiKey: "" }));
      onModeChanged?.(!!st.developerModeEnabled);
      window.dispatchEvent(new CustomEvent("daimon-ai-settings-changed"));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!st) return <div className="settings-section muted">Loading developer settings…</div>;

  return (
    <div className="settings-section settings-logs-general">
      <div className="settings-section-title">Developer Mode</div>
      <p className="muted small">Enable internal diagnostics and debug views. Intended for troubleshooting and support.</p>
      {err ? <div className="error-text">{err}</div> : null}
      <div className="settings-field settings-field--full">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!st.developerModeEnabled}
            onChange={(e) => setSt({ ...st, developerModeEnabled: e.target.checked })}
            disabled={busy}
          />
          Enable developer mode
        </label>
        <p className="settings-field-hint">Shows developer diagnostics and debug panels (AI Logs, raw per-call traces).</p>
      </div>
      <div className="settings-toolbar">
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

