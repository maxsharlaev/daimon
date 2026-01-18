import { useCallback, useEffect, useState } from "react";
import "./App.css";

import { SplitView } from "./components/SplitView";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { TerminalTabs, type TerminalSession } from "./components/TerminalTabs";
import type { ProfileDTO, ProfileGroupDTO } from "./types/models";
import { fetchProfilesAndGroups } from "./components/ConnectionsPanel";
import { onSSHState, onTaskState, startSSHEventBridge } from "./ssh/events";
import type { SSHStateEvent } from "./types/ssh";
import { SaveUILayout, LoadUILayout } from "../wailsjs/go/main/App";
import { pickSessionIcon } from "./utils/sessionTag";

function App() {
  const [groups, setGroups] = useState<ProfileGroupDTO[]>([]);
  const [profiles, setProfiles] = useState<ProfileDTO[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetchProfilesAndGroups();
    setGroups(r.groups);
    setProfiles(r.profiles);
    // expand all by default once
    if (expandedGroupIds.length === 0 && r.groups.length > 0) {
      setExpandedGroupIds(r.groups.map((g) => g.id));
    }
  }, [expandedGroupIds.length]);

  useEffect(() => {
    startSSHEventBridge();
    void refresh();
  }, [refresh]);

  // layout persistence (MVP): expanded groups + last active tab
  useEffect(() => {
    const load = async () => {
      const raw = await LoadUILayout("app");
      try {
        const v = JSON.parse(raw);
        if (Array.isArray(v?.expandedGroupIds)) setExpandedGroupIds(v.expandedGroupIds);
      } catch {
        // ignore
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({ version: 1, expandedGroupIds });
    void SaveUILayout("app", payload);
  }, [expandedGroupIds]);

  // Update session markers from ssh:state events
  useEffect(() => {
    const unsub = onSSHState((ev: SSHStateEvent) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.sessionId !== ev.id) return s;
          if (ev.state === "connected") return { ...s, marker: "green", lastError: null };
          return { ...s, marker: "red", lastError: ev.error ?? null, taskRunning: false };
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
          // on completion: revert to green unless session was already red
          const nextMarker = s.marker === "red" ? "red" : "green";
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

  const sidebar = (
    <ConnectionsPanel
      groups={groups}
      profiles={profiles}
      expandedGroupIds={expandedGroupIds}
      onToggleGroup={onToggleGroup}
      sessions={sessions}
      activeSessionId={activeSessionId}
      onOpenSession={openSession}
      onActivateSession={setActiveSessionId}
      onCloseSession={closeSession}
      onDataChanged={refresh}
    />
  );

  const terminals = (
    <TerminalTabs
      profiles={profiles}
      sessions={sessions}
      activeSessionId={activeSessionId}
      onActivate={setActiveSessionId}
      onClose={closeSession}
    />
  );

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-name">daimon</span>
          <span className="brand-sub">connections + terminals</span>
        </div>
        <div className="topbar-actions" />
      </div>

      <div className="content">
        <div className="app-grid">
          <SplitView left={sidebar} right={terminals} initialLeftPct={34} minLeftPx={340} minRightPx={420} />
        </div>
      </div>
    </div>
  );
}

export default App;
