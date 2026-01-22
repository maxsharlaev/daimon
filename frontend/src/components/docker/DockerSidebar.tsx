import type { ProfileDTO } from "../../types/models";
import { useEffect, useState } from "react";
import type { DockerContainerDTO, DockerImageDTO, DockerStatusDTO, DockerSystemDTO } from "../../types/docker";
import "./docker.css";

type View = "containers" | "images" | "system";
type Scope = "local" | "remote";

type RemoteSessionState = {
  profileId: string;
  sessionId: string | null;
  status?: DockerStatusDTO | null;
  lastError?: string | null;
  connecting?: boolean;
};

type Props = {
  view: View;
  scope: Scope;
  profiles: ProfileDTO[];
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
  onRefreshSystem: () => void;
};

export function DockerSidebar({
  view,
  scope,
  profiles,
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
  onRefreshSystem,
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [danglingOpen, setDanglingOpen] = useState(false);
  const [notInUseOpen, setNotInUseOpen] = useState(false);
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

      <div className="docker-tabs" role="tablist" aria-label="Docker view">
        {([
          ["containers", "Containers"],
          ["images", "Images"],
          ["system", "System"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`docker-tab ${view === key ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => onViewChange(key)}
          >
            {label}
          </button>
        ))}
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
          {profiles.map((p) => {
            const st = remoteByProfile[p.id];
            const active = activeRemoteProfileId === p.id;
            const connected = !!st?.sessionId;
            const label = connected ? "Disconnect" : "Connect";
            return (
              <div
                key={p.id}
                className={`docker-profile ${active ? "active" : ""}`}
                onClick={() => onSelectRemoteProfile(p.id)}
              >
                <div>
                  <div className="docker-profile-name">{p.name || `${p.username}@${p.host}`}</div>
                  <div className="docker-profile-meta">
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
        </div>
      )}

      {view === "containers" ? (
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
              const menuId = `c:${c.id}`;
              return (
                <div key={c.id} className={`docker-container ${isActive ? "active" : ""} ${activeLabel ? `active-kind-${activeLabel}` : ""}`}>
                  <div className="docker-container-row" onClick={() => onSelectContainer(c.id, c.name || c.id)}>
                    <div className="docker-container-info">
                      <div className="docker-container-title">
                        <span className="docker-container-name">{c.name ? c.name : `ID: ${c.id}`}</span>
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
          {imagesError ? <div className="error">{imagesError}</div> : null}
          {images.length === 0 ? (
            <div className="muted">No images.</div>
          ) : (
            images.map((img) => {
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
            })
          )}
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
                {notInUseImages.length === 0 ? (
                  <div className="muted">No not-in-use images.</div>
                ) : (
                  notInUseImages.map((img) => {
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
                  })
                )}
              </div>
            ) : null}
          </div>
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
                {danglingImages.length === 0 ? (
                  <div className="muted">No dangling images.</div>
                ) : (
                  danglingImages.map((img) => {
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
                  })
                )}
              </div>
            ) : null}
          </div>
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
