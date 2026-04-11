import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import { SplitView } from "./components/SplitView";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { TerminalTabs, type TerminalSession } from "./components/TerminalTabs";
import type { MacroDTO, PlaceDTO, ProfileDTO, ProfileGroupDTO } from "./types/models";
import { fetchProfilesAndGroups } from "./components/ConnectionsPanel";
import { onSSHOutput, onSSHState, onTaskState, startSSHEventBridge } from "./ssh/events";
import type { SSHStateEvent } from "./types/ssh";
import { onSFTPState, startSFTPEventBridge } from "./sftp/events";
import {
  LoadUILayout,
  SaveUILayout,
  SSHConnectProfile,
  SSHSend,
  SFTPConnectProfile,
  UpsertPlace,
  UpsertMacro,
  GetAiSettings,
} from "../wailsjs/go/main/App";
import { main } from "../wailsjs/go/models";
import { AgentPanel } from "./components/AgentPanel";
import type { AgentContext } from "./types/agent";
import { pickSessionIcon } from "./utils/sessionTag";
import { FilesTabs, type FilesSession } from "./components/FilesTabs";
import { PlacesPanel } from "./components/PlacesPanel";
import { MacrosPanel } from "./components/MacrosPanel";
import { MacroEditorModal } from "./components/MacroEditorModal";
import { MacroRunModal } from "./components/MacroRunModal";
import { DashboardTabs } from "./components/DashboardTabs";
import { DockerMode } from "./components/docker/DockerMode";
import { WindowControls } from "./components/WindowControls";
import { SecretsModal } from "./components/SecretsModal";
import { SettingsPage } from "./components/SettingsPage";
import { LogsWorkspace } from "./components/LogsWorkspace";

type FilesLastPathsByProfile = Record<string, { localPath: string; remotePath: string }>;

export type DashboardSession = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  marker: "purple" | "gray";
  lastError?: string | null;
};

function shellQuote(p: string) {
  // single-quote for POSIX shells: ' -> '\'' (close/open trick)
  const s = String(p ?? "");
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function App() {
  const [appMode, setAppMode] = useState<"connections" | "docker" | "logs" | "settings">("connections");
  const [groups, setGroups] = useState<ProfileGroupDTO[]>([]);
  const [profiles, setProfiles] = useState<ProfileDTO[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const hasPersistedExpandedGroupsRef = useRef(false);
  const didAutoExpandGroupsRef = useRef(false);

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [fileSessions, setFileSessions] = useState<FilesSession[]>([]);
  const [activeFileSessionId, setActiveFileSessionId] = useState<string | null>(null);
  const [dashboardSessions, setDashboardSessions] = useState<DashboardSession[]>([]);
  const [activeDashboardSessionId, setActiveDashboardSessionId] = useState<string | null>(null);

  const [rightMode, setRightMode] = useState<"terminal" | "files" | "dashboard">("terminal");
  const [filesLastPathsByProfile, setFilesLastPathsByProfile] = useState<FilesLastPathsByProfile>({});
  const fileSessionsRef = useRef<FilesSession[]>([]);

  const [leftMode, setLeftMode] = useState<"connections" | "places" | "macros">("connections");
  const [placesProfileId, setPlacesProfileId] = useState<string | null>(null);
  const [placesRefreshToken, setPlacesRefreshToken] = useState(0);
  const [placeModal, setPlaceModal] = useState<{ open: boolean; id?: string; profileId: string; name: string; remotePath: string }>({
    open: false,
    profileId: "",
    name: "",
    remotePath: "",
  });

  const [macrosProfileId, setMacrosProfileId] = useState<string | null>(null);
  const [macrosRefreshToken, setMacrosRefreshToken] = useState(0);
  const [macroEditorOpen, setMacroEditorOpen] = useState(false);
  const [macroEditorMacro, setMacroEditorMacro] = useState<MacroDTO | null>(null);
  const [macroRunOpen, setMacroRunOpen] = useState(false);
  const [macroRunMacro, setMacroRunMacro] = useState<MacroDTO | null>(null);
  const [secretsModal, setSecretsModal] = useState<{ open: boolean; profileId: string | null }>({ open: false, profileId: null });

  const [navToRemoteBySessionId, setNavToRemoteBySessionId] = useState<Record<string, { path: string; token: number }>>({});

  const [aiSettings, setAiSettings] = useState<main.AiSettingsDTO | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentActiveConversationId, setAgentActiveConversationId] = useState<string | null>(null);
  const [dockerAgentCtx, setDockerAgentCtx] = useState<AgentContext>({
    mode: "docker",
    sessionId: "",
    profileId: "",
    dockerScope: "",
    containerId: "",
  });

  const refreshAiSettings = useCallback(() => {
    void GetAiSettings().then(setAiSettings).catch(() => setAiSettings(null));
  }, []);

  useEffect(() => {
    refreshAiSettings();
  }, [appMode, refreshAiSettings]);

  useEffect(() => {
    const fn = () => refreshAiSettings();
    window.addEventListener("daimon-ai-settings-changed", fn);
    return () => window.removeEventListener("daimon-ai-settings-changed", fn);
  }, [refreshAiSettings]);

  const connectionsAgentCtx = useMemo((): AgentContext => {
    const s = sessions.find((x) => x.sessionId === activeSessionId);
    return {
      mode: "connections",
      sessionId: activeSessionId ?? "",
      profileId: s?.profileId ?? "",
      dockerScope: "",
      containerId: "",
    };
  }, [sessions, activeSessionId]);

  const agentContextForPanel = useMemo((): AgentContext => {
    if (appMode === "connections") return connectionsAgentCtx;
    if (appMode === "docker") return dockerAgentCtx;
    return { mode: "logs", sessionId: "", profileId: "", dockerScope: "", containerId: "" };
  }, [appMode, connectionsAgentCtx, dockerAgentCtx]);

  const aiAgentEnabled = aiSettings?.integrationType === "openai_compatible";

  useEffect(() => {
    fileSessionsRef.current = fileSessions;
  }, [fileSessions]);

  const openPlacesForProfile = useCallback((profileId: string) => {
    if (!profileId) return;
    setPlacesProfileId(profileId);
    setLeftMode("places");
  }, []);

  const openMacrosForProfile = useCallback((profileId: string) => {
    if (!profileId) return;
    setMacrosProfileId(profileId);
    setLeftMode("macros");
  }, []);

  const openSecretsForProfile = useCallback((profileId: string) => {
    if (!profileId) return;
    setSecretsModal({ open: true, profileId });
  }, []);

  const refresh = useCallback(async () => {
    const r = await fetchProfilesAndGroups();
    setGroups(r.groups);
    setProfiles(r.profiles);
    // Expand all by default once ONLY when there's no persisted preference.
    // Important: do NOT re-expand just because the user collapsed all groups.
    setExpandedGroupIds((prev) => {
      if (prev.length > 0) return prev;
      if (hasPersistedExpandedGroupsRef.current) return prev;
      if (didAutoExpandGroupsRef.current) return prev;
      if (r.groups.length === 0) return prev;
      didAutoExpandGroupsRef.current = true;
      return r.groups.map((g) => g.id);
    });
  }, []);

  useEffect(() => {
    startSSHEventBridge();
    startSFTPEventBridge();
  }, []);

  // layout persistence (MVP): expanded groups + last active tab
  useEffect(() => {
    const load = async () => {
      const raw = await LoadUILayout("app");
      try {
        const v = JSON.parse(raw);
        const nextMode = v?.appMode;
        if (nextMode === "connections" || nextMode === "docker" || nextMode === "logs" || nextMode === "settings") {
          setAppMode(nextMode);
        }
        if (Array.isArray(v?.expandedGroupIds)) {
          hasPersistedExpandedGroupsRef.current = true;
          setExpandedGroupIds(v.expandedGroupIds);
        }
        if (v?.filesLastPathsByProfile && typeof v.filesLastPathsByProfile === "object") {
          setFilesLastPathsByProfile(v.filesLastPathsByProfile as FilesLastPathsByProfile);
        }
      } catch {
        // ignore
      }
    };
    void load().finally(() => {
      // First fetch after we tried to load persisted UI state.
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const t = setTimeout(() => {
      const payload = JSON.stringify({ version: 3, appMode, expandedGroupIds, filesLastPathsByProfile });
      void SaveUILayout("app", payload);
    }, 250);
    return () => clearTimeout(t);
  }, [appMode, expandedGroupIds, filesLastPathsByProfile]);

  // Update session markers from ssh:state events
  useEffect(() => {
    const unsub = onSSHState((ev: SSHStateEvent) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.sessionId !== ev.id) return s;
          if (ev.state === "connected") return { ...s, marker: "green", lastError: null };
          return { ...s, marker: "gray", lastError: ev.error ?? null, taskRunning: false };
        })
      );
      setDashboardSessions((prev) =>
        prev.map((s) => {
          if (s.sessionId !== ev.id) return s;
          if (ev.state === "connected") return { ...s, marker: "purple", lastError: null };
          return { ...s, marker: "gray", lastError: ev.error ?? null };
        })
      );
    });
    return () => unsub();
  }, []);

  // Update file session markers from sftp:state events
  useEffect(() => {
    const unsub = onSFTPState((ev) => {
      setFileSessions((prev) =>
        prev.map((s) => {
          if (s.sessionId !== ev.id) return s;
          if (ev.state === "connected") return { ...s, marker: "files", lastError: null };
          return { ...s, marker: "gray", lastError: ev.error ?? s.lastError ?? null };
        })
      );
    });
    return () => unsub();
  }, []);

  // Yellow marker for running tasks
  useEffect(() => {
    const unsub = onTaskState((ev) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.sessionId !== ev.sessionId) return s;
          if (ev.state === "running") return { ...s, marker: "yellow", taskRunning: true };
          // on completion: revert to green unless session was already disconnected
          const nextMarker = s.marker === "gray" ? "gray" : "green";
          return { ...s, marker: nextMarker, taskRunning: false, lastError: ev.error ?? s.lastError ?? null };
        })
      );
    });
    return () => unsub();
  }, []);

  const onToggleGroup = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  }, []);

  const openSession = useCallback((sessionId: string, profileId: string) => {
    setSessions((prev) => {
      const existingForProfile = prev.filter((s) => s.profileId === profileId);
      const icon = pickSessionIcon(sessionId, existingForProfile.map((s) => s.icon));
      const ordinal = existingForProfile.length + 1;
      return [
        ...prev,
        {
          sessionId,
          profileId,
          icon,
          ordinal,
          marker: "green",
        },
      ];
    });
    setActiveSessionId(sessionId);
    setRightMode("terminal");
  }, []);

  const ensureTerminalSession = useCallback(
    async (profileId: string) => {
      let sid = sessions.find((s) => s.profileId === profileId)?.sessionId ?? null;
      if (!sid) {
        sid = await SSHConnectProfile(profileId);
        openSession(sid, profileId);
      } else {
        setActiveSessionId(sid);
        setRightMode("terminal");
      }
      return sid;
    },
    [openSession, sessions]
  );

  const openDashboardSession = useCallback((sessionId: string, profileId: string) => {
    setDashboardSessions((prev) => {
      // singleton per profile
      const existing = prev.find((s) => s.profileId === profileId);
      if (existing) return prev;
      const icon = pickSessionIcon(sessionId, prev.map((s) => s.icon));
      return [
        ...prev,
        {
          sessionId,
          profileId,
          icon,
          ordinal: 1,
          marker: "purple",
        },
      ];
    });
    setActiveDashboardSessionId(sessionId);
    setRightMode("dashboard");
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    setActiveSessionId((cur) => {
      if (cur !== sessionId) return cur;
      // compute next based on current sessions (before removal) via functional update below
      return cur;
    });
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.sessionId === sessionId);
      const next = prev.filter((s) => s.sessionId !== sessionId);
      setActiveSessionId((cur) => {
        if (cur !== sessionId) return cur;
        // choose neighbor tab if possible
        if (next.length === 0) return null;
        const pick = Math.min(idx, next.length - 1);
        return next[pick].sessionId;
      });
      return next;
    });
  }, []);

  const closeDashboardSession = useCallback((sessionId: string) => {
    setActiveDashboardSessionId((cur) => (cur === sessionId ? null : cur));
    setDashboardSessions((prev) => {
      const idx = prev.findIndex((s) => s.sessionId === sessionId);
      const next = prev.filter((s) => s.sessionId !== sessionId);
      setActiveDashboardSessionId((cur) => {
        if (cur !== sessionId) return cur;
        if (next.length === 0) return null;
        const pick = Math.min(idx, next.length - 1);
        return next[pick].sessionId;
      });
      return next;
    });
  }, []);

  const sidebar =
    leftMode === "connections" ? (
      <ConnectionsPanel
        groups={groups}
        profiles={profiles}
        expandedGroupIds={expandedGroupIds}
        onToggleGroup={onToggleGroup}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onOpenSession={openSession}
        onActivateSession={(sid) => {
          setActiveSessionId(sid);
          setRightMode("terminal");
        }}
        onCloseSession={closeSession}
        onFilesMode={() => setRightMode("files")}
        onTerminalMode={() => setRightMode("terminal")}
        onDashboardMode={() => setRightMode("dashboard")}
        fileSessions={fileSessions}
        activeFileSessionId={activeFileSessionId}
        rightMode={rightMode}
        dashboardSessions={dashboardSessions}
        activeDashboardSessionId={activeDashboardSessionId}
        onOpenDashboardSession={openDashboardSession}
        onActivateDashboardSession={(sid) => {
          setActiveDashboardSessionId(sid);
          setRightMode("dashboard");
        }}
        onCloseDashboardSession={closeDashboardSession}
        onOpenFileSession={(sessionId, profileId) => {
          setFileSessions((prev) => {
            const existingForProfile = prev.filter((s) => s.profileId === profileId);
            const icon = pickSessionIcon(sessionId, existingForProfile.map((s) => s.icon));
            const ordinal = existingForProfile.length + 1;
            const remotePath = filesLastPathsByProfile[profileId]?.remotePath ?? ".";
            return [...prev, { sessionId, profileId, icon, ordinal, remotePath, marker: "files" as const, lastError: null }];
          });
          setActiveFileSessionId(sessionId);
          setRightMode("files");
        }}
        onActivateFileSession={(sessionId) => {
          setActiveFileSessionId(sessionId);
          setRightMode("files");
        }}
        onCloseFileSession={(sessionId) => {
          setFileSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
          setActiveFileSessionId((cur) => (cur === sessionId ? null : cur));
        }}
        onDataChanged={refresh}
      />
    ) : leftMode === "places" && placesProfileId ? (
      <PlacesPanel
        profileId={placesProfileId}
        profiles={profiles}
        refreshToken={placesRefreshToken}
        onBack={() => setLeftMode("connections")}
        onAddNew={() => setPlaceModal({ open: true, profileId: placesProfileId, name: "", remotePath: "" })}
        onEdit={(p: PlaceDTO) => setPlaceModal({ open: true, id: p.id, profileId: p.profileId, name: p.name ?? "", remotePath: p.remotePath })}
        onGoTerminal={async (remotePath) => {
          const profId = placesProfileId;
          if (!profId) return;
          let sid = sessions.find((s) => s.profileId === profId)?.sessionId ?? null;
          if (!sid) {
            sid = await SSHConnectProfile(profId);
            openSession(sid, profId);
          } else {
            setActiveSessionId(sid);
            setRightMode("terminal");
          }
          setTimeout(() => void SSHSend(sid!, `cd ${shellQuote(remotePath)}\n`), 200);
        }}
        onGoFiles={async (remotePath) => {
          const profId = placesProfileId;
          if (!profId) return;
          const existing = fileSessionsRef.current.find((s) => s.profileId === profId) ?? null;
          let sid = existing?.sessionId ?? null;
          if (!sid) {
            sid = await SFTPConnectProfile(profId);
            setFileSessions((prev) => {
              const existingForProfile = prev.filter((s) => s.profileId === profId);
              const icon = pickSessionIcon(sid!, existingForProfile.map((s) => s.icon));
              const ordinal = existingForProfile.length + 1;
              return [...prev, { sessionId: sid!, profileId: profId, icon, ordinal, remotePath, marker: "files" as const, lastError: null }];
            });
          }
          setActiveFileSessionId(sid);
          setRightMode("files");
          setNavToRemoteBySessionId((prev) => ({ ...prev, [sid!]: { path: remotePath, token: Date.now() } }));
        }}
      />
    ) : leftMode === "macros" && macrosProfileId ? (
      <MacrosPanel
        profileId={macrosProfileId}
        refreshToken={macrosRefreshToken}
        onBack={() => setLeftMode("connections")}
        onCreate={() => {
          setMacroEditorMacro(null);
          setMacroEditorOpen(true);
        }}
        onEdit={(m) => {
          setMacroEditorMacro(m);
          setMacroEditorOpen(true);
        }}
        onRun={(m) => {
          setMacroRunMacro(m);
          setMacroRunOpen(true);
        }}
      />
    ) : (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Panel</div>
          <div className="panel-meta">no active profile</div>
        </div>
      </div>
    );

  // Keep both mounted so switching modes doesn't reset terminal output.
  const rightPane = (
    <div className="rightstack">
      <div className={`rightstack-pane ${rightMode === "terminal" ? "active" : ""}`}>
        <TerminalTabs
          profiles={profiles}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onActivate={setActiveSessionId}
          onClose={closeSession}
          onShowPwd={async (sshSessionId) => {
            const cur = sessions.find((s) => s.sessionId === sshSessionId);
            if (!cur) return;
            const pwd = await queryPwdFromTerminal(sshSessionId);
            const remotePath = (pwd || ".").trim() || ".";

            const sid = await SFTPConnectProfile(cur.profileId);
            setFileSessions((prev) => {
              const existingForProfile = prev.filter((s) => s.profileId === cur.profileId);
              const icon = pickSessionIcon(sid, existingForProfile.map((s) => s.icon));
              const ordinal = existingForProfile.length + 1;
              return [...prev, { sessionId: sid, profileId: cur.profileId, icon, ordinal, remotePath, marker: "files" as const, lastError: null }];
            });
            setFilesLastPathsByProfile((prev) => ({ ...prev, [cur.profileId]: { localPath: prev[cur.profileId]?.localPath ?? "", remotePath } }));
            setActiveFileSessionId(sid);
            setRightMode("files");
          }}
          onOpenPlaces={(profileId) => openPlacesForProfile(profileId)}
          onOpenMacros={(profileId) => openMacrosForProfile(profileId)}
          onOpenSecrets={(profileId) => openSecretsForProfile(profileId)}
          onAddLocation={async (sshSessionId, profileId) => {
            const pwd = await queryPwdFromTerminal(sshSessionId);
            const remotePath = (pwd || ".").trim() || ".";
            setPlaceModal({ open: true, profileId, name: "", remotePath });
            openPlacesForProfile(profileId);
          }}
        />
      </div>
      <div className={`rightstack-pane ${rightMode === "files" ? "active" : ""}`}>
        <FilesTabs
          profiles={profiles}
          sessions={fileSessions}
          activeSessionId={activeFileSessionId}
          onActivate={setActiveFileSessionId}
          onClose={(sid) => {
            setFileSessions((prev) => prev.filter((s) => s.sessionId !== sid));
            setActiveFileSessionId((cur) => (cur === sid ? null : cur));
          }}
          onSessionDisconnected={(sid, err) => {
            setFileSessions((prev) =>
              prev.map((s) => (s.sessionId === sid ? { ...s, marker: "gray" as const, lastError: err } : s))
            );
          }}
          initialPathsByProfile={filesLastPathsByProfile}
          onPathsChanged={(profileId, next) => {
            setFilesLastPathsByProfile((prev) => ({ ...prev, [profileId]: next }));
          }}
          onOpenTerminalAtPath={async (profileId, remotePath) => {
            try {
              const sid = await SSHConnectProfile(profileId);
              openSession(sid, profileId);
              setTimeout(() => {
                void SSHSend(sid, `cd ${shellQuote(remotePath)}\n`);
              }, 200);
            } catch (e) {
              // best-effort; FilesManager will show errors for its own operations
              console.error(e);
            }
          }}
          onSessionPathsChanged={(sessionId, next) => {
            setFileSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, remotePath: next.remotePath } : s)));
          }}
          onOpenPlaces={(profileId) => openPlacesForProfile(profileId)}
          onAddLocation={(profileId, remotePath) => {
            setPlaceModal({ open: true, profileId, name: "", remotePath: (remotePath || ".").trim() || "." });
            openPlacesForProfile(profileId);
          }}
          navToRemoteBySessionId={navToRemoteBySessionId}
        />
      </div>
      <div className={`rightstack-pane ${rightMode === "dashboard" ? "active" : ""}`}>
        <DashboardTabs
          profiles={profiles}
          sessions={dashboardSessions}
          activeSessionId={activeDashboardSessionId}
          onActivate={setActiveDashboardSessionId}
          onClose={closeDashboardSession}
        />
      </div>
    </div>
  );

  const connectionsContent = (
    <div className="app-mode-agent-wrap">
      <div className="app-mode-agent-main">
        <SplitView left={sidebar} right={rightPane} initialLeftPct={34} minLeftPx={340} minRightPx={420} />
      </div>
      {agentOpen && aiAgentEnabled && appMode === "connections" ? (
        <AgentPanel
          open={agentOpen}
          agentContext={agentContextForPanel}
          activeConversationId={agentActiveConversationId}
          onActiveConversationIdChange={setAgentActiveConversationId}
        />
      ) : null}
    </div>
  );

  const dockerContent = (
    <div className="app-mode-agent-wrap">
      <div className="app-mode-agent-main">
        <DockerMode profiles={profiles} groups={groups} onOpenSecrets={openSecretsForProfile} onAgentContext={setDockerAgentCtx} />
      </div>
      {agentOpen && aiAgentEnabled && appMode === "docker" ? (
        <AgentPanel
          open={agentOpen}
          agentContext={agentContextForPanel}
          activeConversationId={agentActiveConversationId}
          onActiveConversationIdChange={setAgentActiveConversationId}
        />
      ) : null}
    </div>
  );
  const logsContent = <LogsWorkspace profiles={profiles} />;
  const settingsContent = (
    <SettingsPage
      profiles={profiles}
      onCreateMacro={() => {
        setMacroEditorMacro(null);
        setMacroEditorOpen(true);
      }}
      onEditMacro={(m) => {
        setMacroEditorMacro(m);
        setMacroEditorOpen(true);
      }}
    />
  );

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-name">daimon</span>
          <div className="topbar-tabs" role="tablist" aria-label="App mode">
            <button
              className={`topbar-tab ${appMode === "connections" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={appMode === "connections"}
              onClick={() => setAppMode("connections")}
            >
              Connections
            </button>
            <button
              className={`topbar-tab ${appMode === "docker" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={appMode === "docker"}
              onClick={() => setAppMode("docker")}
            >
              Docker
            </button>
            <button
              className={`topbar-tab ${appMode === "logs" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={appMode === "logs"}
              onClick={() => setAppMode("logs")}
            >
              Logs
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          {aiAgentEnabled ? (
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
          <button className={`topbar-settings ${appMode === "settings" ? "active" : ""}`} type="button" onClick={() => setAppMode("settings")}>
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
          <div
            className="app-mode-pane"
            style={{ display: appMode === "connections" ? undefined : "none" }}
          >
            {connectionsContent}
          </div>
          <div
            className="app-mode-pane"
            style={{ display: appMode === "docker" ? undefined : "none" }}
          >
            {dockerContent}
          </div>
          <div
            className="app-mode-pane"
            style={{ display: appMode === "logs" ? undefined : "none" }}
          >
            {logsContent}
          </div>
          <div
            className="app-mode-pane"
            style={{ display: appMode === "settings" ? undefined : "none" }}
          >
            {settingsContent}
          </div>
        </div>
      </div>

      {placeModal.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{placeModal.id ? "Edit Place" : "Save Location"}</div>
            <div className="modal-body form">
              <div className="row">
                <label>Name (optional)</label>
                <input value={placeModal.name} onChange={(e) => setPlaceModal((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="row">
                <label>Remote path</label>
                <input className="mono" value={placeModal.remotePath} onChange={(e) => setPlaceModal((p) => ({ ...p, remotePath: e.target.value }))} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setPlaceModal({ open: false, profileId: "", name: "", remotePath: "" })}>
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const profileId = placeModal.profileId;
                  const remotePath = (placeModal.remotePath || "").trim();
                  if (!profileId || !remotePath) return;
                  await UpsertPlace({ id: placeModal.id, profileId, name: placeModal.name ?? "", remotePath, order: 0 } as any);
                  setPlaceModal({ open: false, profileId: "", name: "", remotePath: "" });
                  setPlacesRefreshToken((n) => n + 1);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <MacroEditorModal
        open={macroEditorOpen}
        macro={macroEditorMacro}
        onCancel={() => setMacroEditorOpen(false)}
        onSave={async (next) => {
          await UpsertMacro(next as any);
          setMacroEditorOpen(false);
          setMacrosRefreshToken((n) => n + 1);
        }}
      />

      <MacroRunModal
        open={macroRunOpen}
        macro={macroRunMacro}
        onCancel={() => setMacroRunOpen(false)}
        onRun={async (script) => {
          if (!macrosProfileId) return;
          const sid = await ensureTerminalSession(macrosProfileId);
          await SSHSend(sid, script + "\n");
          setMacroRunOpen(false);
        }}
      />

      <SecretsModal
        open={secretsModal.open}
        profileId={secretsModal.profileId}
        profiles={profiles}
        onClose={() => setSecretsModal({ open: false, profileId: null })}
      />
    </div>
  );
}

export default App;

async function queryPwdFromTerminal(sessionId: string): Promise<string> {
  // We intentionally avoid any marker echos; send a plain `pwd`.
  // This will echo `pwd` itself in the terminal, but won't spam extra marker lines.
  let buf = "";
  return await new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve("");
    }, 2500);

    const stripAnsi = (s: string) =>
      s
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") // CSI
        .replace(/\x1b\][^\x07]*\x07/g, "") // OSC
        .replace(/\x1b[()][A-Za-z0-9]/g, ""); // charset

    const unsub = onSSHOutput((ev) => {
      if (!ev || ev.id !== sessionId) return;
      buf += ev.data ?? "";
      if (buf.length > 64 * 1024) buf = buf.slice(-64 * 1024);
      const clean = stripAnsi(buf).replace(/\r/g, "");
      // Prefer last absolute path-looking token anywhere (works even if prompt contains :/path)
      const re = /(\/[^\s]+)/g;
      let m: RegExpExecArray | null = null;
      let last = "";
      while ((m = re.exec(clean))) last = m[1];
      const pathish = last
        // common prompt suffixes like "/var/www#"
        .replace(/[#$>]+$/, "")
        // just in case we captured "/path:#" variants
        .replace(/[:]+$/, "")
        .trim();
      if (pathish) {
        clearTimeout(timeout);
        unsub();
        resolve(pathish);
      }
    });

    void SSHSend(sessionId, "pwd\r");
  });
}
