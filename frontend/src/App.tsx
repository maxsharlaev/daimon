import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { SplitView } from "./components/SplitView";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { TerminalTabs, type TerminalSession } from "./components/TerminalTabs";
import type { ProfileDTO, ProfileGroupDTO } from "./types/models";
import { fetchProfilesAndGroups } from "./components/ConnectionsPanel";
import { onSSHOutput, onSSHState, onTaskState, startSSHEventBridge } from "./ssh/events";
import type { SSHStateEvent } from "./types/ssh";
import { SaveUILayout, LoadUILayout, SSHConnectProfile, SSHSend, SFTPConnectProfile } from "../wailsjs/go/main/App";
import { pickSessionIcon } from "./utils/sessionTag";
import { FilesTabs, type FilesSession } from "./components/FilesTabs";

type FilesLastPathsByProfile = Record<string, { localPath: string; remotePath: string }>;

function shellQuote(p: string) {
  // single-quote for POSIX shells: ' -> '\'' (close/open trick)
  const s = String(p ?? "");
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function App() {
  const [groups, setGroups] = useState<ProfileGroupDTO[]>([]);
  const [profiles, setProfiles] = useState<ProfileDTO[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [fileSessions, setFileSessions] = useState<FilesSession[]>([]);
  const [activeFileSessionId, setActiveFileSessionId] = useState<string | null>(null);
  const [rightMode, setRightMode] = useState<"terminal" | "files">("terminal");
  const [filesLastPathsByProfile, setFilesLastPathsByProfile] = useState<FilesLastPathsByProfile>({});
  const fileSessionsRef = useRef<FilesSession[]>([]);

  useEffect(() => {
    fileSessionsRef.current = fileSessions;
  }, [fileSessions]);

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
        if (v?.filesLastPathsByProfile && typeof v.filesLastPathsByProfile === "object") {
          setFilesLastPathsByProfile(v.filesLastPathsByProfile as FilesLastPathsByProfile);
        }
      } catch {
        // ignore
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const payload = JSON.stringify({ version: 2, expandedGroupIds, filesLastPathsByProfile });
      void SaveUILayout("app", payload);
    }, 250);
    return () => clearTimeout(t);
  }, [expandedGroupIds, filesLastPathsByProfile]);

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
    setRightMode("terminal");
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
      onActivateSession={(sid) => {
        setActiveSessionId(sid);
        setRightMode("terminal");
      }}
      onCloseSession={closeSession}
      onFilesMode={() => setRightMode("files")}
      onTerminalMode={() => setRightMode("terminal")}
      fileSessions={fileSessions}
      activeFileSessionId={activeFileSessionId}
      rightMode={rightMode}
      onOpenFileSession={(sessionId, profileId) => {
        setFileSessions((prev) => {
          const existingForProfile = prev.filter((s) => s.profileId === profileId);
          const icon = pickSessionIcon(sessionId, existingForProfile.map((s) => s.icon));
          const ordinal = existingForProfile.length + 1;
          const remotePath = filesLastPathsByProfile[profileId]?.remotePath ?? ".";
          return [...prev, { sessionId, profileId, icon, ordinal, remotePath }];
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
              return [...prev, { sessionId: sid, profileId: cur.profileId, icon, ordinal, remotePath }];
            });
            setFilesLastPathsByProfile((prev) => ({ ...prev, [cur.profileId]: { localPath: prev[cur.profileId]?.localPath ?? "", remotePath } }));
            setActiveFileSessionId(sid);
            setRightMode("files");
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
        />
      </div>
    </div>
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
          <SplitView left={sidebar} right={rightPane} initialLeftPct={34} minLeftPx={340} minRightPx={420} />
        </div>
      </div>

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
