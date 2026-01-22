import { useCallback, useMemo, useState } from "react";
import { SplitView } from "../components/SplitView";
import { pickSessionIcon } from "../utils/sessionTag";
import { demoGroups, demoMacros, demoPlaces, demoProfiles } from "./demo/data";
import { DEFAULT_REMOTE } from "./demo/files";
import { emitTerminalLine, unregisterTerminalSession } from "./demo/terminal";
import type { DashboardSession, FilesSession, Profile, ProfileGroup, TerminalSession } from "./types";
import { PromoConnectionsPanel } from "./components/PromoConnectionsPanel";
import { PromoTerminalTabs } from "./components/PromoTerminalTabs";
import { PromoFilesTabs } from "./components/PromoFilesTabs";
import { PromoDashboardTabs } from "./components/PromoDashboardTabs";
import { PromoPlacesPanel } from "./components/PromoPlacesPanel";
import { PromoMacrosPanel } from "./components/PromoMacrosPanel";

export function AppPromo() {
  const [groups] = useState<ProfileGroup[]>(demoGroups);
  const [profiles] = useState<Profile[]>(demoProfiles);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>(() => demoGroups.map((g) => g.id));

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [fileSessions, setFileSessions] = useState<FilesSession[]>([]);
  const [activeFileSessionId, setActiveFileSessionId] = useState<string | null>(null);

  const [dashboardSessions, setDashboardSessions] = useState<DashboardSession[]>([]);
  const [activeDashboardSessionId, setActiveDashboardSessionId] = useState<string | null>(null);

  const [rightMode, setRightMode] = useState<"terminal" | "files" | "dashboard">("terminal");
  const [leftMode, setLeftMode] = useState<"connections" | "places" | "macros">("connections");
  const [placesProfileId, setPlacesProfileId] = useState<string | null>(null);
  const [macrosProfileId, setMacrosProfileId] = useState<string | null>(null);

  const openTerminalForProfile = useCallback((profileId: string) => {
    const existing = sessions.filter((s) => s.profileId === profileId);
    const sessionId = `t-${profileId}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const icon = pickSessionIcon(sessionId, existing.map((s) => s.icon));
    const ordinal = existing.length + 1;
    const next: TerminalSession = { sessionId, profileId, icon, ordinal, marker: "green" };
    setSessions((prev) => [...prev, next]);
    setActiveSessionId(sessionId);
    setRightMode("terminal");
    return sessionId;
  }, [sessions]);

  const openFilesForProfile = useCallback(
    (profileId: string, remotePath?: string) => {
      const sessionId = `f-${profileId}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      const existing = fileSessions.filter((s) => s.profileId === profileId);
      const icon = pickSessionIcon(sessionId, existing.map((s) => s.icon));
      const ordinal = existing.length + 1;
      const next: FilesSession = {
        sessionId,
        profileId,
        icon,
        ordinal,
        remotePath: remotePath || DEFAULT_REMOTE,
        marker: "files",
      };
      setFileSessions((prev) => [...prev, next]);
      setActiveFileSessionId(sessionId);
      setRightMode("files");
      return sessionId;
    },
    [fileSessions]
  );

  const openDashboardForProfile = useCallback(
    (profileId: string) => {
      const existing = dashboardSessions.find((s) => s.profileId === profileId);
      if (existing) {
        setActiveDashboardSessionId(existing.sessionId);
        setRightMode("dashboard");
        return existing.sessionId;
      }
      const sessionId = `d-${profileId}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      const icon = pickSessionIcon(sessionId, dashboardSessions.map((s) => s.icon));
      const next: DashboardSession = { sessionId, profileId, icon, ordinal: 1, marker: "purple" };
      setDashboardSessions((prev) => [...prev, next]);
      setActiveDashboardSessionId(sessionId);
      setRightMode("dashboard");
      return sessionId;
    },
    [dashboardSessions]
  );

  const closeTerminalSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.sessionId === sessionId);
      const next = prev.filter((s) => s.sessionId !== sessionId);
      unregisterTerminalSession(sessionId);
      setActiveSessionId((cur) => {
        if (cur !== sessionId) return cur;
        if (next.length === 0) return null;
        const pick = Math.min(idx, next.length - 1);
        return next[pick].sessionId;
      });
      return next;
    });
  }, []);

  const closeFilesSession = useCallback((sessionId: string) => {
    setFileSessions((prev) => {
      const idx = prev.findIndex((s) => s.sessionId === sessionId);
      const next = prev.filter((s) => s.sessionId !== sessionId);
      setActiveFileSessionId((cur) => {
        if (cur !== sessionId) return cur;
        if (next.length === 0) return null;
        const pick = Math.min(idx, next.length - 1);
        return next[pick].sessionId;
      });
      return next;
    });
  }, []);

  const closeDashboardSession = useCallback((sessionId: string) => {
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

  const openPlacesForProfile = useCallback((profileId: string) => {
    setPlacesProfileId(profileId);
    setLeftMode("places");
  }, []);

  const openMacrosForProfile = useCallback((profileId: string) => {
    setMacrosProfileId(profileId);
    setLeftMode("macros");
  }, []);

  const onToggleGroup = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }, []);

  const onOpenTerminalAtProfile = useCallback((profileId: string) => {
    openTerminalForProfile(profileId);
  }, [openTerminalForProfile]);

  const onOpenFilesAtProfile = useCallback((profileId: string) => {
    openFilesForProfile(profileId);
  }, [openFilesForProfile]);

  const onOpenDashboardAtProfile = useCallback((profileId: string) => {
    openDashboardForProfile(profileId);
  }, [openDashboardForProfile]);

  const onShowFilesFromTerminal = useCallback(
    (sessionId: string) => {
      const s = sessions.find((x) => x.sessionId === sessionId);
      if (!s) return;
      openFilesForProfile(s.profileId);
    },
    [sessions, openFilesForProfile]
  );

  const onPlacesGoTerminal = useCallback(
    (remotePath: string) => {
      if (!placesProfileId) return;
      const sid = openTerminalForProfile(placesProfileId);
      emitTerminalLine(sid, `cd ${remotePath}`);
    },
    [placesProfileId, openTerminalForProfile]
  );

  const onPlacesGoFiles = useCallback(
    (remotePath: string) => {
      if (!placesProfileId) return;
      const sid = openFilesForProfile(placesProfileId, remotePath);
      setActiveFileSessionId(sid);
    },
    [placesProfileId, openFilesForProfile]
  );

  const onMacroRun = useCallback(
    (macro: { preview: string }) => {
      if (!macrosProfileId) return;
      const sid = openTerminalForProfile(macrosProfileId);
      emitTerminalLine(sid, macro.preview);
    },
    [macrosProfileId, openTerminalForProfile]
  );

  const sidebar =
    leftMode === "connections" ? (
      <PromoConnectionsPanel
        groups={groups}
        profiles={profiles}
        expandedGroupIds={expandedGroupIds}
        onToggleGroup={onToggleGroup}
        sessions={sessions}
        fileSessions={fileSessions}
        dashboardSessions={dashboardSessions}
        activeSessionId={activeSessionId}
        activeFileSessionId={activeFileSessionId}
        activeDashboardSessionId={activeDashboardSessionId}
        rightMode={rightMode}
        onOpenTerminal={onOpenTerminalAtProfile}
        onOpenFiles={onOpenFilesAtProfile}
        onOpenDashboard={onOpenDashboardAtProfile}
        onActivateTerminal={(sid) => {
          setActiveSessionId(sid);
          setRightMode("terminal");
        }}
        onActivateFiles={(sid) => {
          setActiveFileSessionId(sid);
          setRightMode("files");
        }}
        onActivateDashboard={(sid) => {
          setActiveDashboardSessionId(sid);
          setRightMode("dashboard");
        }}
        onCloseTerminal={closeTerminalSession}
        onCloseFiles={closeFilesSession}
        onCloseDashboard={closeDashboardSession}
      />
    ) : leftMode === "places" && placesProfileId ? (
      <PromoPlacesPanel
        profileId={placesProfileId}
        profiles={profiles}
        places={demoPlaces}
        onBack={() => setLeftMode("connections")}
        onGoTerminal={onPlacesGoTerminal}
        onGoFiles={onPlacesGoFiles}
      />
    ) : leftMode === "macros" && macrosProfileId ? (
      <PromoMacrosPanel
        profileId={macrosProfileId}
        profiles={profiles}
        macros={demoMacros}
        onBack={() => setLeftMode("connections")}
        onRun={onMacroRun}
      />
    ) : (
      <div className="panel">
        <div className="panel-titlebar">
          <div className="panel-title">Panel</div>
          <div className="panel-meta">no active profile</div>
        </div>
      </div>
    );

  const rightPane = (
    <div className="rightstack">
      <div className={`rightstack-pane ${rightMode === "terminal" ? "active" : ""}`}>
        <PromoTerminalTabs
          profiles={profiles}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onActivate={setActiveSessionId}
          onClose={closeTerminalSession}
          onShowFiles={onShowFilesFromTerminal}
          onOpenPlaces={openPlacesForProfile}
          onOpenMacros={openMacrosForProfile}
        />
      </div>
      <div className={`rightstack-pane ${rightMode === "files" ? "active" : ""}`}>
        <PromoFilesTabs
          profiles={profiles}
          sessions={fileSessions}
          activeSessionId={activeFileSessionId}
          onActivate={setActiveFileSessionId}
          onClose={closeFilesSession}
          onRemotePathChange={(sessionId, next) =>
            setFileSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, remotePath: next } : s)))
          }
        />
      </div>
      <div className={`rightstack-pane ${rightMode === "dashboard" ? "active" : ""}`}>
        <PromoDashboardTabs
          profiles={profiles}
          sessions={dashboardSessions}
          activeSessionId={activeDashboardSessionId}
          onActivate={(sid) => {
            setActiveDashboardSessionId(sid);
            setRightMode("dashboard");
          }}
          onClose={closeDashboardSession}
        />
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-name">daimon</span>
          <span className="brand-sub">terminal demo</span>
        </div>
        <div className="topbar-actions" />
      </div>

      <div className="content">
        <div className="app-grid">
          <SplitView left={sidebar} right={rightPane} initialLeftPct={34} minLeftPx={340} minRightPx={420} />
        </div>
      </div>
    </div>
  );
}
