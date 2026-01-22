import { useEffect, useMemo, useState } from "react";
import type { ProfileDTO } from "../../types/models";
import { SplitView } from "../SplitView";
import { DockerSidebar } from "./DockerSidebar";
import { DockerLogsPanel } from "./DockerLogsPanel";
import { DockerShellPanel } from "./DockerShellPanel";
import { DockerFilesPanel } from "./DockerFilesPanel";
import type { DockerContainerDTO, DockerImageDTO, DockerStatusDTO, DockerSystemDTO } from "../../types/docker";
import {
  DockerLocalStatus,
  DockerLocalListContainers,
  DockerLocalContainerStart,
  DockerLocalContainerStop,
  DockerLocalContainerRestart,
  DockerLocalContainerRemove,
  DockerLocalListImages,
  DockerLocalImagePull,
  DockerLocalImageRemove,
  DockerLocalImageInspect,
  DockerLocalCreateTempContainer,
  DockerLocalRemoveImages,
  DockerLocalSystemInfo,
  DockerRemoteConnectProfile,
  DockerRemoteDisconnect,
  DockerRemoteListContainers,
  DockerRemoteContainerStart,
  DockerRemoteContainerStop,
  DockerRemoteContainerRestart,
  DockerRemoteContainerRemove,
  DockerRemoteListImages,
  DockerRemoteImagePull,
  DockerRemoteImageRemove,
  DockerRemoteImageInspect,
  DockerRemoteCreateTempContainer,
  DockerRemoteRemoveImages,
  DockerRemoteSystemInfo,
  DockerRemoteStatus,
} from "../../../wailsjs/go/main/App";
import { onSSHState, startSSHEventBridge } from "../../ssh/events";

type Props = {
  profiles: ProfileDTO[];
};

type View = "containers" | "images" | "system";
type Scope = "local" | "remote";

type RemoteSessionState = {
  profileId: string;
  sessionId: string | null;
  status?: DockerStatusDTO | null;
  lastError?: string | null;
  connecting?: boolean;
};

type DockerTabKind = "logs" | "shell" | "files";

type DockerTab = {
  id: string;
  kind: DockerTabKind;
  containerId: string;
  containerName: string;
  scope: Scope;
  sessionId?: string | null;
};

export function DockerMode({ profiles }: Props) {
  const [view, setView] = useState<View>("containers");
  const [scope, setScope] = useState<Scope>("local");
  const [localStatus, setLocalStatus] = useState<DockerStatusDTO | null>(null);
  const [containers, setContainers] = useState<DockerContainerDTO[]>([]);
  const [containersError, setContainersError] = useState<string | null>(null);
  const [containersBusy, setContainersBusy] = useState(false);
  const [activeContainerId, setActiveContainerId] = useState<string | null>(null);
  const [containerQuery, setContainerQuery] = useState("");
  const [images, setImages] = useState<DockerImageDTO[]>([]);
  const [danglingImages, setDanglingImages] = useState<DockerImageDTO[]>([]);
  const [notInUseImages, setNotInUseImages] = useState<DockerImageDTO[]>([]);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [imagesBusy, setImagesBusy] = useState(false);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [imageQuery, setImageQuery] = useState("");
  const [activeImageSource, setActiveImageSource] = useState<"normal" | "dangling" | null>(null);
  const [imageInspectById, setImageInspectById] = useState<Record<string, string>>({});
  const [imageInspectOpen, setImageInspectOpen] = useState(false);
  const [imageFilesContainerId, setImageFilesContainerId] = useState<string | null>(null);
  const [imageFilesImageId, setImageFilesImageId] = useState<string | null>(null);
  const [imageFilesError, setImageFilesError] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<DockerSystemDTO | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [systemBusy, setSystemBusy] = useState(false);
  const [danglingModalOpen, setDanglingModalOpen] = useState(false);
  const [danglingPreview, setDanglingPreview] = useState<{ count: number; sizeBytes: number } | null>(null);
  const [danglingBusy, setDanglingBusy] = useState(false);
  const [danglingError, setDanglingError] = useState<string | null>(null);
  const [notInUseModalOpen, setNotInUseModalOpen] = useState(false);
  const [notInUsePreview, setNotInUsePreview] = useState<{ count: number; sizeBytes: number } | null>(null);
  const [notInUseBusy, setNotInUseBusy] = useState(false);
  const [notInUseError, setNotInUseError] = useState<string | null>(null);

  const [remoteByProfile, setRemoteByProfile] = useState<Record<string, RemoteSessionState>>({});
  const [activeRemoteProfileId, setActiveRemoteProfileId] = useState<string | null>(null);
  const [dockerTabs, setDockerTabs] = useState<DockerTab[]>([]);
  const [activeDockerTabId, setActiveDockerTabId] = useState<string | null>(null);
  const [lastTabByContainer, setLastTabByContainer] = useState<Record<string, string>>({});

  useEffect(() => {
    void DockerLocalStatus()
      .then(setLocalStatus)
      .catch((e: any) => {
        setLocalStatus({ available: false, message: e?.message ?? String(e) });
      });
  }, []);

  useEffect(() => {
    startSSHEventBridge();
    const unsub = onSSHState((ev) => {
      setRemoteByProfile((prev) => {
        const next = { ...prev };
        Object.values(next).forEach((s) => {
          if (s.sessionId !== ev.id) return;
          if (ev.state === "connected") {
            s.lastError = null;
            s.connecting = false;
          } else {
            s.lastError = ev.error ?? null;
            s.connecting = false;
          }
        });
        return next;
      });
    });
    return () => unsub();
  }, []);

  const activeRemoteSession = useMemo(() => {
    if (!activeRemoteProfileId) return null;
    return remoteByProfile[activeRemoteProfileId] ?? null;
  }, [activeRemoteProfileId, remoteByProfile]);

  const activeDockerTab = useMemo(() => {
    if (!activeDockerTabId) return null;
    return dockerTabs.find((t) => t.id === activeDockerTabId) ?? null;
  }, [activeDockerTabId, dockerTabs]);

  const tabsByContainerKind = useMemo(() => {
    const out: Record<string, Set<DockerTabKind>> = {};
    dockerTabs.forEach((t) => {
      if (!out[t.containerId]) out[t.containerId] = new Set();
      out[t.containerId].add(t.kind);
    });
    return out;
  }, [dockerTabs]);

  useEffect(() => {
    if (!activeDockerTab) return;
    setActiveContainerId(activeDockerTab.containerId);
    setLastTabByContainer((prev) => ({ ...prev, [activeDockerTab.containerId]: activeDockerTab.id }));
  }, [activeDockerTab]);

  const refreshContainers = async () => {
    setContainersBusy(true);
    setContainersError(null);
    try {
      if (scope === "local") {
        const list = await DockerLocalListContainers();
        setContainers(list);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) {
          setContainers([]);
        } else {
          const list = await DockerRemoteListContainers(sessionId);
          setContainers(list);
        }
      }
    } catch (e: any) {
      setContainersError(e?.message ?? String(e));
      setContainers([]);
    } finally {
      setContainersBusy(false);
    }
  };

  useEffect(() => {
    if (view !== "containers") return;
    void refreshContainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope, activeRemoteSession?.sessionId]);

  const refreshImages = async () => {
    setImagesBusy(true);
    setImagesError(null);
    try {
      if (scope === "local") {
        const list = await DockerLocalListImages();
        const used = list.filter((img) => isImageUsedByContainers(img, containers));
        const dangling = list.filter((img) => isUntagged(img) && !isImageUsedByContainers(img, containers));
        const notInUse = list.filter((img) => !isUntagged(img) && !isImageUsedByContainers(img, containers));
        setImages(used);
        setDanglingImages(dangling);
        setNotInUseImages(notInUse);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) {
          setImages([]);
          setDanglingImages([]);
          setNotInUseImages([]);
        } else {
          const list = await DockerRemoteListImages(sessionId);
          const used = list.filter((img) => isImageUsedByContainers(img, containers));
          const dangling = list.filter((img) => isUntagged(img) && !isImageUsedByContainers(img, containers));
          const notInUse = list.filter((img) => !isUntagged(img) && !isImageUsedByContainers(img, containers));
          setImages(used);
          setDanglingImages(dangling);
          setNotInUseImages(notInUse);
        }
      }
    } catch (e: any) {
      setImagesError(e?.message ?? String(e));
      setImages([]);
      setDanglingImages([]);
      setNotInUseImages([]);
    } finally {
      setImagesBusy(false);
    }
  };

  useEffect(() => {
    if (view !== "images") return;
    const load = async () => {
      await refreshContainers();
      await refreshImages();
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope, activeRemoteSession?.sessionId]);

  const refreshLocalStatusAndView = async () => {
    try {
      const st = await DockerLocalStatus();
      setLocalStatus(st);
    } catch (e: any) {
      setLocalStatus({ available: false, message: e?.message ?? String(e) });
    }
    if (view === "containers") await refreshContainers();
    if (view === "images") await refreshImages();
    if (view === "system") await refreshSystem();
  };

  const runImageAction = async (imageId: string, action: "remove" | "pull") => {
    try {
      if (action === "pull") {
        const ref = prompt("Image name (e.g. nginx:latest):", "");
        if (!ref) return;
        if (scope === "local") {
          await DockerLocalImagePull(ref);
        } else {
          const sessionId = activeRemoteSession?.sessionId;
          if (!sessionId) throw new Error("Remote session not connected");
          await DockerRemoteImagePull(sessionId, ref);
        }
      } else {
        if (scope === "local") {
          await DockerLocalImageRemove(imageId, true);
        } else {
          const sessionId = activeRemoteSession?.sessionId;
          if (!sessionId) throw new Error("Remote session not connected");
          await DockerRemoteImageRemove(sessionId, imageId, true);
        }
      }
      await refreshImages();
    } catch (e: any) {
      setImagesError(e?.message ?? String(e));
    }
  };

  const selectImage = (id: string, source: "normal" | "dangling") => {
    setActiveImageId(id);
    setActiveImageSource(source);
    setImageInspectOpen(false);
  };

  const loadImageInspect = async (id: string) => {
    if (imageInspectById[id]) return;
    try {
      if (scope === "local") {
        const raw = await DockerLocalImageInspect(id);
        setImageInspectById((prev) => ({ ...prev, [id]: raw }));
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        const raw = await DockerRemoteImageInspect(sessionId, id);
        setImageInspectById((prev) => ({ ...prev, [id]: raw }));
      }
    } catch (e: any) {
      setImagesError(e?.message ?? String(e));
    }
  };

  const openImageFiles = async (img: DockerImageDTO) => {
    setImageFilesError(null);
    if (imageFilesContainerId) {
      return;
    }
    try {
      if (scope === "local") {
        const id = await DockerLocalCreateTempContainer(img.repository === "<none>" ? img.id : `${img.repository}:${img.tag}`);
        setImageFilesContainerId(id);
        setImageFilesImageId(img.id);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        const id = await DockerRemoteCreateTempContainer(sessionId, img.repository === "<none>" ? img.id : `${img.repository}:${img.tag}`);
        setImageFilesContainerId(id);
        setImageFilesImageId(img.id);
      }
    } catch (e: any) {
      setImageFilesError(e?.message ?? String(e));
    }
  };

  const closeImageFiles = async () => {
    if (!imageFilesContainerId) return;
    try {
      if (scope === "local") {
        await DockerLocalContainerRemove(imageFilesContainerId);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (sessionId) await DockerRemoteContainerRemove(sessionId, imageFilesContainerId);
      }
    } finally {
      setImageFilesContainerId(null);
      setImageFilesImageId(null);
    }
  };

  useEffect(() => {
    if (view !== "images") {
      void closeImageFiles();
      return;
    }
    if (imageFilesImageId && activeImageId && imageFilesImageId !== activeImageId) {
      void closeImageFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeImageId, scope, activeRemoteSession?.sessionId]);

  const openDanglingModal = async () => {
    setDanglingModalOpen(true);
    setDanglingError(null);
    setDanglingPreview({ count: danglingImages.length, sizeBytes: sumImageBytes(danglingImages) });
  };

  const confirmPruneDangling = async () => {
    setDanglingBusy(true);
    setDanglingError(null);
    try {
      if (danglingImages.length === 0) {
        setDanglingModalOpen(false);
        return;
      }
      if (scope === "local") {
        await DockerLocalRemoveImages(danglingImages.map((i) => i.id));
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteRemoveImages(sessionId, danglingImages.map((i) => i.id));
      }
      setDanglingModalOpen(false);
      await refreshImages();
    } catch (e: any) {
      setDanglingError(e?.message ?? String(e));
    } finally {
      setDanglingBusy(false);
    }
  };

  const openNotInUseModal = () => {
    setNotInUseModalOpen(true);
    setNotInUseError(null);
    setNotInUsePreview({ count: notInUseImages.length, sizeBytes: sumImageBytes(notInUseImages) });
  };

  const confirmPruneNotInUse = async () => {
    setNotInUseBusy(true);
    setNotInUseError(null);
    try {
      if (notInUseImages.length === 0) {
        setNotInUseModalOpen(false);
        return;
      }
      if (scope === "local") {
        await DockerLocalRemoveImages(notInUseImages.map((i) => i.id));
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteRemoveImages(sessionId, notInUseImages.map((i) => i.id));
      }
      setNotInUseModalOpen(false);
      await refreshImages();
    } catch (e: any) {
      setNotInUseError(e?.message ?? String(e));
    } finally {
      setNotInUseBusy(false);
    }
  };

  const pullContainerImage = async (imageRef: string) => {
    if (!imageRef) {
      setContainersError("Container image not set");
      return;
    }
    try {
      if (scope === "local") {
        await DockerLocalImagePull(imageRef);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        await DockerRemoteImagePull(sessionId, imageRef);
      }
    } catch (e: any) {
      setContainersError(e?.message ?? String(e));
    }
  };

  const refreshSystem = async () => {
    setSystemBusy(true);
    setSystemError(null);
    try {
      if (scope === "local") {
        setSystemInfo(await DockerLocalSystemInfo());
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) {
          setSystemInfo(null);
        } else {
          setSystemInfo(await DockerRemoteSystemInfo(sessionId));
        }
      }
    } catch (e: any) {
      setSystemError(e?.message ?? String(e));
      setSystemInfo(null);
    } finally {
      setSystemBusy(false);
    }
  };

  useEffect(() => {
    if (view !== "system") return;
    void refreshSystem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope, activeRemoteSession?.sessionId]);

  const runContainerAction = async (containerId: string, action: "start" | "stop" | "restart" | "remove") => {
    try {
      if (scope === "local") {
        if (action === "start") await DockerLocalContainerStart(containerId);
        if (action === "stop") await DockerLocalContainerStop(containerId);
        if (action === "restart") await DockerLocalContainerRestart(containerId);
        if (action === "remove") await DockerLocalContainerRemove(containerId);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        if (action === "start") await DockerRemoteContainerStart(sessionId, containerId);
        if (action === "stop") await DockerRemoteContainerStop(sessionId, containerId);
        if (action === "restart") await DockerRemoteContainerRestart(sessionId, containerId);
        if (action === "remove") await DockerRemoteContainerRemove(sessionId, containerId);
      }
      await refreshContainers();
    } catch (e: any) {
      setContainersError(e?.message ?? String(e));
    }
  };

  const openDockerTab = (kind: DockerTabKind, containerId: string, containerName: string) => {
    const sessionId = scope === "remote" ? activeRemoteSession?.sessionId ?? null : null;
    if (scope === "remote" && !sessionId) {
      setContainersError("Remote session not connected");
      return;
    }
    setView("containers");
    setActiveContainerId(containerId);
    const existing = dockerTabs.find((t) => t.containerId === containerId && t.kind === kind && t.scope === scope);
    if (existing) {
      if (activeDockerTabId === existing.id) {
        closeDockerTab(existing.id);
        return;
      }
      setActiveDockerTabId(existing.id);
      setLastTabByContainer((prev) => ({ ...prev, [containerId]: existing.id }));
      return;
    }
    const id = `docker-${kind}-${containerId}-${Math.random().toString(36).slice(2)}`;
    const tab: DockerTab = { id, kind, containerId, containerName, scope, sessionId };
    setDockerTabs((prev) => [...prev, tab]);
    setActiveDockerTabId(id);
    setLastTabByContainer((prev) => ({ ...prev, [containerId]: id }));
  };

  const activateContainerDefault = (containerId: string, containerName: string) => {
    const lastId = lastTabByContainer[containerId];
    const lastTab = lastId ? dockerTabs.find((t) => t.id === lastId) : null;
    if (lastTab) {
      setActiveDockerTabId(lastTab.id);
      setActiveContainerId(containerId);
      return;
    }
    openDockerTab("logs", containerId, containerName);
  };

  const closeDockerTab = (tabId: string) => {
    setDockerTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveDockerTabId((cur) => (cur === tabId ? (next.length > 0 ? next[next.length - 1].id : null) : cur));
      return next;
    });
    setLastTabByContainer((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k] === tabId) delete next[k];
      });
      return next;
    });
  };

  const connectRemote = async (profileId: string) => {
    setRemoteByProfile((prev) => ({
      ...prev,
      [profileId]: { profileId, sessionId: prev[profileId]?.sessionId ?? null, connecting: true, lastError: null },
    }));
    try {
      const sessionId = await DockerRemoteConnectProfile(profileId);
      setRemoteByProfile((prev) => ({
        ...prev,
        [profileId]: { profileId, sessionId, connecting: false, lastError: null },
      }));
      setActiveRemoteProfileId(profileId);
      try {
        const status = await DockerRemoteStatus(sessionId);
        setRemoteByProfile((prev) => ({
          ...prev,
          [profileId]: { ...prev[profileId], status },
        }));
      } catch (e: any) {
        setRemoteByProfile((prev) => ({
          ...prev,
          [profileId]: {
            ...prev[profileId],
            status: { available: false, message: e?.message ?? String(e) },
            lastError: e?.message ?? String(e),
          },
        }));
      }
    } catch (e: any) {
      setRemoteByProfile((prev) => ({
        ...prev,
        [profileId]: { profileId, sessionId: null, connecting: false, lastError: e?.message ?? String(e) },
      }));
    }
  };

  const disconnectRemote = async (profileId: string) => {
    const cur = remoteByProfile[profileId];
    if (!cur?.sessionId) return;
    await DockerRemoteDisconnect(cur.sessionId);
    setRemoteByProfile((prev) => ({
      ...prev,
      [profileId]: { profileId, sessionId: null, connecting: false, lastError: null, status: null },
    }));
  };

  const left = (
    <DockerSidebar
      view={view}
      scope={scope}
      profiles={profiles}
      remoteByProfile={remoteByProfile}
      activeRemoteProfileId={activeRemoteProfileId}
      containers={filterContainers(containers, containerQuery)}
      containersBusy={containersBusy}
      containersError={containersError}
      activeContainerId={activeContainerId}
      activeTabContainerId={activeDockerTab?.containerId ?? null}
      activeTabKind={activeDockerTab?.kind ?? null}
      tabsByContainerKind={tabsByContainerKind}
      images={filterImages(images, imageQuery)}
      danglingImages={filterImages(danglingImages, imageQuery)}
      notInUseImages={filterImages(notInUseImages, imageQuery)}
      imagesBusy={imagesBusy}
      imagesError={imagesError}
      activeImageId={activeImageId}
      systemInfo={systemInfo}
      systemError={systemError}
      imageQuery={imageQuery}
      onImageQueryChange={setImageQuery}
      containerQuery={containerQuery}
      onContainerQueryChange={setContainerQuery}
      onViewChange={setView}
      onScopeChange={setScope}
      onSelectRemoteProfile={setActiveRemoteProfileId}
      onConnectRemote={connectRemote}
      onDisconnectRemote={disconnectRemote}
      onRefreshContainers={() => void refreshContainers()}
      onContainerAction={runContainerAction}
      onPullContainerImage={pullContainerImage}
      onSelectContainer={(id, name) => activateContainerDefault(id, name)}
      onImageAction={runImageAction}
      onSelectImage={(id, source) => selectImage(id, source)}
      onOpenDanglingModal={() => void openDanglingModal()}
      onOpenNotInUseModal={openNotInUseModal}
      onRefreshSystem={() => void refreshSystem()}
      onOpenLogs={(containerId, containerName) => openDockerTab("logs", containerId, containerName)}
      onOpenShell={(containerId, containerName) => openDockerTab("shell", containerId, containerName)}
      onOpenFiles={(containerId, containerName) => openDockerTab("files", containerId, containerName)}
      onRefreshLocalStatus={refreshLocalStatusAndView}
      localStatus={localStatus}
    />
  );

  const right = (
    <div className="docker-main">
      {view === "containers" ? (
        <div className="panel">
          <div className="docker-tabs-bar">
            {dockerTabs.length === 0 ? (
              <div className="muted">No active tabs.</div>
            ) : (
              dockerTabs.map((t) => {
                const isActive = t.id === activeDockerTabId;
                return (
                  <button
                    key={t.id}
                    className={`docker-tabbtn ${isActive ? "active" : ""} kind-${t.kind}`}
                    type="button"
                    onClick={() => {
                      setActiveDockerTabId(t.id);
                      setActiveContainerId(t.containerId);
                      setLastTabByContainer((prev) => ({ ...prev, [t.containerId]: t.id }));
                    }}
                    title={t.containerName}
                  >
                    <span className="docker-tabbtn-icon">{tabIcon(t.kind)}</span>
                    <span className="docker-tabbtn-label">{trimContainerName(t.containerName)}</span>
                    <span
                      className="docker-tabbtn-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeDockerTab(t.id);
                      }}
                    >
                      ×
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="panel-titlebar">
            <div className="panel-title">Sessions</div>
            <div className="panel-meta">
              {activeDockerTab
                ? `${trimContainerName(activeDockerTab.containerName)} — ${activeDockerTab.kind}`
                : "Select a container"}
            </div>
          </div>
          <div className="panel-body">
            {activeDockerTab ? (
              activeDockerTab.kind === "logs" ? (
                <DockerLogsPanel
                  scope={activeDockerTab.scope}
                  sessionId={activeDockerTab.sessionId ?? null}
                  containerId={activeDockerTab.containerId}
                  onClose={() => closeDockerTab(activeDockerTab.id)}
                />
              ) : activeDockerTab.kind === "shell" ? (
                <DockerShellPanel
                  scope={activeDockerTab.scope}
                  sessionId={activeDockerTab.sessionId ?? null}
                  containerId={activeDockerTab.containerId}
                  onClose={() => closeDockerTab(activeDockerTab.id)}
                />
              ) : (
                <DockerFilesPanel
                  scope={activeDockerTab.scope}
                  sessionId={activeDockerTab.sessionId ?? null}
                  containerId={activeDockerTab.containerId}
                />
              )
            ) : (
              <div className="empty">Pick a container and open Logs, Shell, or Files.</div>
            )}
          </div>
        </div>
      ) : view === "images" ? (
        <div className="panel">
          <div className="panel-titlebar">
            <div className="panel-title">Image</div>
            <div className="panel-meta">
              {activeImageId ? "Selected image" : "Select an image"}
            </div>
          </div>
          <div className="panel-body">
            {imagesError ? <div className="error">{imagesError}</div> : null}
            {!activeImageId ? (
              <div className="empty">Pick an image on the left to see details.</div>
            ) : (
              (() => {
                let img = images.find((i) => i.id === activeImageId) ?? null;
                if (!img) {
                  img = danglingImages.find((i) => i.id === activeImageId) ?? null;
                }
                if (!img) return <div className="empty">Image not found.</div>;
                const { short, full } = formatImageDate(img);
                const related = containers.filter((c) => matchImageToContainer(img, c));
                return (
                  <div>
                    <div className="mono">{img.repository}:{img.tag}</div>
                    <div className="muted">Image ID: {img.id}</div>
                    <div className="muted" title={`Created: ${full}`}>Created: {short}</div>
                    <div className="muted">Size: {img.size ?? "-"}</div>
                    {imageFilesError ? <div className="error">{imageFilesError}</div> : null}
                    <div className="docker-actions" style={{ marginTop: 10 }}>
                      <button className="btn" type="button" onClick={() => void openImageFiles(img)} disabled={!!imageFilesContainerId}>
                        Files
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => {
                          setImageInspectOpen((v) => !v);
                          if (!imageInspectById[img.id]) void loadImageInspect(img.id);
                        }}
                      >
                        {imageInspectOpen ? "Hide inspect" : "Show inspect"}
                      </button>
                      {imageFilesContainerId ? (
                        <button className="btn btn-ghost" type="button" onClick={() => void closeImageFiles()}>
                          Close files
                        </button>
                      ) : null}
                    </div>
                    {related.length > 0 ? (
                      <div style={{ marginTop: 12 }}>
                        <div className="muted">Used by containers:</div>
                        <div className="docker-actions" style={{ marginTop: 6 }}>
                          {related.map((c) => (
                            <button
                              key={c.id}
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => {
                                setView("containers");
                                setActiveContainerId(c.id);
                              }}
                            >
                              {c.name || c.id.slice(0, 12)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="muted" style={{ marginTop: 12 }}>
                        No containers reference this image.
                      </div>
                    )}
                    {imageFilesContainerId && imageFilesImageId === img.id ? (
                      <div style={{ marginTop: 12, height: 360 }}>
                        <DockerFilesPanel
                          scope={scope}
                          sessionId={activeRemoteSession?.sessionId ?? null}
                          containerId={imageFilesContainerId}
                        />
                      </div>
                    ) : null}
                    {imageInspectOpen && imageInspectById[img.id] ? (
                      <pre className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
                        {imageInspectById[img.id]}
                      </pre>
                    ) : null}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-titlebar">
            <div className="panel-title">System</div>
            <div className="panel-meta">{systemInfo?.status?.version ?? ""}</div>
          </div>
          <div className="panel-body">
            {systemError ? <div className="error">{systemError}</div> : null}
            {systemBusy ? <div className="muted">Loading...</div> : null}
            {!systemInfo ? <div className="empty">No system info.</div> : null}
            {systemInfo?.diskUsageText ? (
              <pre className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {systemInfo.diskUsageText}
              </pre>
            ) : null}
            {systemInfo?.infoText ? (
              <pre className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {systemInfo.infoText}
              </pre>
            ) : null}
          </div>
        </div>
      )}
      {danglingModalOpen ? (
        <div className="docker-modal-overlay" role="dialog" aria-modal="true">
          <div className="docker-modal docker-modal-compact">
            <div className="docker-modal-title">
              <div>Prune dangling images</div>
              <button
                className="docker-modal-close"
                type="button"
                aria-label="Close"
                onClick={() => setDanglingModalOpen(false)}
                disabled={danglingBusy}
              >
                ×
              </button>
            </div>
            <div className="docker-modal-body">
              {danglingError ? <div className="error">{danglingError}</div> : null}
              {danglingPreview ? (
                <div>
                  <div>Dangling images: {danglingPreview.count}</div>
                  <div>Estimated reclaimed space: {formatBytes(danglingPreview.sizeBytes)}</div>
                </div>
              ) : null}
              <div className="modal-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setDanglingModalOpen(false)} disabled={danglingBusy}>
                  Cancel
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void confirmPruneDangling()} disabled={danglingBusy}>
                  Prune
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {notInUseModalOpen ? (
        <div className="docker-modal-overlay" role="dialog" aria-modal="true">
          <div className="docker-modal docker-modal-compact">
            <div className="docker-modal-title">
              <div>Prune not in use images</div>
              <button
                className="docker-modal-close"
                type="button"
                aria-label="Close"
                onClick={() => setNotInUseModalOpen(false)}
                disabled={notInUseBusy}
              >
                ×
              </button>
            </div>
            <div className="docker-modal-body">
              {notInUseError ? <div className="error">{notInUseError}</div> : null}
              {notInUsePreview ? (
                <div>
                  <div>Not in use images: {notInUsePreview.count}</div>
                  <div>Estimated reclaimed space: {formatBytes(notInUsePreview.sizeBytes)}</div>
                </div>
              ) : null}
              <div className="modal-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setNotInUseModalOpen(false)} disabled={notInUseBusy}>
                  Cancel
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void confirmPruneNotInUse()} disabled={notInUseBusy}>
                  Prune
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return <SplitView left={left} right={right} initialLeftPct={30} minLeftPx={320} minRightPx={520} />;
}

function formatBytes(n: number) {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatImageDate(img: DockerImageDTO): { short: string; full: string } {
  const raw = img.createdAt ?? img.createdSince ?? "";
  if (!raw) return { short: "unknown", full: "unknown" };
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return { short: d.toLocaleDateString(), full: d.toLocaleString() };
  }
  return { short: raw, full: raw };
}

function matchImageToContainer(img: DockerImageDTO, c: DockerContainerDTO): boolean {
  const ref = `${img.repository}:${img.tag}`;
  const cImage = String(c.image ?? "");
  if (cImage === ref) return true;
  if (cImage.split("@")[0] === ref) return true;
  if (img.repository !== "<none>" && cImage.endsWith(`/${ref}`)) return true;
  if (img.tag === "latest" && cImage === img.repository) return true;
  if (img.tag === "latest" && cImage.endsWith(`/${img.repository}`)) return true;
  const norm = (s: string) => s.replace(/^sha256:/, "").toLowerCase();
  if (cImage.startsWith("sha256:") && img.id) {
    const a = norm(cImage);
    const b = norm(img.id);
    if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  }
  if (c.imageId && img.id) {
    const a = norm(c.imageId);
    const b = norm(img.id);
    if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

function filterImages(list: DockerImageDTO[], q: string): DockerImageDTO[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((img) => {
    const id = String(img.id ?? "").toLowerCase().replace(/^sha256:/, "");
    const repo = String(img.repository ?? "").toLowerCase();
    const tag = String(img.tag ?? "").toLowerCase();
    const name = `${repo}:${tag}`;
    return id.includes(needle) || repo.includes(needle) || tag.includes(needle) || name.includes(needle);
  });
}

function filterContainers(list: DockerContainerDTO[], q: string): DockerContainerDTO[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((c) => {
    const name = String(c.name ?? "").toLowerCase();
    const image = String(c.image ?? "").toLowerCase();
    const imageId = String(c.imageId ?? "").toLowerCase().replace(/^sha256:/, "");
    const id = String(c.id ?? "").toLowerCase().replace(/^sha256:/, "");
    return (
      name.includes(needle) ||
      image.includes(needle) ||
      imageId.includes(needle) ||
      id.includes(needle)
    );
  });
}

function isUntagged(img: DockerImageDTO): boolean {
  return img.repository === "<none>" && img.tag === "<none>";
}

function isImageUsedByContainers(img: DockerImageDTO, containers: DockerContainerDTO[]): boolean {
  return containers.some((c) => matchImageToContainer(img, c));
}

function sumImageBytes(list: DockerImageDTO[]): number {
  return list.reduce((acc, img) => acc + (img.sizeBytes ?? 0), 0);
}

function tabIcon(kind: DockerTabKind): string {
  if (kind === "logs") return "🧾";
  if (kind === "shell") return "⌘";
  return "📁";
}

function trimContainerName(name: string): string {
  const raw = String(name ?? "");
  if (!raw) return "container";
  const parts = raw.split("-");
  if (parts.length <= 1) return raw;
  return parts.slice(1).join("-");
}
