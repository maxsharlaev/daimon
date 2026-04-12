import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { MacroDTO, PlaceDTO, ProfileDTO, ProfileGroupDTO } from "../../types/models";
import { SplitView } from "../SplitView";
import { DockerSidebar } from "./DockerSidebar";
import { DockerLogsPanel } from "./DockerLogsPanel";
import { DockerShellPanel } from "./DockerShellPanel";
import { DockerFilesPanel } from "./DockerFilesPanel";
import { PlacesPanel } from "../PlacesPanel";
import { MacrosPanel } from "../MacrosPanel";
import { MacroEditorModal } from "../MacroEditorModal";
import { MacroRunModal } from "../MacroRunModal";
import type {
  DockerContainerDTO,
  DockerImageDTO,
  DockerStatusDTO,
  DockerSystemDTO,
  DockerVolumeDTO,
  DockerVolumeDetailsDTO,
  DockerNetworkDTO,
  DockerNetworkDetailsDTO,
} from "../../types/docker";
import { buildDockerPlaceProfileId } from "../../utils/dockerPlaceProfileId";
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
  DockerLocalListVolumes,
  DockerLocalVolumeInspect,
  DockerLocalVolumeRemove,
  DockerLocalCreateVolumeTempContainer,
  DockerLocalCleanupTempContainers,
  DockerLocalListNetworks,
  DockerLocalNetworkInspect,
  DockerLocalNetworkRemove,
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
  DockerRemoteListVolumes,
  DockerRemoteVolumeInspect,
  DockerRemoteVolumeRemove,
  DockerRemoteCreateVolumeTempContainer,
  DockerRemoteCleanupTempContainers,
  DockerRemoteListNetworks,
  DockerRemoteNetworkInspect,
  DockerRemoteNetworkRemove,
  DockerRemoteStatus,
  DockerStreamSend,
  UpsertMacro,
  UpsertPlace,
} from "../../../wailsjs/go/main/App";
import { onSSHState, startSSHEventBridge } from "../../ssh/events";

import type { AgentContext } from "../../types/agent";

export type DockerAgentOutputDock = {
  visible: boolean;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
  children: ReactNode;
};

type Props = {
  profiles: ProfileDTO[];
  groups: ProfileGroupDTO[];
  onOpenSecrets?: (profileId: string) => void;
  /** Report context for the AI Agent panel (active container / SSH session). */
  onAgentContext?: (ctx: AgentContext) => void;
  /** Agent shell output journal next to Logs/Shell/Files in the main Docker pane. */
  agentOutputDock?: DockerAgentOutputDock | null;
  /** User focused a container workspace tab — hide agent output pane. */
  onClearAgentOutputDock?: () => void;
};

type View = "containers" | "images" | "volumes" | "networks" | "system";
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
  initialPath?: string;
  profileId?: string | null;
  profileName?: string | null;
};

type DockerLeftMode = "sidebar" | "places" | "macros";

type DockerLeftContext = {
  tabId: string;
  containerId: string;
  containerName: string;
  profileId: string;
  profileName: string;
};

function shellQuote(p: string) {
  const s = String(p ?? "");
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

export function DockerMode({
  profiles,
  groups,
  onOpenSecrets,
  onAgentContext,
  agentOutputDock,
  onClearAgentOutputDock,
}: Props) {
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
  const [volumes, setVolumes] = useState<DockerVolumeDTO[]>([]);
  const [volumesError, setVolumesError] = useState<string | null>(null);
  const [volumesBusy, setVolumesBusy] = useState(false);
  const [activeVolumeName, setActiveVolumeName] = useState<string | null>(null);
  const [volumeDetails, setVolumeDetails] = useState<DockerVolumeDetailsDTO | null>(null);
  const [volumeMode, setVolumeMode] = useState<"details" | "files">("details");
  const [volumeDetailsByName, setVolumeDetailsByName] = useState<Record<string, DockerVolumeDetailsDTO>>({});
  const [volumeDetailsBusy, setVolumeDetailsBusy] = useState(false);
  const [volumeFilesContainerId, setVolumeFilesContainerId] = useState<string | null>(null);
  const [volumeFilesVolumeName, setVolumeFilesVolumeName] = useState<string | null>(null);
  const [volumeFilesError, setVolumeFilesError] = useState<string | null>(null);
  const [networks, setNetworks] = useState<DockerNetworkDTO[]>([]);
  const [networksError, setNetworksError] = useState<string | null>(null);
  const [activeNetworkId, setActiveNetworkId] = useState<string | null>(null);
  const [networkDetails, setNetworkDetails] = useState<DockerNetworkDetailsDTO | null>(null);
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
  const [leftMode, setLeftMode] = useState<DockerLeftMode>("sidebar");
  const [leftContext, setLeftContext] = useState<DockerLeftContext | null>(null);
  const [shellStreamByTab, setShellStreamByTab] = useState<Record<string, string | null>>({});
  const [placesRefreshToken, setPlacesRefreshToken] = useState(0);
  const [macrosRefreshToken, setMacrosRefreshToken] = useState(0);
  const [placeModal, setPlaceModal] = useState<{ open: boolean; id?: string; profileId: string; name: string; remotePath: string }>({
    open: false,
    profileId: "",
    name: "",
    remotePath: "",
  });
  const [macroEditorOpen, setMacroEditorOpen] = useState(false);
  const [macroEditorMacro, setMacroEditorMacro] = useState<MacroDTO | null>(null);
  const [macroRunOpen, setMacroRunOpen] = useState(false);
  const [macroRunMacro, setMacroRunMacro] = useState<MacroDTO | null>(null);
  const [, setSessionInvalidationCounter] = useState(0);
  const activeRemoteSessionIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    void DockerLocalCleanupTempContainers("");
    return () => {
      void DockerLocalCleanupTempContainers("");
      const sessionId = activeRemoteSessionIdRef.current;
      if (sessionId) void DockerRemoteCleanupTempContainers(sessionId, "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRemoteSession = useMemo(() => {
    if (!activeRemoteProfileId) return null;
    return remoteByProfile[activeRemoteProfileId] ?? null;
  }, [activeRemoteProfileId, remoteByProfile]);

  useEffect(() => {
    activeRemoteSessionIdRef.current = activeRemoteSession?.sessionId ?? null;
  }, [activeRemoteSession?.sessionId]);

  const activeDockerTab = useMemo(() => {
    if (!activeDockerTabId) return null;
    return dockerTabs.find((t) => t.id === activeDockerTabId) ?? null;
  }, [activeDockerTabId, dockerTabs]);

  const resolvedSessionIdByTabRef = useRef<Record<string, string>>({});

  const resolveTabSessionId = (t: DockerTab): string | null => {
    if (t.scope !== "remote" || !t.profileId) return t.sessionId ?? null;
    const parts = t.profileId.split(":");
    const profileId = parts[2];
    const current =
      (profileId && remoteByProfile[profileId]?.sessionId) ?? t.sessionId ?? null;
    if (current) resolvedSessionIdByTabRef.current[t.id] = current;
    return resolvedSessionIdByTabRef.current[t.id] ?? current;
  };

  useEffect(() => {
    if (!onAgentContext) return;
    const tab = activeDockerTab;
    if (tab) {
      const sid = resolveTabSessionId(tab);
      onAgentContext({
        mode: "docker",
        sessionId: sid ?? "",
        profileId: tab.profileId ?? activeRemoteProfileId ?? "",
        dockerScope: tab.scope,
        containerId: tab.containerId,
      });
      return;
    }
    const rsid =
      scope === "remote" && activeRemoteProfileId ? remoteByProfile[activeRemoteProfileId]?.sessionId ?? "" : "";
    onAgentContext({
      mode: "docker",
      sessionId: rsid,
      profileId: activeRemoteProfileId ?? "",
      dockerScope: scope,
      containerId: activeContainerId ?? "",
    });
  }, [onAgentContext, activeDockerTab, scope, activeContainerId, activeRemoteProfileId, remoteByProfile]);

  const leftProfileShim = useMemo<ProfileDTO[]>(
    () =>
      leftContext
        ? [
            {
              id: leftContext.profileId,
              groupId: "docker",
              name: leftContext.profileName,
              host: "",
              port: 0,
              username: "",
              sshOptionsJson: "",
              createdAt: "",
              updatedAt: "",
            },
          ]
        : [],
    [leftContext]
  );

  const openLeftPanel = useCallback(
    (mode: DockerLeftMode, tab: DockerTab) => {
      const profileId =
        tab.profileId ??
        buildDockerPlaceProfileId(tab.scope, tab.scope === "remote" ? activeRemoteProfileId : null, tab.containerName, tab.containerId);
      const profileName = tab.profileName ?? trimContainerName(tab.containerName);
      setLeftContext({ tabId: tab.id, containerId: tab.containerId, containerName: tab.containerName, profileId, profileName });
      setLeftMode(mode);
    },
    [activeRemoteProfileId]
  );

  const tabsByContainerKind = useMemo(() => {
    const out: Record<string, Set<DockerTabKind>> = {};
    dockerTabs.forEach((t) => {
      if (!out[t.containerId]) out[t.containerId] = new Set();
      out[t.containerId].add(t.kind);
    });
    return out;
  }, [dockerTabs]);

  const volumesInUse = useMemo(() => {
    return volumes.filter((v) => {
      const details = volumeDetailsByName[v.name];
      if (Array.isArray(details?.usedBy) && details!.usedBy!.length > 0) return true;
      const ref = details?.refCount;
      return typeof ref === "number" && ref > 0;
    });
  }, [volumes, volumeDetailsByName]);

  const volumesNotInUse = useMemo(() => {
    return volumes.filter((v) => {
      const details = volumeDetailsByName[v.name];
      if (Array.isArray(details?.usedBy) && details!.usedBy!.length > 0) return false;
      const ref = details?.refCount;
      if (typeof ref !== "number") return true;
      return ref <= 0;
    });
  }, [volumes, volumeDetailsByName]);

  useEffect(() => {
    if (!activeDockerTab) return;
    setActiveContainerId(activeDockerTab.containerId);
    setLastTabByContainer((prev) => ({ ...prev, [activeDockerTab.containerId]: activeDockerTab.id }));
  }, [activeDockerTab]);

  useEffect(() => {
    if (view !== "containers" && leftMode !== "sidebar") {
      setLeftMode("sidebar");
    }
  }, [leftMode, view]);

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

  useEffect(() => {
    if (view !== "volumes") return;
    void refreshVolumes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope, activeRemoteSession?.sessionId]);

  useEffect(() => {
    if (view !== "networks") return;
    void refreshNetworks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope, activeRemoteSession?.sessionId]);

  useEffect(() => {
    if (view === "volumes") return;
    if (volumeFilesContainerId) {
      void closeVolumeFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope]);

  const refreshLocalStatusAndView = async () => {
    try {
      const st = await DockerLocalStatus();
      setLocalStatus(st);
    } catch (e: any) {
      setLocalStatus({ available: false, message: e?.message ?? String(e) });
    }
    if (view === "containers") await refreshContainers();
    if (view === "images") await refreshImages();
    if (view === "volumes") await refreshVolumes();
    if (view === "networks") await refreshNetworks();
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
    setImageInspectOpen(true);
    void loadImageInspect(id);
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

  const refreshVolumes = async () => {
    setVolumesBusy(true);
    setVolumesError(null);
    try {
      let list: DockerVolumeDTO[] = [];
      if (scope === "local") {
        list = await DockerLocalListVolumes();
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) {
          list = [];
        } else {
          list = await DockerRemoteListVolumes(sessionId);
        }
      }
      setVolumes(list);
      const entries = await Promise.all(
        list.map(async (v) => {
          try {
            if (scope === "local") {
              return [v.name, await DockerLocalVolumeInspect(v.name)] as const;
            }
            const sessionId = activeRemoteSession?.sessionId;
            if (!sessionId) return null;
            return [v.name, await DockerRemoteVolumeInspect(sessionId, v.name)] as const;
          } catch {
            return null;
          }
        })
      );
      const map: Record<string, DockerVolumeDetailsDTO> = {};
      entries.forEach((entry) => {
        if (!entry) return;
        map[entry[0]] = entry[1];
      });
      setVolumeDetailsByName(map);
    } catch (e: any) {
      setVolumesError(e?.message ?? String(e));
      setVolumes([]);
      setVolumeDetailsByName({});
    } finally {
      setVolumesBusy(false);
    }
  };

  const refreshNetworks = async () => {
    setNetworksError(null);
    try {
      if (scope === "local") {
        setNetworks(await DockerLocalListNetworks());
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) {
          setNetworks([]);
        } else {
          setNetworks(await DockerRemoteListNetworks(sessionId));
        }
      }
    } catch (e: any) {
      setNetworksError(e?.message ?? String(e));
      setNetworks([]);
    }
  };

  const loadVolumeDetails = async (name: string, mode: "details" = "details") => {
    if (volumeFilesContainerId && volumeFilesVolumeName && volumeFilesVolumeName !== name) {
      await closeVolumeFiles();
    }
    setActiveVolumeName(name);
    setVolumeMode(mode);
    setVolumesError(null);
    setVolumeDetailsBusy(true);
    try {
      if (scope === "local") {
        const details = await DockerLocalVolumeInspect(name);
        setVolumeDetails(details);
        setVolumeDetailsByName((prev) => ({ ...prev, [name]: details }));
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        const details = await DockerRemoteVolumeInspect(sessionId, name);
        setVolumeDetails(details);
        setVolumeDetailsByName((prev) => ({ ...prev, [name]: details }));
      }
    } catch (e: any) {
      setVolumesError(e?.message ?? String(e));
      setVolumeDetails(null);
    } finally {
      setVolumeDetailsBusy(false);
    }
  };

  const loadNetworkDetails = async (id: string) => {
    setActiveNetworkId(id);
    setNetworksError(null);
    try {
      if (scope === "local") {
        setNetworkDetails(await DockerLocalNetworkInspect(id));
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        setNetworkDetails(await DockerRemoteNetworkInspect(sessionId, id));
      }
    } catch (e: any) {
      setNetworksError(e?.message ?? String(e));
      setNetworkDetails(null);
    }
  };

  const closeVolumeFiles = async () => {
    if (!volumeFilesContainerId) return;
    try {
      if (scope === "local") {
        await DockerLocalContainerRemove(volumeFilesContainerId);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (sessionId) await DockerRemoteContainerRemove(sessionId, volumeFilesContainerId);
      }
    } catch {
      // ignore cleanup errors
    } finally {
      setVolumeFilesContainerId(null);
      setVolumeFilesVolumeName(null);
    }
  };

  const openVolumeFiles = async (name: string) => {
    setActiveVolumeName(name);
    setVolumeMode("files");
    setVolumeFilesError(null);
    if (volumeFilesContainerId && volumeFilesVolumeName === name) return;
    if (volumeFilesContainerId) await closeVolumeFiles();
    try {
      if (scope === "local") {
        const id = await DockerLocalCreateVolumeTempContainer(name);
        setVolumeFilesContainerId(id);
      } else {
        const sessionId = activeRemoteSession?.sessionId;
        if (!sessionId) throw new Error("Remote session not connected");
        const id = await DockerRemoteCreateVolumeTempContainer(sessionId, name);
        setVolumeFilesContainerId(id);
      }
      setVolumeFilesVolumeName(name);
    } catch (e: any) {
      setVolumeFilesError(e?.message ?? String(e));
      setVolumeFilesContainerId(null);
      setVolumeFilesVolumeName(null);
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

  const openDockerTab = (kind: DockerTabKind, containerId: string, containerName: string, initialPath?: string) => {
    onClearAgentOutputDock?.();
    const sessionId = scope === "remote" ? activeRemoteSession?.sessionId ?? null : null;
    if (scope === "remote" && !sessionId) {
      setContainersError("Remote session not connected");
      return;
    }
    setView("containers");
    setActiveContainerId(containerId);
    const existing = dockerTabs.find((t) => t.containerId === containerId && t.kind === kind && t.scope === scope);
    if (existing) {
      if (activeDockerTabId === existing.id && !initialPath) {
        closeDockerTab(existing.id);
        return;
      }
      if (initialPath && existing.kind === "files") {
        setDockerTabs((prev) => prev.map((t) => (t.id === existing.id ? { ...t, initialPath } : t)));
      }
      setActiveDockerTabId(existing.id);
      setLastTabByContainer((prev) => ({ ...prev, [containerId]: existing.id }));
      return;
    }
    const remoteProfileName = scope === "remote" ? profiles.find((p) => p.id === activeRemoteProfileId)?.name ?? activeRemoteProfileId ?? "remote" : null;
    const dockerProfileId = buildDockerPlaceProfileId(scope, scope === "remote" ? activeRemoteProfileId : null, containerName, containerId);
    const dockerProfileName =
      scope === "local"
        ? `Docker local · ${trimContainerName(containerName)}`
        : `Docker ${remoteProfileName} · ${trimContainerName(containerName)}`;
    const id = `docker-${kind}-${containerId}-${Math.random().toString(36).slice(2)}`;
    const tab: DockerTab = {
      id,
      kind,
      containerId,
      containerName,
      scope,
      sessionId,
      initialPath,
      profileId: dockerProfileId,
      profileName: dockerProfileName,
    };
    setDockerTabs((prev) => [...prev, tab]);
    setActiveDockerTabId(id);
    setLastTabByContainer((prev) => ({ ...prev, [containerId]: id }));
  };

  const activateContainerDefault = (containerId: string, containerName: string) => {
    const lastId = lastTabByContainer[containerId];
    const lastTab = lastId ? dockerTabs.find((t) => t.id === lastId) : null;
    if (lastTab) {
      onClearAgentOutputDock?.();
      setActiveDockerTabId(lastTab.id);
      setActiveContainerId(containerId);
      return;
    }
    openDockerTab("logs", containerId, containerName);
  };

  const closeDockerTab = (tabId: string) => {
    delete resolvedSessionIdByTabRef.current[tabId];
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
    setShellStreamByTab((prev) => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    if (leftContext?.tabId === tabId) {
      setLeftMode("sidebar");
      setLeftContext(null);
    }
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
    try {
      await DockerRemoteCleanupTempContainers(cur.sessionId, "");
    } catch {
      // ignore cleanup errors
    }
    await DockerRemoteDisconnect(cur.sessionId);
    setRemoteByProfile((prev) => ({
      ...prev,
      [profileId]: { profileId, sessionId: null, connecting: false, lastError: null, status: null },
    }));
    const prefix = `docker:remote:${profileId}:`;
    setDockerTabs((prev) => {
      const next = prev.filter((t) => t.scope !== "remote" || !t.profileId || !t.profileId.startsWith(prefix));
      return next;
    });
    setActiveDockerTabId((curId) => {
      const remaining = dockerTabs.filter((t) => t.scope !== "remote" || !t.profileId || !t.profileId.startsWith(prefix));
      const stillExists = remaining.some((t) => t.id === curId);
      if (stillExists) return curId;
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
    setLastTabByContainer((prev) => {
      const idsToRemove = new Set(dockerTabs.filter((t) => t.scope === "remote" && t.profileId?.startsWith(prefix)).map((t) => t.id));
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (idsToRemove.has(next[k])) delete next[k];
      });
      return next;
    });
    setShellStreamByTab((prev) => {
      const idsToRemove = new Set(dockerTabs.filter((t) => t.scope === "remote" && t.profileId?.startsWith(prefix)).map((t) => t.id));
      const next = { ...prev };
      idsToRemove.forEach((id) => delete next[id]);
      return next;
    });
    dockerTabs.forEach((t) => {
      if (t.scope === "remote" && t.profileId?.startsWith(prefix)) delete resolvedSessionIdByTabRef.current[t.id];
    });
    setLeftContext((ctx) => {
      if (!ctx) return null;
      if (ctx.profileId?.startsWith(prefix)) return null;
      return ctx;
    });
  };

  const left = leftMode === "sidebar" ? (
    <DockerSidebar
      view={view}
      scope={scope}
      profiles={profiles}
      groups={groups}
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
      volumesInUse={volumesInUse}
      volumesNotInUse={volumesNotInUse}
      volumesError={volumesError}
      volumesBusy={volumesBusy}
      activeVolumeName={activeVolumeName}
      volumeDetailsByName={volumeDetailsByName}
      networks={networks}
      networksError={networksError}
      activeNetworkId={activeNetworkId}
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
      onSelectVolume={(name) => loadVolumeDetails(name, "details")}
      onVolumeFiles={(name) => void openVolumeFiles(name)}
      onVolumeRemove={async (name) => {
        try {
          if (scope === "local") {
            await DockerLocalVolumeRemove(name);
          } else {
            const sessionId = activeRemoteSession?.sessionId;
            if (!sessionId) throw new Error("Remote session not connected");
            await DockerRemoteVolumeRemove(sessionId, name);
          }
          await refreshVolumes();
        } catch (e: any) {
          setVolumesError(e?.message ?? String(e));
        }
      }}
      onSelectNetwork={(id) => loadNetworkDetails(id)}
      onNetworkInspect={(id) => loadNetworkDetails(id)}
      onNetworkRemove={async (id) => {
        try {
          if (scope === "local") {
            await DockerLocalNetworkRemove(id);
          } else {
            const sessionId = activeRemoteSession?.sessionId;
            if (!sessionId) throw new Error("Remote session not connected");
            await DockerRemoteNetworkRemove(sessionId, id);
          }
          await refreshNetworks();
        } catch (e: any) {
          setNetworksError(e?.message ?? String(e));
        }
      }}
      onRefreshSystem={() => void refreshSystem()}
      onOpenLogs={(containerId, containerName) => openDockerTab("logs", containerId, containerName)}
      onOpenShell={(containerId, containerName) => openDockerTab("shell", containerId, containerName)}
      onOpenFiles={(containerId, containerName) => openDockerTab("files", containerId, containerName)}
      onRefreshLocalStatus={refreshLocalStatusAndView}
      localStatus={localStatus}
    />
  ) : leftMode === "places" && leftContext ? (
    <PlacesPanel
      profileId={leftContext.profileId}
      profiles={leftProfileShim}
      refreshToken={placesRefreshToken}
      onBack={() => setLeftMode("sidebar")}
      onAddNew={() => setPlaceModal({ open: true, profileId: leftContext.profileId, name: "", remotePath: "" })}
      onEdit={(p: PlaceDTO) => setPlaceModal({ open: true, id: p.id, profileId: p.profileId, name: p.name ?? "", remotePath: p.remotePath })}
      onGoTerminal={async (remotePath) => {
        const streamId = shellStreamByTab[leftContext.tabId];
        if (!streamId) throw new Error("Shell not connected");
        await DockerStreamSend(streamId, `cd ${shellQuote(remotePath)}\n`);
      }}
      onGoFiles={(remotePath) => {
        openDockerTab("files", leftContext.containerId, leftContext.containerName, remotePath);
      }}
    />
  ) : leftMode === "macros" && leftContext ? (
    <MacrosPanel
      profileId={leftContext.profileId}
      refreshToken={macrosRefreshToken}
      onBack={() => setLeftMode("sidebar")}
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
        <div className="panel-title">Docker</div>
        <div className="panel-meta">no active container</div>
      </div>
    </div>
  );

  const right = (
    <div className="docker-main">
      {scope === "remote" && (!activeRemoteSession?.sessionId || activeRemoteSession?.status?.available !== true) ? (
        <div className="panel">
          <div className="panel-titlebar">
            <div className="panel-title">Docker</div>
            <div className="panel-meta">
              {!activeRemoteSession?.sessionId ? "Remote disconnected" : "Docker unavailable"}
            </div>
          </div>
          <div className="panel-body">
            <div className="muted">
              {!activeRemoteSession?.sessionId
                ? "Connect to a remote profile to view Docker resources."
                : activeRemoteSession?.status?.message ?? "Docker unavailable on remote host."}
            </div>
          </div>
        </div>
      ) : view === "containers" ? (
        <div className="panel">
          <div className="docker-tabs-bar">
            {dockerTabs.length === 0 ? (
              <div className="muted">No active tabs.</div>
            ) : (
              dockerTabs.map((t) => {
                const isActive = !agentOutputDock?.active && t.id === activeDockerTabId;
                return (
                  <button
                    key={t.id}
                    className={`docker-tabbtn ${isActive ? "active" : ""} kind-${t.kind}`}
                    type="button"
                    onClick={() => {
                      onClearAgentOutputDock?.();
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
            {agentOutputDock?.visible ? (
              <button
                type="button"
                className={`docker-tabbtn kind-agent-output ${agentOutputDock.active ? "active" : ""}`}
                onClick={() => agentOutputDock.onSelect()}
                title="Agent command output"
              >
                <span className="docker-tabbtn-icon" aria-hidden="true">
                  🤖
                </span>
                <span className="docker-tabbtn-label">Agent output</span>
                {agentOutputDock.onClose ? (
                  <span
                    className="docker-tabbtn-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      agentOutputDock.onClose?.();
                    }}
                    title="Close"
                  >
                    ×
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          <div className="panel-titlebar">
            <div className="panel-title">Sessions</div>
            <div className="panel-meta">
              {agentOutputDock?.active
                ? "Agent output"
                : activeDockerTab
                  ? `${trimContainerName(activeDockerTab.containerName)} — ${activeDockerTab.kind}`
                  : "Select a container"}
            </div>
          </div>
          <div className="panel-body">
            {dockerTabs.length === 0 && !agentOutputDock?.visible ? (
              <div className="empty">Pick a container and open Logs, Shell, or Files.</div>
            ) : dockerTabs.length === 0 && agentOutputDock?.visible ? (
              <div className="docker-tabpanes">
                <div className={`docker-tabpane docker-tabpane-agent-output ${agentOutputDock.active ? "active" : ""}`}>
                  {agentOutputDock.children}
                </div>
              </div>
            ) : (
              <div className="docker-tabpanes">
                {dockerTabs.map((t) => (
                  <div
                    key={t.id}
                    className={`docker-tabpane ${!agentOutputDock?.active && t.id === activeDockerTabId ? "active" : ""}`}
                  >
                    {t.kind === "logs" ? (
                      <DockerLogsPanel
                        scope={t.scope}
                        sessionId={resolveTabSessionId(t)}
                        containerId={t.containerId}
                        onClose={() => closeDockerTab(t.id)}
                        onSessionInvalid={
                          t.scope === "remote"
                            ? () => {
                                delete resolvedSessionIdByTabRef.current[t.id];
                                setSessionInvalidationCounter((c) => c + 1);
                              }
                            : undefined
                        }
                      />
                    ) : t.kind === "shell" ? (
                      <DockerShellPanel
                        scope={t.scope}
                        sessionId={resolveTabSessionId(t)}
                        containerId={t.containerId}
                        profileName={t.profileName ?? trimContainerName(t.containerName)}
                        onOpenFiles={(remotePath) => openDockerTab("files", t.containerId, t.containerName, remotePath)}
                        onAddLocation={(remotePath) => {
                          openLeftPanel("places", t);
                          setPlaceModal({
                            open: true,
                            profileId:
                              t.profileId ??
                              buildDockerPlaceProfileId(t.scope, t.scope === "remote" ? activeRemoteProfileId : null, t.containerName, t.containerId),
                            name: "",
                            remotePath,
                          });
                        }}
                        onOpenPlaces={() => openLeftPanel("places", t)}
                        onOpenMacros={() => openLeftPanel("macros", t)}
                        onOpenSecrets={
                          t.profileId ? () => onOpenSecrets?.(t.profileId as string) : undefined
                        }
                        onStreamId={(streamId) => setShellStreamByTab((prev) => ({ ...prev, [t.id]: streamId }))}
                        onClose={() => closeDockerTab(t.id)}
                      />
                    ) : (
                      <DockerFilesPanel
                        scope={t.scope}
                        sessionId={resolveTabSessionId(t)}
                        containerId={t.containerId}
                        initialPath={t.initialPath ?? "/"}
                      />
                    )}
                  </div>
                ))}
                {agentOutputDock?.visible ? (
                  <div
                    className={`docker-tabpane docker-tabpane-agent-output ${agentOutputDock.active ? "active" : ""}`}
                  >
                    {agentOutputDock.children}
                  </div>
                ) : null}
              </div>
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
                const image = img;
                const { short, full } = formatImageDate(image);
                const related = containers.filter((c) => matchImageToContainer(image, c));
                return (
                  <div>
                    <div className="docker-widgets">
                      <div className="docker-widget">
                        <div className="docker-widget-title">General</div>
                        <div className="docker-widget-body">
                          <div className="mono">{image.repository}:{image.tag}</div>
                          <div className="muted">Image ID: {image.id}</div>
                          <div className="muted" title={`Created: ${full}`}>Created: {short}</div>
                          <div className="muted">Size: {image.size ?? "-"}</div>
                        </div>
                      </div>
                      <div className="docker-widget">
                        <div className="docker-widget-title">Used by</div>
                        <div className="docker-widget-body">
                          {related.length > 0 ? (
                            <div className="docker-usedby-list">
                              {related.map((c) => (
                                <button
                                  key={c.id}
                                  className="docker-usedby-item"
                                  type="button"
                                  onClick={() => {
                                    setView("containers");
                                    setActiveContainerId(c.id);
                                  }}
                                >
                                  <span className="docker-usedby-name">{c.name || c.id.slice(0, 12)}</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="muted">No containers reference this image.</div>
                          )}
                        </div>
                      </div>
                    </div>
                    {imageFilesError ? <div className="error" style={{ marginTop: 10 }}>{imageFilesError}</div> : null}
                    <div className="docker-actions" style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => {
                          if (imageInspectOpen) {
                            setImageInspectOpen(false);
                          } else {
                            setImageInspectOpen(true);
                            void loadImageInspect(image.id);
                            if (imageFilesContainerId) void closeImageFiles();
                          }
                        }}
                      >
                        {imageInspectOpen ? "Hide inspect" : "Inspect"}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          if (imageFilesContainerId) {
                            void closeImageFiles();
                          } else {
                            void openImageFiles(image);
                            setImageInspectOpen(false);
                          }
                        }}
                      >
                        {imageFilesContainerId ? "Hide files" : "Files"}
                      </button>
                    </div>
                    {(imageInspectOpen || (imageFilesContainerId && imageFilesImageId === image.id)) ? (
                      <div className="docker-widgets" style={{ marginTop: 12 }}>
                        {imageInspectOpen && imageInspectById[image.id] ? (
                          <div className="docker-widget docker-widget-general">
                            <div className="docker-widget-title">Inspect</div>
                            <div className="docker-widget-body">
                              <pre className="mono docker-widget-pre">{imageInspectById[image.id]}</pre>
                            </div>
                          </div>
                        ) : null}
                        {imageFilesContainerId && imageFilesImageId === image.id ? (
                          <div className="docker-widget docker-widget-general">
                            <div className="docker-widget-title">Files</div>
                            <div className="docker-widget-body docker-widget-files">
                              <DockerFilesPanel
                                scope={scope}
                                sessionId={activeRemoteSession?.sessionId ?? null}
                                containerId={imageFilesContainerId}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      ) : view === "volumes" ? (
        <div className="panel">
          <div className="panel-titlebar">
            <div className="panel-title">Volume</div>
            <div className="panel-meta">{activeVolumeName ?? "Select a volume"}</div>
          </div>
          <div className="panel-body">
            {volumesError ? <div className="error">{volumesError}</div> : null}
            {volumeFilesError ? <div className="error">{volumeFilesError}</div> : null}
            {activeVolumeName && volumeMode === "files" ? (
              <div>
                <div className="docker-actions" style={{ marginBottom: 10 }}>
                  <button className="btn btn-ghost" type="button" onClick={() => void closeVolumeFiles()}>
                    Close files
                  </button>
                </div>
                {volumeFilesContainerId ? (
                  <div style={{ height: 360 }}>
                    <DockerFilesPanel
                      scope={scope}
                      sessionId={activeRemoteSession?.sessionId ?? null}
                      containerId={volumeFilesContainerId}
                      initialPath="/mnt"
                    />
                  </div>
                ) : (
                  <div className="muted">Loading volume files...</div>
                )}
              </div>
            ) : activeVolumeName && volumeDetails ? (
              <div className="docker-widgets">
                <div className="docker-widget docker-widget-general">
                  <div className="docker-widget-title">General</div>
                  <div className="docker-widget-body">
                    <div className="mono">{volumeDetails.name}</div>
                    <div className="muted">Driver: {volumeDetails.driver ?? "-"}</div>
                    <div className="muted">Scope: {volumeDetails.scope ?? "-"}</div>
                    <div className="muted">
                      Mountpoint: <span className="docker-widget-value">{volumeDetails.mountpoint ?? "-"}</span>
                    </div>
                    <div className="muted">Created: {volumeDetails.createdAt ?? "-"}</div>
                  </div>
                </div>
                <div className="docker-widget">
                  <div className="docker-widget-title">Usage</div>
                  <div className="docker-widget-body">
                    <div className="muted">
                      RefCount:{" "}
                      {typeof volumeDetails.refCount === "number" && volumeDetails.refCount >= 0 ? volumeDetails.refCount : "-"}
                    </div>
                    <div className="muted">
                      Size:{" "}
                      {typeof volumeDetails.sizeBytes === "number" && volumeDetails.sizeBytes >= 0
                        ? formatBytes(volumeDetails.sizeBytes)
                        : "n/a"}
                    </div>
                  </div>
                </div>
                <div className="docker-widget">
                  <div className="docker-widget-title">In use by</div>
                  <div className="docker-widget-body">
                    {Array.isArray(volumeDetails.usedBy) && volumeDetails.usedBy.length > 0 ? (
                      <div className="docker-usedby-list">
                        {volumeDetails.usedBy.map((entry) => {
                          const idx = entry.indexOf(":");
                          const name = idx >= 0 ? entry.slice(0, idx) : entry;
                          const mountPath = idx >= 0 ? entry.slice(idx + 1) : "";
                          const isTemp = name.startsWith("daimon_temp_");
                          const container = containers.find((c) => c.name === name) ?? null;
                          return (
                            <button
                              key={entry}
                              className={`docker-usedby-item ${isTemp ? "temp" : ""}`}
                              type="button"
                              disabled={!container}
                              onClick={() => {
                                if (container) {
                                  setView("containers");
                                  openDockerTab("logs", container.id, container.name);
                                }
                              }}
                              title={container ? "Open logs" : "Container not in list"}
                            >
                              <span className="docker-usedby-name">{name}</span>
                              {mountPath ? <span className="docker-usedby-path">{mountPath}</span> : null}
                              {isTemp ? <span className="docker-usedby-tag">temp</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="muted">-</div>
                    )}
                  </div>
                </div>
              </div>
            ) : activeVolumeName && volumeDetailsBusy ? (
              <div className="muted">Loading volume details...</div>
            ) : (
              <div className="empty">Pick a volume on the left.</div>
            )}
          </div>
        </div>
      ) : view === "networks" ? (
        <div className="panel">
          <div className="panel-titlebar">
            <div className="panel-title">Network</div>
            <div className="panel-meta">{activeNetworkId ?? "Select a network"}</div>
          </div>
          <div className="panel-body">
            {networksError ? <div className="error">{networksError}</div> : null}
            {activeNetworkId && networkDetails ? (
              <div className="docker-widgets">
                <div className="docker-widget">
                  <div className="docker-widget-title">General</div>
                  <div className="docker-widget-body">
                    <div className="mono">{networkDetails.name}</div>
                    <div className="muted">ID: {networkDetails.id}</div>
                    <div className="muted">Driver: {networkDetails.driver ?? "-"}</div>
                    <div className="muted">Scope: {networkDetails.scope ?? "-"}</div>
                    <div className="muted">Internal: {networkDetails.internal ? "yes" : "no"}</div>
                    <div className="muted">Attachable: {networkDetails.attachable ? "yes" : "no"}</div>
                    <div className="muted">Ingress: {networkDetails.ingress ? "yes" : "no"}</div>
                  </div>
                </div>
                <div className="docker-widget">
                  <div className="docker-widget-title">Containers</div>
                  <div className="docker-widget-body">
                    {networkDetails.containers?.length ? (
                      <div className="docker-usedby-list">
                        {networkDetails.containers.map((n) => {
                          const needle = String(n ?? "");
                          const normalized = needle.replace(/^\//, "");
                          const container =
                            containers.find((c) => {
                              const cName = String(c.name ?? "").replace(/^\//, "");
                              const cId = String(c.id ?? "").replace(/^sha256:/, "");
                              return cName === normalized || cName === needle || cId === needle || cId.startsWith(needle) || needle.startsWith(cId);
                            }) ?? null;
                          return (
                            <button
                              key={n}
                              className="docker-usedby-item"
                              type="button"
                              onClick={() => {
                                setView("containers");
                                if (container) {
                                  setActiveContainerId(container.id);
                                  openDockerTab("logs", container.id, container.name);
                                } else {
                                  setActiveContainerId(null);
                                  setContainerQuery(needle);
                                }
                              }}
                              title={container ? "Open logs" : "Show in containers"}
                            >
                              <span className="docker-usedby-name">{n}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="muted">-</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty">Pick a network on the left.</div>
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

  const leftStreamId = leftContext ? shellStreamByTab[leftContext.tabId] ?? null : null;

  return (
    <>
      <SplitView left={left} right={right} initialLeftPct={30} minLeftPx={320} minRightPx={520} />
      {placeModal.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{placeModal.id ? "Edit Place" : "Save Location"}</div>
            <div className="modal-body">
              <div className="form-grid">
                <label>Name</label>
                <input value={placeModal.name} onChange={(e) => setPlaceModal((p) => ({ ...p, name: e.target.value }))} />
                <label>Path</label>
                <input
                  className="mono"
                  value={placeModal.remotePath}
                  onChange={(e) => setPlaceModal((p) => ({ ...p, remotePath: e.target.value }))}
                />
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setPlaceModal({ open: false, profileId: "", name: "", remotePath: "" })}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    const targetProfileId = placeModal.profileId;
                    const remotePath = (placeModal.remotePath || "").trim();
                    if (!targetProfileId || !remotePath) return;
                    await UpsertPlace({ id: placeModal.id, profileId: targetProfileId, name: placeModal.name ?? "", remotePath, order: 0 } as any);
                    setPlaceModal({ open: false, profileId: "", name: "", remotePath: "" });
                    setPlacesRefreshToken((n) => n + 1);
                  }}
                >
                  Save
                </button>
              </div>
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
          if (!leftStreamId) return;
          await DockerStreamSend(leftStreamId, script + "\n");
          setMacroRunOpen(false);
        }}
      />
    </>
  );
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
