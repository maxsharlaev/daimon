import { useState, type ReactNode } from "react";
import daimonLogo from "../assets/daimon-logo.png";
import { WindowControls } from "../components/WindowControls";
import { PromoConnectionsMode } from "./components/PromoConnectionsMode";
import { PromoLocalWorkspace } from "./components/PromoLocalWorkspace";
import { PromoDockerMode } from "./components/PromoDockerMode";
import { PromoLogsWorkspace } from "./components/PromoLogsWorkspace";
import { PromoDataWorkspace } from "./components/PromoDataWorkspace";
import { PromoSettingsPage } from "./components/PromoSettingsPage";
import { PromoAgentPanel } from "./components/PromoAgentPanel";

export type AppMode = "local" | "connections" | "docker" | "logs" | "data" | "settings";

function AgentWrap({ open, contextLabel, children }: { open: boolean; contextLabel: string; children: ReactNode }) {
  if (!open) return <>{children}</>;
  return (
    <div className="app-mode-agent-wrap">
      <div className="app-mode-agent-main">{children}</div>
      <PromoAgentPanel contextLabel={contextLabel} />
    </div>
  );
}

export function AppPromo() {
  const [appMode, setAppMode] = useState<AppMode>("local");
  const [agentOpen, setAgentOpen] = useState(false);

  const agentContext = appMode === "docker" ? "myapp · container" : "web-01 · deploy@10.0.1.10";
  const showAgent = appMode === "connections" || appMode === "docker";

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <img src={daimonLogo} alt="" className="brand-logo" aria-hidden />
            <span className="brand-name">daimon</span>
          </div>
          <div className="topbar-tabs" role="tablist" aria-label="App mode">
            {(
              [
                ["local", "Local"],
                ["connections", "Connections"],
                ["docker", "Docker"],
                ["logs", "Logs"],
                ["data", "Data"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                className={`topbar-tab ${appMode === mode ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={appMode === mode}
                onClick={() => setAppMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="topbar-actions">
          {showAgent ? (
            <button
              className={`topbar-agent ${agentOpen ? "active" : ""}`}
              type="button"
              title={agentOpen ? "Close AI Agent" : "Open AI Agent"}
              aria-pressed={agentOpen}
              onClick={() => setAgentOpen((o) => !o)}
            >
              Agent
            </button>
          ) : null}
          <button
            className={`topbar-settings ${appMode === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => setAppMode("settings")}
          >
            <span className="topbar-settings-icon" aria-hidden="true">
              ⚙
            </span>
            Settings
          </button>
          <WindowControls />
        </div>
      </div>

      <div className="content">
        <div className="app-grid">
          <div className="app-mode-pane" style={{ display: appMode === "local" ? undefined : "none" }}>
            <PromoLocalWorkspace />
          </div>
          <div className="app-mode-pane" style={{ display: appMode === "connections" ? undefined : "none" }}>
            <AgentWrap open={agentOpen && appMode === "connections"} contextLabel={agentContext}>
              <PromoConnectionsMode agentOpen={agentOpen && appMode === "connections"} />
            </AgentWrap>
          </div>
          <div className="app-mode-pane" style={{ display: appMode === "docker" ? undefined : "none" }}>
            <AgentWrap open={agentOpen && appMode === "docker"} contextLabel={agentContext}>
              <PromoDockerMode agentOpen={agentOpen && appMode === "docker"} />
            </AgentWrap>
          </div>
          <div className="app-mode-pane" style={{ display: appMode === "logs" ? undefined : "none" }}>
            <PromoLogsWorkspace />
          </div>
          <div className="app-mode-pane" style={{ display: appMode === "data" ? undefined : "none" }}>
            <PromoDataWorkspace />
          </div>
          <div className="app-mode-pane" style={{ display: appMode === "settings" ? undefined : "none" }}>
            <PromoSettingsPage />
          </div>
        </div>
      </div>
    </div>
  );
}
