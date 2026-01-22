import { useEffect, useMemo, useState } from "react";
import {
  DeleteProfile,
  DeleteProfileGroup,
  DuplicateProfile,
  EnsureDefaultGroup,
  ExportProfileEncrypted,
  ImportProfileEncrypted,
  ListProfileGroups,
  ListProfiles,
  SSHConnectProfile,
  SSHConnectProfileWithPassword,
  SSHDashboardConnectProfile,
  SSHDashboardConnectProfileWithPassword,
  UpsertProfile,
  UpsertProfileGroup,
  VaultSetup,
  VaultStatus,
  VaultUnlock,
  SFTPConnectProfile,
  SFTPDisconnect,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import type { ProfileDTO, ProfileGroupDTO } from "../types/models";
import { SSHDisconnect } from "../../wailsjs/go/main/App";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import "./connections.css";
import { ProfileEditorModal } from "./ProfileEditorModal";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

export type Marker = "green" | "red" | "yellow" | "blue" | "purple" | "none";

export type SessionSummary = {
  sessionId: string;
  profileId: string;
  marker: Marker;
  lastError?: string | null;
  icon?: string;
  ordinal?: number;
};

export type DashboardSessionSummary = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  marker: "purple" | "red";
  lastError?: string | null;
};

export type FilesSessionSummary = {
  sessionId: string;
  profileId: string;
  icon: string;
  ordinal: number;
  remotePath?: string;
  marker: "files" | "red";
  lastError?: string | null;
};

type Props = {
  groups: ProfileGroupDTO[];
  profiles: ProfileDTO[];
  expandedGroupIds: string[];
  onToggleGroup: (groupId: string) => void;

  sessions: SessionSummary[];
  onOpenSession: (sessionId: string, profileId: string) => void;
  onActivateSession: (sessionId: string) => void;
  activeSessionId: string | null;
  onCloseSession: (sessionId: string) => void;

  fileSessions: FilesSessionSummary[];
  activeFileSessionId: string | null;
  rightMode: "terminal" | "files" | "dashboard";
  onOpenFileSession: (sessionId: string, profileId: string) => void;
  onActivateFileSession: (sessionId: string) => void;
  onCloseFileSession: (sessionId: string) => void;
  onFilesMode: () => void;
  onTerminalMode: () => void;
  onDashboardMode: () => void;

  dashboardSessions: DashboardSessionSummary[];
  activeDashboardSessionId: string | null;
  onOpenDashboardSession: (sessionId: string, profileId: string) => void;
  onActivateDashboardSession: (sessionId: string) => void;
  onCloseDashboardSession: (sessionId: string) => void;

  onDataChanged: () => void;
};

type EditGroupState = {
  open: boolean;
  groupId?: string;
  parentId?: string | null;
  name: string;
  order: number;
};

export function ConnectionsPanel({
  groups,
  profiles,
  expandedGroupIds,
  onToggleGroup,
  sessions,
  onOpenSession,
  onActivateSession,
  activeSessionId,
  onCloseSession,
  fileSessions,
  activeFileSessionId,
  rightMode,
  onOpenFileSession,
  onActivateFileSession,
  onCloseFileSession,
  onFilesMode,
  onTerminalMode,
  onDashboardMode,
  dashboardSessions,
  activeDashboardSessionId,
  onOpenDashboardSession,
  onActivateDashboardSession,
  onCloseDashboardSession,
  onDataChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorProfileId, setProfileEditorProfileId] = useState<string | null>(null);
  const profileEditorProfile = useMemo(
    () => profiles.find((p) => p.id === profileEditorProfileId),
    [profiles, profileEditorProfileId]
  );
  const [profileEditorDefaultGroupId, setProfileEditorDefaultGroupId] = useState<string | undefined>(undefined);
  const [editGroup, setEditGroup] = useState<EditGroupState>({
    open: false,
    name: "",
    order: 0,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuItems, setMenuItems] = useState<ContextMenuItem[]>([]);

  const groupsById = useMemo(() => {
    const m = new Map<string, ProfileGroupDTO>();
    groups.forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);

  const profilesByGroup = useMemo(() => {
    const m = new Map<string, ProfileDTO[]>();
    profiles.forEach((p) => {
      const arr = m.get(p.groupId) ?? [];
      arr.push(p);
      m.set(p.groupId, arr);
    });
    // stable order: by name
    m.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [profiles]);

  const sessionsByProfile = useMemo(() => {
    const m = new Map<string, SessionSummary[]>();
    sessions.forEach((s) => {
      const arr = m.get(s.profileId) ?? [];
      arr.push(s);
      m.set(s.profileId, arr);
    });
    return m;
  }, [sessions]);

  const dashboardsByProfile = useMemo(() => {
    const m = new Map<string, DashboardSessionSummary>();
    dashboardSessions.forEach((s) => m.set(s.profileId, s));
    return m;
  }, [dashboardSessions]);

  // Build a tail-preserving display string like "…/var/www/html".
  const tailPath = (p: string, max = 24) => {
    const raw = String(p ?? "");
    if (!raw) return ".";
    if (raw.length <= max) return raw;
    const parts = raw.split("/").filter(Boolean);
    if (parts.length === 0) return `…${raw.slice(-max)}`;
    let out = parts[parts.length - 1];
    for (let i = parts.length - 2; i >= 0; i--) {
      const next = `${parts[i]}/${out}`;
      if (next.length > max) break;
      out = next;
    }
    return `…/${out}`;
  };

  const tailPathShort = (p: string) => tailPath(p, 11);

  useEffect(() => {
    // ensure at least one group exists
    void EnsureDefaultGroup();
  }, []);

  const openCreateGroup = () => {
    setEditGroup({ open: true, name: "", order: groups.length });
  };

  const openEditGroup = (g: ProfileGroupDTO) => {
    setEditGroup({
      open: true,
      groupId: g.id,
      parentId: g.parentId ?? null,
      name: g.name,
      order: g.order,
    });
  };

  const openMenu = (anchor: HTMLElement, items: ContextMenuItem[]) => {
    setMenuAnchor(anchor);
    setMenuItems(items);
    setMenuOpen(true);
  };

  const saveGroup = async () => {
    setBusy(true);
    setError(null);
    try {
      const req = main.UpsertProfileGroupRequest.createFrom({
        id: editGroup.groupId ?? "",
        parentId: editGroup.parentId ?? null,
        name: editGroup.name,
        order: editGroup.order,
      });
      await UpsertProfileGroup(req);
      setEditGroup({ open: false, name: "", order: 0 });
      onDataChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteGroup = async (groupId: string) => {
    if (!confirm("Delete group? (must be empty)")) return;
    setBusy(true);
    setError(null);
    try {
      await DeleteProfileGroup(groupId);
      onDataChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const openCreateProfile = (groupId: string) => {
    setProfileEditorProfileId(null);
    setProfileEditorDefaultGroupId(groupId);
    setProfileEditorOpen(true);
  };

  const openEditProfile = (p: ProfileDTO) => {
    setProfileEditorProfileId(p.id);
    setProfileEditorDefaultGroupId(undefined);
    setProfileEditorOpen(true);
  };

  const doDeleteProfile = async (profileId: string) => {
    if (!confirm("Delete profile?")) return;
    setBusy(true);
    setError(null);
    try {
      await DeleteProfile(profileId);
      onDataChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDuplicateProfile = async (profileId: string) => {
    const newName = prompt("New name for duplicate:", "");
    if (newName === null) return;
    setBusy(true);
    setError(null);
    try {
      await DuplicateProfile(profileId, newName);
      onDataChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const connectProfile = async (p: ProfileDTO) => {
    setBusy(true);
    setError(null);
    try {
      const id = await SSHConnectProfile(p.id);
      onOpenSession(id, p.id);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (String(msg).includes("password required")) {
        const password = prompt(`Password for ${p.username}@${p.host}:`, "");
        if (password === null) return;

        const remember = prompt('Remember password? Enter: "none" | "keyring" | "internal"', "none");
        if (remember === null) return;

        if (remember === "internal") {
          const st = await VaultStatus();
          if (!st.setup) {
            const mpw = prompt("Set master password for vault:", "");
            if (mpw === null) return;
            await VaultSetup(mpw);
          } else if (!st.unlocked) {
            const mpw = prompt("Unlock vault (master password):", "");
            if (mpw === null) return;
            await VaultUnlock(mpw);
          }
        }

        const id = await SSHConnectProfileWithPassword(p.id, password, remember);
        onOpenSession(id, p.id);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const openDashboard = async (p: ProfileDTO) => {
    // singleton per profile
    const existing = dashboardSessions.find((s) => s.profileId === p.id) ?? null;
    if (existing) {
      onActivateDashboardSession(existing.sessionId);
      onDashboardMode();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await SSHDashboardConnectProfile(p.id);
      onOpenDashboardSession(id, p.id);
      onDashboardMode();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (String(msg).includes("password required")) {
        const password = prompt(`Password for ${p.username}@${p.host}:`, "");
        if (password === null) return;

        const remember = prompt('Remember password? Enter: "none" | "keyring" | "internal"', "none");
        if (remember === null) return;

        if (remember === "internal") {
          const st = await VaultStatus();
          if (!st.setup) {
            const mpw = prompt("Set master password for vault:", "");
            if (mpw === null) return;
            await VaultSetup(mpw);
          } else if (!st.unlocked) {
            const mpw = prompt("Unlock vault (master password):", "");
            if (mpw === null) return;
            await VaultUnlock(mpw);
          }
        }

        const id = await SSHDashboardConnectProfileWithPassword(p.id, password, remember);
        onOpenDashboardSession(id, p.id);
        onDashboardMode();
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const exportProfile = async (p: ProfileDTO) => {
    const pw = prompt("Export password:", "");
    if (pw === null) return;
    setBusy(true);
    setError(null);
    try {
      const container = await ExportProfileEncrypted(p.id, pw);
      await ClipboardSetText(container);
      alert("Export copied to clipboard (encrypted).");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const importProfile = async (groupId: string) => {
    const container = prompt("Paste export JSON:", "");
    if (container === null) return;
    const pw = prompt("Export password:", "");
    if (pw === null) return;

    const passwordStorage = prompt('Password destination: "none" | "keyring" | "internal"', "none");
    if (passwordStorage === null) return;
    const keyStorage = prompt('Key destination: "none" | "keyring" | "internal"', "none");
    if (keyStorage === null) return;

    if (passwordStorage === "internal" || keyStorage === "internal") {
      const st = await VaultStatus();
      if (!st.setup) {
        const mpw = prompt("Set master password for vault:", "");
        if (mpw === null) return;
        await VaultSetup(mpw);
      } else if (!st.unlocked) {
        const mpw = prompt("Unlock vault (master password):", "");
        if (mpw === null) return;
        await VaultUnlock(mpw);
      }
    }

    setBusy(true);
    setError(null);
    try {
      await ImportProfileEncrypted(container, pw, main.ImportOptions.createFrom({ groupId, passwordStorage, keyStorage }));
      onDataChanged();
      alert("Imported.");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectSession = async (sessionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await SSHDisconnect(sessionId);
      onCloseSession(sessionId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectDashboardSession = async (sessionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await SSHDisconnect(sessionId);
      onCloseDashboardSession(sessionId);
      onTerminalMode();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const openFiles = async (p: ProfileDTO) => {
    setBusy(true);
    setError(null);
    try {
      const sid = await SFTPConnectProfile(p.id);
      onOpenFileSession(sid, p.id);
      onFilesMode();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectFileSession = async (sessionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await SFTPDisconnect(sessionId);
      onCloseFileSession(sessionId);
      onTerminalMode();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connections panel">
      <ContextMenu
        open={menuOpen}
        anchorEl={menuAnchor}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
      />
      <div className="panel-titlebar">
        <div className="panel-title">Connections</div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={onDataChanged} disabled={busy}>
            Refresh
          </button>
          <button className="btn" type="button" onClick={openCreateGroup} disabled={busy}>
            + Group
          </button>
        </div>
      </div>

      {error ? <div className="connections-error">{error}</div> : null}

      <div className="connections-list">
        {groups.length === 0 ? (
          <div className="connections-empty">No groups yet.</div>
        ) : (
          groups
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((g) => {
              const expanded = expandedGroupIds.includes(g.id);
              const groupProfiles = profilesByGroup.get(g.id) ?? [];
              return (
                <div key={g.id} className="group">
                  <div className="group-header">
                    <button
                      className="group-toggle"
                      type="button"
                      onClick={() => onToggleGroup(g.id)}
                    >
                      {expanded ? "▾" : "▸"} {g.name}
                    </button>
                    <div className="group-actions">
                      <button className="btn btn-ghost" type="button" onClick={() => openCreateProfile(g.id)} disabled={busy}>
                        + Profile
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={busy}
                        onClick={(e) =>
                          openMenu(e.currentTarget, [
                            { id: "import", label: "Import…", onClick: () => void importProfile(g.id) },
                            { id: "edit", label: "Edit", onClick: () => openEditGroup(g) },
                            { id: "delete", label: "Delete", danger: true, onClick: () => void doDeleteGroup(g.id) },
                          ])
                        }
                        title="Menu"
                      >
                        ⋯
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="group-body">
                      {groupProfiles.length === 0 ? (
                        <div className="connections-empty">No profiles in this group.</div>
                      ) : (
                        groupProfiles.map((p) => {
                          const profSessions = sessionsByProfile.get(p.id) ?? [];
                          const profFileSessions = fileSessions.filter((s) => s.profileId === p.id);
                          const profDashboard = dashboardsByProfile.get(p.id) ?? null;
                          const hasActiveTerminal =
                            rightMode === "terminal" && profSessions.some((s) => s.sessionId === activeSessionId);
                          const hasActiveFiles = rightMode === "files" && profFileSessions.some((s) => s.sessionId === activeFileSessionId);
                          const hasActiveDashboard = rightMode === "dashboard" && profDashboard?.sessionId === activeDashboardSessionId;
                          const canDelete = profSessions.length === 0;
                          const topMarker: Marker =
                            profSessions.find((s) => s.marker === "yellow")?.marker ??
                            profSessions.find((s) => s.marker === "green")?.marker ??
                            profSessions.find((s) => s.marker === "red")?.marker ??
                            (hasActiveFiles ? "blue" : hasActiveDashboard ? "purple" : "none");

                          return (
                            <div
                              key={p.id}
                              className={`profile ${hasActiveTerminal ? "active-terminal" : ""} ${hasActiveFiles ? "active-files" : ""} ${
                                hasActiveDashboard ? "active-dashboard" : ""
                              }`}
                            >
                              <div className="profile-row">
                                <div className="profile-main">
                                  <div className="profile-name">{p.name}</div>
                                  <div className="profile-sub">
                                    {p.username}@{p.host}:{p.port}
                                  </div>
                                </div>
                                <div className="profile-actions">
                                  <button className="btn" type="button" onClick={() => connectProfile(p)} disabled={busy}>
                                    Connect
                                  </button>
                                  <button className="btn" type="button" onClick={() => void openFiles(p)} disabled={busy}>
                                    Files
                                  </button>
                                  <button className="btn" type="button" onClick={() => void openDashboard(p)} disabled={busy}>
                                    Dashboard
                                  </button>
                                  <button
                                    className="btn btn-ghost"
                                    type="button"
                                    disabled={busy}
                                    onClick={(e) =>
                                      openMenu(e.currentTarget, [
                                        { id: "edit", label: "Edit", onClick: () => openEditProfile(p) },
                                        { id: "dup", label: "Duplicate", onClick: () => void doDuplicateProfile(p.id) },
                                        { id: "export", label: "Export…", onClick: () => void exportProfile(p) },
                                        {
                                          id: "delete",
                                          label: "Delete",
                                          danger: true,
                                          disabled: !canDelete,
                                          onClick: () => void doDeleteProfile(p.id),
                                        },
                                      ])
                                    }
                                    title="Menu"
                                  >
                                    ⋯
                                  </button>
                                </div>
                                <span className={`marker marker-${topMarker} profile-marker`} title={topMarker} />
                              </div>

                              {profDashboard ? (
                                <div className="sessions">
                                  <div className="session">
                                    <button
                                      type="button"
                                      className={`session-btn dashboard ${
                                        rightMode === "dashboard" && profDashboard.sessionId === activeDashboardSessionId ? "active" : ""
                                      }`}
                                      onClick={() => {
                                        onActivateDashboardSession(profDashboard.sessionId);
                                        onDashboardMode();
                                      }}
                                    >
                                      <span className={`dot dot-${profDashboard.marker}`} />
                                      <span>
                                        {(profDashboard.icon ?? "📊") +
                                          " " +
                                          "Dashboard" +
                                          (profDashboard.ordinal > 1 ? ` ${profDashboard.ordinal}` : "")}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                        className={`session-close ${profDashboard.marker === "red" ? "neutral" : ""}`}
                                        onClick={() =>
                                          profDashboard.marker === "red"
                                            ? onCloseDashboardSession(profDashboard.sessionId)
                                            : void disconnectDashboardSession(profDashboard.sessionId)
                                        }
                                        title={profDashboard.marker === "red" ? "Close dashboard session" : "Disconnect dashboard"}
                                    >
                                        {profDashboard.marker === "red" ? "Close" : "Disconnect"}
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {profSessions.length > 0 ? (
                                <div className="sessions">
                                  {profSessions.map((s) => (
                                    <div key={s.sessionId} className="session">
                                      <button
                                        type="button"
                                        className={`session-btn ${rightMode === "terminal" && s.sessionId === activeSessionId ? "active" : ""}`}
                                        onClick={() => {
                                          onActivateSession(s.sessionId);
                                          onTerminalMode();
                                        }}
                                      >
                                        <span className={`dot dot-${s.marker}`} />
                                        <span>
                                          {(s.icon ?? "•") +
                                            " " +
                                            p.name +
                                            (profSessions.length > 1 ? ` ${s.ordinal ?? 1}` : "")}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className={`session-close ${s.marker === "red" ? "neutral" : ""}`}
                                        onClick={() => (s.marker === "red" ? onCloseSession(s.sessionId) : void disconnectSession(s.sessionId))}
                                        title={s.marker === "red" ? "Close session" : "Disconnect"}
                                      >
                                        {s.marker === "red" ? "Close" : "Disconnect"}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {profFileSessions.length > 0 ? (
                                <div className="sessions">
                                  {profFileSessions.map((s) => (
                                    <div key={s.sessionId} className="session">
                                      <button
                                        type="button"
                                        className={`session-btn files ${rightMode === "files" && s.sessionId === activeFileSessionId ? "active" : ""}`}
                                        onClick={() => {
                                          onActivateFileSession(s.sessionId);
                                          onFilesMode();
                                        }}
                                      >
                                        <span className={`dot ${s.marker === "red" ? "dot-red" : "dot-files"}`} />
                                        <span className="session-files-label" title={s.remotePath ?? "."}>
                                          <span className="session-files-full">{(s.icon ?? "•") + " " + `Files: ${s.remotePath ?? "."}`}</span>
                                          <span className="session-files-tail">{(s.icon ?? "•") + " " + `Files: ${tailPath(s.remotePath ?? ".")}`}</span>
                                          <span className="session-files-tail-short">
                                            {(s.icon ?? "•") + " " + `Files: ${tailPathShort(s.remotePath ?? ".")}`}
                                          </span>
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className={`session-close ${s.marker === "red" ? "neutral" : ""}`}
                                        onClick={() =>
                                          s.marker === "red" ? onCloseFileSession(s.sessionId) : void disconnectFileSession(s.sessionId)
                                        }
                                        title={s.marker === "red" ? "Close files session" : "Disconnect files"}
                                      >
                                        {s.marker === "red" ? "Close" : "Disconnect"}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
        )}
      </div>

      {/* Group modal */}
      {editGroup.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{editGroup.groupId ? "Edit group" : "New group"}</div>
            <div className="modal-body">
              <label>Name</label>
              <input value={editGroup.name} onChange={(e) => setEditGroup((s) => ({ ...s, name: e.target.value }))} />
              <label>Order</label>
              <input
                type="number"
                value={editGroup.order}
                onChange={(e) => setEditGroup((s) => ({ ...s, order: Number(e.target.value) }))}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setEditGroup({ open: false, name: "", order: 0 })}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={saveGroup} disabled={busy || !editGroup.name.trim()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ProfileEditorModal
        open={profileEditorOpen}
        groups={groups}
        profile={profileEditorProfile}
        defaultGroupId={profileEditorDefaultGroupId}
        onClose={() => setProfileEditorOpen(false)}
        onSaved={onDataChanged}
      />
    </div>
  );
}

// Convenience method for refresh in parent, if needed elsewhere
export async function fetchProfilesAndGroups(): Promise<{ groups: ProfileGroupDTO[]; profiles: ProfileDTO[] }> {
  await EnsureDefaultGroup();
  const [groups, profiles] = await Promise.all([ListProfileGroups(), ListProfiles()]);
  return { groups: groups as any, profiles: profiles as any };
}

