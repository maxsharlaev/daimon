import type { ProfileDTO, ProfileGroupDTO } from "../../types/models";
import { useEffect, useMemo, useState } from "react";
import type {
  DockerContainerDTO,
  DockerImageDTO,
  DockerStatusDTO,
  DockerSystemDTO,
  DockerVolumeDTO,
  DockerVolumeDetailsDTO,
  DockerNetworkDTO,
} from "../../types/docker";
import "./docker.css";
import { DropdownSelect } from "../ui";

type View = "containers" | "images" | "volumes" | "networks" | "system";
type Scope = "local" | "remote";

type RemoteSessionState = {
  profileId: string;
  sessionId: string | null;
  status?: DockerStatusDTO | null;
  lastError?: string | null;
  connecting?: boolean;
};

type DockerSidebarProps = {
  view: View;
  scope: Scope;
  profiles: ProfileDTO[];
  groups: ProfileGroupDTO[];
  remoteByProfile: Record<string, RemoteSessionState>;
  activeRemoteProfileId: string | null;
  containers: DockerContainerDTO[];
  containersBusy: boolean;
  containersError: string | null;
  activeContainerId: string | null;
  activeTabContainerId: string | null;
  activeTabKind: "logs" | "shell" | "files" | null;
  tabsByContainerKind: Record<string, Set<"logs" | "shell" | "files">>;
  containerQuery: string;
  onContainerQueryChange: (v: string) => void;
  images: DockerImageDTO[];
  danglingImages: DockerImageDTO[];
  notInUseImages: DockerImageDTO[];
  imagesBusy: boolean;
  imagesError: string | null;
  activeImageId: string | null;
  volumesInUse: DockerVolumeDTO[];
  volumesNotInUse: DockerVolumeDTO[];
  volumesError: string | null;
  volumesBusy: boolean;
  activeVolumeName: string | null;
  volumeDetailsByName: Record<string, DockerVolumeDetailsDTO>;
  networks: DockerNetworkDTO[];
  networksError: string | null;
  activeNetworkId: string | null;
  systemInfo: DockerSystemDTO | null;
  systemError: string | null;
  imageQuery: string;
  onImageQueryChange: (v: string) => void;
  onViewChange: (v: View) => void;
  onScopeChange: (s: Scope) => void;
  onSelectRemoteProfile: (id: string) => void;
  onConnectRemote: (profileId: string) => void;
  onDisconnectRemote: (profileId: string) => void;
  onRefreshLocalStatus: () => void;
  localStatus: DockerStatusDTO | null;
  onRefreshContainers: () => void;
  onContainerAction: (id: string, action: "start" | "stop" | "restart" | "remove") => void;
  onPullContainerImage: (imageRef: string) => void;
  onSelectContainer: (id: string, name: string) => void;
  onOpenLogs: (id: string, name: string) => void;
  onOpenShell: (id: string, name: string) => void;
  onOpenFiles: (id: string, name: string) => void;
  onImageAction: (id: string, action: "remove" | "pull") => void;
  onSelectImage: (id: string, source: "normal" | "dangling") => void;
  onOpenDanglingModal: () => void;
  onOpenNotInUseModal: () => void;
  onSelectVolume: (name: string) => void;
  onVolumeFiles: (name: string) => void;
  onVolumeRemove: (name: string) => void;
  onSelectNetwork: (id: string) => void;
  onNetworkInspect: (id: string) => void;
  onNetworkRemove: (id: string) => void;
  onRefreshSystem: () => void;
};

export function DockerSidebar({
  view,
  scope,
  profiles,
  groups,
  remoteByProfile,
  activeRemoteProfileId,
  containers,
  containersBusy,
  containersError,
  activeContainerId,
  activeTabContainerId,
  activeTabKind,
  tabsByContainerKind,
  containerQuery,
  onContainerQueryChange,
  images,
  danglingImages,
  notInUseImages,
  imagesBusy,
  imagesError,
  activeImageId,
  volumesInUse,
  volumesNotInUse,
  volumesError,
  volumesBusy,
  activeVolumeName,
  volumeDetailsByName,
  networks,
  networksError,
  activeNetworkId,
  systemInfo,
  systemError,
  imageQuery,
  onImageQueryChange,
  onViewChange,
  onScopeChange,
  onSelectRemoteProfile,
  onConnectRemote,
  onDisconnectRemote,
  onRefreshLocalStatus,
  localStatus,
  onRefreshContainers,
  onContainerAction,
  onPullContainerImage,
  onSelectContainer,
  onOpenLogs,
  onOpenShell,
  onOpenFiles,
  onImageAction,
  onSelectImage,
  onOpenDanglingModal,
  onOpenNotInUseModal,
  onSelectVolume,
  onVolumeFiles,
  onVolumeRemove,
  onSelectNetwork,
  onNetworkInspect,
  onNetworkRemove,
  onRefreshSystem,
}: DockerSidebarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [danglingOpen, setDanglingOpen] = useState(false);
  const [notInUseOpen, setNotInUseOpen] = useState(false);
  const [volumesNotInUseOpen, setVolumesNotInUseOpen] = useState(false);
  const [remoteListOpen, setRemoteListOpen] = useState(true);
  const [remoteGroupFilter, setRemoteGroupFilter] = useState<string>("all");
  const [remoteSearch, setRemoteSearch] = useState<string>("");
  const activeRemote = activeRemoteProfileId ? remoteByProfile[activeRemoteProfileId] ?? null : null;
  const remoteConnected = !!activeRemote?.sessionId;
  const remoteReady = remoteConnected && activeRemote?.status?.available === true;
  const hideRemoteViews = scope === "remote" && (!remoteConnected || activeRemote?.status?.available !== true);
  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const remoteGroupSelectOptions = useMemo(
    () => [
      { value: "all", label: "All groups" },
      ...groups
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((g) => ({ value: g.id, label: g.name })),
    ],
    [groups]
  );

  const visibleRemoteProfiles = useMemo(() => {
    // When a concrete profile is selected, we show ONLY it (and hide filters anyway).
    if (!remoteListOpen && activeRemoteProfileId) {
      return profiles.filter((p) => p.id === activeRemoteProfileId);
    }

    // Otherwise we are in "list" mode: apply group + search filters.
    const q = remoteSearch.trim().toLowerCase();
    return profiles.filter((p) => {
      if (remoteGroupFilter !== "all" && p.groupId !== remoteGroupFilter) return false;
      if (!q) return true;
      const hay = `${p.name ?? ""} ${p.host ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activeRemoteProfileId, profiles, remoteGroupFilter, remoteListOpen, remoteSearch]);
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".docker-menu-wrap") || target.closest(".docker-menu")) return;
      setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    setOpenMenuId(null);
  }, [view, scope]);

  useEffect(() => {
    if (scope !== "remote") return;
    if (!activeRemoteProfileId) return;
    setRemoteListOpen(false);
  }, [activeRemoteProfileId, scope]);

  return (
    <div className="panel docker-sidebar">
      <div className="panel-titlebar">
        <div className="panel-title">Docker</div>
        <div className="panel-meta">{scope === "local" ? "Local" : "Remote"}</div>
        <div className="panel-actions">
          <div className="docker-tabs docker-tabs-inline" role="tablist" aria-label="Docker scope">
            {([
              ["local", "Local"],
              ["remote", "Remote"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className={`docker-tab ${scope === key ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={scope === key}
                onClick={() => onScopeChange(key)}
              >
                <span className="docker-tab-icon">{key === "local" ? "🖥" : "🌐"}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="docker-tabs-row">
        {scope === "local" || !hideRemoteViews ? (
          <div className="docker-tabs" role="tablist" aria-label="Docker view">
            {([
              ["containers", "Containers"],
              ["images", "Images"],
              ["volumes", "Volumes"],
              ["networks", "Networks"],
              ["system", "System"],
            ] as const).map(([key, label]) => {
              const icon = key === "containers"
                ? "📦"
                : key === "images"
                  ? "🧱"
                  : key === "volumes"
                    ? "💾"
                    : key === "networks"
                      ? "🕸"
                      : "🧰";
              return (
                <button
                  key={key}
                  className={`docker-tab ${view === key ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => onViewChange(key)}
                >
                  <span className="docker-tab-icon">{icon}</span>
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div />
        )}
        {scope === "remote" && !remoteListOpen ? (
          <button className="btn btn-ghost docker-tabs-list-btn" type="button" onClick={() => setRemoteListOpen(true)}>
            List →
          </button>
        ) : null}
      </div>

      {scope === "local" ? (
        <div className="docker-sidebar-section">
          <div className="docker-profile">
            <div>
              <div className="docker-profile-name">Local engine</div>
              <div className="docker-profile-meta">
                {localStatus?.available
                  ? `Docker ${localStatus.version ?? ""} ${localStatus.os ?? ""}`.trim()
                  : localStatus?.message ?? "Not available"}
              </div>
            </div>
            <button className="btn btn-ghost" type="button" onClick={onRefreshLocalStatus}>
              Refresh status
            </button>
          </div>
        </div>
      ) : (
        <div className="docker-sidebar-section">
          {remoteListOpen ? (
            <div className="docker-remote-filters">
              <DropdownSelect
                className="docker-select"
                value={remoteGroupFilter}
                onChange={setRemoteGroupFilter}
                options={remoteGroupSelectOptions}
                aria-label="Group filter"
              />
              <input
                className="docker-search"
                placeholder="Search name or host"
                value={remoteSearch}
                onChange={(e) => setRemoteSearch(e.target.value)}
              />
            </div>
          ) : null}

          {visibleRemoteProfiles.map((p) => {
            const st = remoteByProfile[p.id];
            const active = activeRemoteProfileId === p.id;
            const connected = !!st?.sessionId;
            const label = connected ? "Disconnect" : "Connect";
            return (
              <div
                key={p.id}
                className={`docker-profile ${active ? "active" : ""}`}
                onClick={() => {
                  onSelectRemoteProfile(p.id);
                  setRemoteListOpen(false);
                }}
              >
                <div>
                  <div className="docker-profile-name">{p.name || `${p.username}@${p.host}`}</div>
                  <div className="docker-profile-meta">
                    {remoteListOpen ? (
                      <span className="docker-profile-group">
                        {groupNameById.get(p.groupId) ?? "Group"} •{" "}
                      </span>
                    ) : null}
                    {st?.connecting
                      ? "Connecting..."
                      : connected
                      ? st?.status?.available
                        ? "Docker available"
                        : st?.status?.message ?? "Docker unavailable"
                      : st?.lastError ?? "Disconnected"}
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (connected) {
                      void onDisconnectRemote(p.id);
                    } else {
                      void onConnectRemote(p.id);
                    }
                  }}
                >
                  {label}
                </button>
              </div>
            );
          })}
          {profiles.length === 0 ? <div className="muted">No SSH profiles.</div> : null}
          {profiles.length > 0 && visibleRemoteProfiles.length === 0 ? <div className="muted">No matches.</div> : null}
        </div>
      )}

      {hideRemoteViews ? (
        <div className="docker-sidebar-section">
          <div className="muted">
            {remoteConnected
              ? activeRemote?.status?.message ?? "Docker unavailable on remote host."
              : "Connect to a remote profile to view Docker resources."}
          </div>
        </div>
      ) : view === "containers" ? (
        <div className="docker-sidebar-section docker-sidebar-list">
          <div className="docker-section-title docker-section-title-spaced">
            <span>Containers</span>
            <input
              className="docker-search"
              placeholder="Search containers"
              value={containerQuery}
              onChange={(e) => onContainerQueryChange(e.target.value)}
              disabled={containersBusy}
            />
          </div>
          {containersError ? <div className="error">{containersError}</div> : null}
          {containers.length === 0 ? (
            <div className="muted">No containers.</div>
          ) : (
            containers.map((c) => {
              const isActive = activeContainerId === c.id;
              const isRunning = String(c.state || "").toLowerCase() === "running";
              const activeLabel = activeTabContainerId === c.id && activeTabKind ? activeTabKind : null;
              const openKinds = tabsByContainerKind[c.id] ?? new Set();
              const isTemp = (c.name || "").startsWith("daimon_temp_");
              const menuId = `c:${c.id}`;
              return (
                <div key={c.id} className={`docker-container ${isActive ? "active" : ""} ${activeLabel ? `active-kind-${activeLabel}` : ""}`}>
                  <div className="docker-container-row" onClick={() => onSelectContainer(c.id, c.name || c.id)}>
                    <div className="docker-container-info">
                      <div className="docker-container-title">
                        <span className={`docker-container-name ${isTemp ? "temp" : ""}`}>{c.name ? c.name : `ID: ${c.id}`}</span>
                        {isTemp ? <span className="docker-temp-badge">temp</span> : null}
                        {c.ports ? <span className="docker-container-ports">{c.ports}</span> : null}
                      </div>
                      <div className="docker-container-image">{c.image.startsWith("sha256:") ? "Image ID: " : "Image: "}{c.image}</div>
                    </div>
                    <div className="docker-container-actions">
                      <button className={`btn btn-ghost docker-action-btn logs ${openKinds.has("logs") ? "active" : ""}`} type="button" onClick={(e) => { e.stopPropagation(); onOpenLogs(c.id, c.name || c.id); }}>
                        Logs
                      </button>
                      <button className={`btn btn-ghost docker-action-btn shell ${openKinds.has("shell") ? "active" : ""}`} type="button" onClick={(e) => { e.stopPropagation(); onOpenShell(c.id, c.name || c.id); }}>
                        Shell
                      </button>
                      <button className={`btn btn-ghost docker-action-btn files ${openKinds.has("files") ? "active" : ""}`} type="button" onClick={(e) => { e.stopPropagation(); onOpenFiles(c.id, c.name || c.id); }}>
                        Files
                      </button>
                      <div className="docker-menu-wrap">
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                          }}
                        >
                          …
                        </button>
                        {openMenuId === menuId ? (
                          <div className="docker-menu">
                            <button type="button" onClick={() => { setOpenMenuId(null); onContainerAction(c.id, "start"); }}>
                              Start
                            </button>
                            <button type="button" onClick={() => { setOpenMenuId(null); onPullContainerImage(c.image); }}>
                              Pull image
                            </button>
                            <button type="button" onClick={() => { setOpenMenuId(null); onContainerAction(c.id, "stop"); }}>
                              Stop
                            </button>
                            <button type="button" onClick={() => { setOpenMenuId(null); onContainerAction(c.id, "restart"); }}>
                              Restart
                            </button>
                            <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onContainerAction(c.id, "remove"); }}>
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <span className={`dot ${isRunning ? "dot-green" : "dot-none"}`} />
                    </div>
                  </div>
                  {activeLabel ? <div className={`docker-container-active ${activeLabel}`}>{activeLabel}</div> : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {view === "images" ? (
        <div className="docker-sidebar-section docker-sidebar-list">
          {imagesError ? <div className="error">{imagesError}</div> : null}
          {images.length > 0 ? (
            <>
              <div className="docker-section-title">
                <span>Images (in use)</span>
                <div className="docker-actions">
                  <input
                    className="docker-search"
                    placeholder="Search name or ID"
                    value={imageQuery}
                    onChange={(e) => onImageQueryChange(e.target.value)}
                  />
                </div>
              </div>
              {images.map((img) => {
                const isActive = activeImageId === img.id;
                const menuId = `i:${img.id}`;
                const label = `${img.repository}:${img.tag}`;
                return (
                  <div key={img.id} className={`docker-container ${isActive ? "active" : ""}`}>
                    <div className="docker-container-row" onClick={() => onSelectImage(img.id, "normal")}>
                      <span className="dot dot-green" />
                      <div className="docker-container-info">
                        <div className="docker-container-title">
                          <span className="docker-container-name">{label}</span>
                        </div>
                        <div
                          className="docker-container-image"
                          title={`Created: ${formatImageDate(img).full}`}
                        >
                          Created: {formatImageDate(img).short} • {img.size ?? "-"}
                        </div>
                      </div>
                      <div className="docker-container-actions">
                        <div className="docker-menu-wrap">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                            }}
                          >
                            …
                          </button>
                          {openMenuId === menuId ? (
                            <div className="docker-menu">
                              <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onImageAction(img.id, "remove"); }}>
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}
          {notInUseImages.length > 0 ? (
            <div className="docker-dangling">
              <div className="docker-section-title">
                <button className="docker-dangling-toggle" type="button" onClick={() => setNotInUseOpen((v) => !v)}>
                  {notInUseOpen ? "▾" : "▸"} Not in use ({notInUseImages.length})
                </button>
                <button className="btn btn-danger" type="button" onClick={onOpenNotInUseModal} disabled={imagesBusy}>
                  Prune
                </button>
              </div>
              {notInUseOpen ? (
                <div className="docker-dangling-list">
                  {notInUseImages.map((img) => {
                    const menuId = `n:${img.id}`;
                    const isActive = activeImageId === img.id;
                    const label = `${img.repository}:${img.tag}`;
                    return (
                      <div key={img.id} className={`docker-container ${isActive ? "active" : ""}`}>
                        <div className="docker-container-row" onClick={() => onSelectImage(img.id, "normal")}>
                          <span className="dot dot-none" />
                          <div className="docker-container-info">
                            <div className="docker-container-title">
                              <span className="docker-container-name">{label}</span>
                            </div>
                            <div className="docker-container-image">
                              Created: {formatImageDate(img).short} • {img.size ?? "-"}
                            </div>
                          </div>
                          <div className="docker-container-actions">
                            <div className="docker-menu-wrap">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                                }}
                              >
                                …
                              </button>
                              {openMenuId === menuId ? (
                                <div className="docker-menu">
                                  <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onImageAction(img.id, "remove"); }}>
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          {danglingImages.length > 0 ? (
            <div className="docker-dangling">
              <div className="docker-section-title">
                <button className="docker-dangling-toggle" type="button" onClick={() => setDanglingOpen((v) => !v)}>
                  {danglingOpen ? "▾" : "▸"} Dangling images ({danglingImages.length})
                </button>
                <button className="btn btn-danger" type="button" onClick={onOpenDanglingModal} disabled={imagesBusy}>
                  Prune
                </button>
              </div>
              {danglingOpen ? (
                <div className="docker-dangling-list">
                  {danglingImages.map((img) => {
                    const menuId = `d:${img.id}`;
                    const isActive = activeImageId === img.id;
                    return (
                      <div key={img.id} className={`docker-container ${isActive ? "active" : ""}`}>
                        <div className="docker-container-row" onClick={() => onSelectImage(img.id, "dangling")}>
                          <span className="dot dot-none" />
                          <div className="docker-container-info">
                            <div className="docker-container-title">
                              <span className="docker-container-name">&lt;none&gt;:&lt;none&gt;</span>
                            </div>
                            <div
                              className="docker-container-image"
                              title={`Created: ${formatImageDate(img).full}`}
                            >
                              Created: {formatImageDate(img).short} • {img.size ?? "-"}
                            </div>
                          </div>
                          <div className="docker-container-actions">
                            <div className="docker-menu-wrap">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                                }}
                              >
                                …
                              </button>
                              {openMenuId === menuId ? (
                                <div className="docker-menu">
                                  <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onImageAction(img.id, "remove"); }}>
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {view === "volumes" ? (
        <div className="docker-sidebar-section docker-sidebar-list">
          {volumesError ? <div className="error">{volumesError}</div> : null}
          {volumesInUse.length > 0 ? (
            <>
              <div className="docker-section-title">
                <span>Volumes (in use)</span>
              </div>
              {volumesInUse.map((v) => {
                const isActive = activeVolumeName === v.name;
                const menuId = `v:${v.name}`;
                const details = volumeDetailsByName[v.name];
                const refCount = details?.refCount;
                const refLabel = typeof refCount === "number" && refCount >= 0 ? String(refCount) : "-";
                const sizeBytes = details?.sizeBytes;
                const usageLabel = typeof sizeBytes === "number" && sizeBytes >= 0 ? formatBytes(sizeBytes) : "n/a";
                return (
                  <div key={v.name} className={`docker-container ${isActive ? "active" : ""}`}>
                    <div className="docker-container-row" onClick={() => onSelectVolume(v.name)}>
                      <span className="dot dot-green" />
                      <div className="docker-container-info">
                        <div className="docker-container-title">
                          <span className="docker-container-name">{v.name}</span>
                        </div>
                        <div className="docker-container-image">
                          Driver: {v.driver ?? "-"} • Scope: {v.scope ?? "-"} • Refs: {refLabel} • Usage: {usageLabel}
                        </div>
                      </div>
                      <div className="docker-container-actions">
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onVolumeFiles(v.name);
                          }}
                        >
                          Files
                        </button>
                        <div className="docker-menu-wrap">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                            }}
                          >
                            …
                          </button>
                          {openMenuId === menuId ? (
                            <div className="docker-menu">
                              <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onVolumeRemove(v.name); }}>
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}
          {volumesNotInUse.length > 0 ? (
            <div className="docker-dangling">
              <div className="docker-section-title">
                <button className="docker-dangling-toggle" type="button" onClick={() => setVolumesNotInUseOpen((v) => !v)}>
                  {volumesNotInUseOpen ? "▾" : "▸"} Not in use ({volumesNotInUse.length})
                </button>
              </div>
              {volumesNotInUseOpen ? (
                <div className="docker-dangling-list">
                  {volumesNotInUse.map((v) => {
                    const isActive = activeVolumeName === v.name;
                    const menuId = `vn:${v.name}`;
                    const details = volumeDetailsByName[v.name];
                    const refCount = details?.refCount;
                    const refLabel = typeof refCount === "number" && refCount >= 0 ? String(refCount) : "-";
                    const sizeBytes = details?.sizeBytes;
                    const usageLabel = typeof sizeBytes === "number" && sizeBytes >= 0 ? formatBytes(sizeBytes) : "n/a";
                    return (
                      <div key={v.name} className={`docker-container ${isActive ? "active" : ""}`}>
                        <div className="docker-container-row" onClick={() => onSelectVolume(v.name)}>
                          <span className="dot dot-none" />
                          <div className="docker-container-info">
                            <div className="docker-container-title">
                              <span className="docker-container-name">{v.name}</span>
                            </div>
                            <div className="docker-container-image">
                              Driver: {v.driver ?? "-"} • Scope: {v.scope ?? "-"} • Refs: {refLabel} • Usage: {usageLabel}
                            </div>
                          </div>
                          <div className="docker-container-actions">
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onVolumeFiles(v.name);
                              }}
                            >
                              Files
                            </button>
                            <div className="docker-menu-wrap">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                                }}
                              >
                                …
                              </button>
                              {openMenuId === menuId ? (
                                <div className="docker-menu">
                                  <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onVolumeRemove(v.name); }}>
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {view === "networks" && (networksError || networks.length > 0) ? (
        <div className="docker-sidebar-section docker-sidebar-list">
          <div className="docker-section-title">
            <span>Networks</span>
          </div>
          {networksError ? <div className="error">{networksError}</div> : null}
          {networks.length > 0 ? (
            networks.map((n) => {
              const isActive = activeNetworkId === n.id;
              const isSystem = isSystemNetwork(n.name);
              const menuId = `n:${n.id}`;
              return (
                <div key={n.id} className={`docker-container ${isActive ? "active" : ""}`}>
                  <div className="docker-container-row" onClick={() => onSelectNetwork(n.id)}>
                    <div className="docker-container-info">
                      <div className="docker-container-title">
                        <span className="docker-container-name">{n.name}</span>
                        {isSystem ? <span className="docker-system-badge">system</span> : null}
                      </div>
                      <div className="docker-container-image">
                        Driver: {n.driver ?? "-"} • Scope: {n.scope ?? "-"}
                      </div>
                    </div>
                    <div className="docker-container-actions">
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNetworkInspect(n.id);
                        }}
                      >
                        Inspect
                      </button>
                      {!isSystem ? (
                        <div className="docker-menu-wrap">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId((cur) => (cur === menuId ? null : menuId));
                            }}
                          >
                            …
                          </button>
                          {openMenuId === menuId ? (
                            <div className="docker-menu">
                              <button className="danger" type="button" onClick={() => { setOpenMenuId(null); onNetworkRemove(n.id); }}>
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          ) : null}
        </div>
      ) : null}

      {view === "system" ? (
        <div className="docker-sidebar-section docker-sidebar-list">
          <div className="docker-section-title">
            <span>System</span>
            <button className="btn btn-ghost" type="button" onClick={onRefreshSystem}>
              Refresh
            </button>
          </div>
          {systemError ? <div className="error">{systemError}</div> : null}
          {systemInfo?.status ? (
            <div className="docker-system-block">
              <div className="muted">
                Docker {systemInfo.status.version ?? ""} {systemInfo.status.os ?? ""} {systemInfo.status.arch ?? ""}
              </div>
            </div>
          ) : null}
          {systemInfo?.diskUsageText ? (
            <pre className="mono docker-system-pre">{systemInfo.diskUsageText}</pre>
          ) : null}
          {systemInfo?.infoText ? (
            <pre className="mono docker-system-pre">{systemInfo.infoText}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatImageDate(img: DockerImageDTO): { short: string; full: string } {
  const raw = img.createdAt ?? img.createdSince ?? "";
  if (!raw) return { short: "unknown", full: "unknown" };
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return {
      short: d.toLocaleDateString(),
      full: d.toLocaleString(),
    };
  }
  return { short: raw, full: raw };
}

function isSystemNetwork(name: string | undefined | null): boolean {
  const normalized = String(name ?? "").toLowerCase();
  return normalized === "bridge" || normalized === "host" || normalized === "none";
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = abs;
  let i = -1;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const sign = n < 0 ? "-" : "";
  return `${sign}${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
