import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlaceDTO, ProfileDTO } from "../types/models";
import type { DockerContainerDTO } from "../types/docker";
import { DeletePlace, DockerLocalListContainers, ListAllPlaces, ListPlaces, UpsertPlace } from "../../wailsjs/go/main/App";
import {
  buildDockerPlaceProfileId,
  parseDockerPlaceProfileId,
  sanitizeDockerPlaceNameSegment,
} from "../utils/dockerPlaceProfileId";
import "./docker/docker.css";

export type PlacesSegment = "connection" | "docker_local" | "docker_remote";

type Props = {
  profiles: ProfileDTO[];
};

function containerLabelFromParsed(p: Extract<ReturnType<typeof parseDockerPlaceProfileId>, { valid: true }>): string {
  return p.version === 2 ? p.containerKey : p.containerId;
}

/** Match saved places to a running local container (v2, v1, legacy keys). */
function placesForLocalContainer(c: DockerContainerDTO, allPlaces: PlaceDTO[]): PlaceDTO[] {
  const canonical = buildDockerPlaceProfileId("local", null, c.name || "", c.id);
  const out: PlaceDTO[] = [];
  const nameSeg = sanitizeDockerPlaceNameSegment(c.name || "");
  const idSeg = sanitizeDockerPlaceNameSegment(c.id);
  for (const pl of allPlaces) {
    if (pl.profileId === canonical) {
      out.push(pl);
      continue;
    }
    if (pl.profileId === `docker:local:local:${c.id}` || pl.profileId === `docker:local:unknown:${c.id}`) {
      out.push(pl);
      continue;
    }
    const p = parseDockerPlaceProfileId(pl.profileId);
    if (p.valid && p.scope === "local") {
      const lbl = containerLabelFromParsed(p);
      if (lbl === c.id) {
        out.push(pl);
        continue;
      }
      if (nameSeg && lbl === nameSeg) {
        out.push(pl);
        continue;
      }
      if (idSeg && (lbl === `id_${idSeg}` || lbl === `id_${c.id.replace(/:/g, "_")}`)) {
        out.push(pl);
      }
    }
  }
  return out;
}

type LocalRow = { rowId: string; label: string; container: DockerContainerDTO | null };

export function SettingsPlacesPanel({ profiles }: Props) {
  const [segment, setSegment] = useState<PlacesSegment>("connection");
  const [allPlaces, setAllPlaces] = useState<PlaceDTO[]>([]);
  const [connPlaces, setConnPlaces] = useState<PlaceDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [localContainers, setLocalContainers] = useState<DockerContainerDTO[]>([]);
  const [localContainersBusy, setLocalContainersBusy] = useState(false);
  const [localContainersErr, setLocalContainersErr] = useState<string | null>(null);

  const [selectedConnProfileId, setSelectedConnProfileId] = useState<string | null>(null);
  const [selectedLocalRowId, setSelectedLocalRowId] = useState<string | null>(null);
  const [selectedDockerRemote, setSelectedDockerRemote] = useState<{ profileId: string; containerKey: string } | null>(null);
  /** SSH profile id (or orphan bucket key) whose container list is shown under the profile block. */
  const [selectedRemoteSSHKey, setSelectedRemoteSSHKey] = useState<string | null>(null);

  const [selectedPlace, setSelectedPlace] = useState<PlaceDTO | null>(null);

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyKind, setCopyKind] = useState<PlacesSegment>("connection");
  const [copyConnProfileId, setCopyConnProfileId] = useState("");
  const [copyLocalContainer, setCopyLocalContainer] = useState("");
  const [copyRemoteProfileId, setCopyRemoteProfileId] = useState("");
  const [copyRemoteContainer, setCopyRemoteContainer] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);

  const loadLocalContainers = useCallback(async () => {
    setLocalContainersBusy(true);
    setLocalContainersErr(null);
    try {
      const rows = await DockerLocalListContainers();
      setLocalContainers(Array.isArray(rows) ? (rows as DockerContainerDTO[]) : []);
    } catch (e: any) {
      setLocalContainersErr(e?.message ?? String(e));
      setLocalContainers([]);
    } finally {
      setLocalContainersBusy(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setAllPlaces((await ListAllPlaces()) as PlaceDTO[]);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setAllPlaces([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshPlacesAndMaybeDocker = useCallback(async () => {
    await loadAll();
    if (segment === "docker_local") await loadLocalContainers();
  }, [loadAll, loadLocalContainers, segment]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (segment !== "docker_local") return;
    void loadLocalContainers();
  }, [segment, loadLocalContainers]);

  const loadConnPlaces = useCallback(async (profileId: string) => {
    setBusy(true);
    setErr(null);
    try {
      setConnPlaces((await ListPlaces(profileId)) as PlaceDTO[]);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setConnPlaces([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (segment !== "connection" || !selectedConnProfileId) {
      setConnPlaces([]);
      return;
    }
    void loadConnPlaces(selectedConnProfileId);
  }, [segment, selectedConnProfileId, loadConnPlaces]);

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: "base" })),
    [profiles]
  );

  const dockerLocalBuckets = useMemo(() => {
    const m = new Map<string, PlaceDTO[]>();
    for (const pl of allPlaces) {
      const p = parseDockerPlaceProfileId(pl.profileId);
      if (!p.valid || p.scope !== "local") continue;
      const key = containerLabelFromParsed(p);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(pl);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [allPlaces]);

  const localRows: LocalRow[] = useMemo(() => {
    if (localContainers.length > 0) {
      return localContainers.map((c) => ({
        rowId: c.id,
        label: (c.name || "").trim() || c.id.slice(0, 12),
        container: c,
      }));
    }
    return dockerLocalBuckets.map(([key]) => ({
      rowId: `legacy:${key}`,
      label: key,
      container: null,
    }));
  }, [localContainers, dockerLocalBuckets]);

  const dockerRemoteBuckets = useMemo(() => {
    const outer = new Map<string, Map<string, PlaceDTO[]>>();
    for (const pl of allPlaces) {
      const p = parseDockerPlaceProfileId(pl.profileId);
      if (!p.valid || p.scope !== "remote") continue;
      const ssh = p.sshSegment;
      const ck = containerLabelFromParsed(p);
      if (!outer.has(ssh)) outer.set(ssh, new Map());
      const inner = outer.get(ssh)!;
      if (!inner.has(ck)) inner.set(ck, []);
      inner.get(ck)!.push(pl);
    }
    return outer;
  }, [allPlaces]);

  const orphanRemoteSSHKeys = useMemo(() => {
    const ids = new Set(profiles.map((p) => p.id));
    return [...dockerRemoteBuckets.keys()].filter((k) => !ids.has(k)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [dockerRemoteBuckets, profiles]);

  const placesForSelectedLocalRow = useMemo(() => {
    if (!selectedLocalRowId) return [];
    const row = localRows.find((r) => r.rowId === selectedLocalRowId);
    if (!row) return [];
    let list: PlaceDTO[];
    if (row.container) list = placesForLocalContainer(row.container, allPlaces);
    else {
      const key = row.label;
      list = allPlaces.filter((pl) => {
        const p = parseDockerPlaceProfileId(pl.profileId);
        if (p.valid && p.scope === "local" && containerLabelFromParsed(p) === key) return true;
        return false;
      });
    }
    return [...list].sort((a, b) => (a.name || a.remotePath).localeCompare(b.name || b.remotePath, undefined, { sensitivity: "base" }));
  }, [selectedLocalRowId, localRows, allPlaces]);

  const placesInSelectedDockerRemote = useMemo(() => {
    if (!selectedDockerRemote) return [];
    const inner = dockerRemoteBuckets.get(selectedDockerRemote.profileId);
    const list = inner?.get(selectedDockerRemote.containerKey) ?? [];
    return [...list].sort((a, b) => (a.name || a.remotePath).localeCompare(b.name || b.remotePath, undefined, { sensitivity: "base" }));
  }, [dockerRemoteBuckets, selectedDockerRemote]);

  const connectionPlacesList = useMemo(() => {
    if (segment !== "connection" || !selectedConnProfileId) return [];
    return [...connPlaces].sort((a, b) => (a.name || a.remotePath).localeCompare(b.name || b.remotePath, undefined, { sensitivity: "base" }));
  }, [segment, selectedConnProfileId, connPlaces]);

  const openCopy = () => {
    if (!selectedPlace) return;
    setCopyKind("connection");
    setCopyConnProfileId(sortedProfiles[0]?.id ?? "");
    setCopyLocalContainer("");
    setCopyRemoteProfileId(sortedProfiles[0]?.id ?? "");
    setCopyRemoteContainer("");
    setCopyOpen(true);
  };

  const runCopy = async () => {
    if (!selectedPlace) return;
    let newProfileId = "";
    if (copyKind === "connection") {
      if (!copyConnProfileId.trim()) return;
      newProfileId = copyConnProfileId.trim();
    } else if (copyKind === "docker_local") {
      if (!copyLocalContainer.trim()) return;
      newProfileId = buildDockerPlaceProfileId("local", null, copyLocalContainer.trim(), "");
    } else {
      if (!copyRemoteProfileId.trim() || !copyRemoteContainer.trim()) return;
      newProfileId = buildDockerPlaceProfileId("remote", copyRemoteProfileId.trim(), copyRemoteContainer.trim(), "");
    }
    setCopyBusy(true);
    setErr(null);
    try {
      await UpsertPlace({
        id: "",
        profileId: newProfileId,
        name: selectedPlace.name ?? "",
        remotePath: selectedPlace.remotePath,
        order: selectedPlace.order ?? 0,
      } as any);
      setCopyOpen(false);
      await refreshPlacesAndMaybeDocker();
      if (segment === "connection" && selectedConnProfileId) await loadConnPlaces(selectedConnProfileId);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setCopyBusy(false);
    }
  };

  const removePlace = async () => {
    if (!selectedPlace?.id) return;
    setBusy(true);
    setErr(null);
    try {
      await DeletePlace(selectedPlace.id);
      setSelectedPlace(null);
      await refreshPlacesAndMaybeDocker();
      if (segment === "connection" && selectedConnProfileId) await loadConnPlaces(selectedConnProfileId);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;

  const remoteContainerKeys = (sshKey: string): string[] => {
    const inner = dockerRemoteBuckets.get(sshKey);
    if (!inner) return [];
    return [...inner.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  };

  return (
    <div className="settings-section settings-places">
      {err ? <div className="error-text">{err}</div> : null}

      <div className="settings-places-topbar">
        <div className="settings-places-segments" role="tablist" aria-label="Places scope">
          {(["connection", "docker_local", "docker_remote"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              className={`settings-segment ${segment === s ? "active" : ""}`}
              aria-selected={segment === s}
              onClick={() => {
                setSegment(s);
                setSelectedPlace(null);
                setSelectedLocalRowId(null);
                setSelectedDockerRemote(null);
                setSelectedRemoteSSHKey(null);
              }}
            >
              {s === "connection" ? "Connection" : s === "docker_local" ? "Docker local" : "Docker remote"}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost settings-places-refresh"
          type="button"
          onClick={() => void refreshPlacesAndMaybeDocker()}
          disabled={busy || localContainersBusy}
        >
          Refresh
        </button>
      </div>

      <div className="settings-master-detail">
        <div className="settings-master">
          {segment === "connection" ? (
            <ul className="settings-master-list">
              {sortedProfiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`settings-master-item ${selectedConnProfileId === p.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedConnProfileId(p.id);
                      setSelectedPlace(null);
                    }}
                  >
                    {p.name?.trim() ? p.name : p.id}
                  </button>
                </li>
              ))}
            </ul>
          ) : segment === "docker_local" ? (
            <>
              {localContainersErr ? <div className="error-text settings-master-note">{localContainersErr}</div> : null}
              {localContainersBusy ? <div className="muted settings-master-note">Loading containers…</div> : null}
              <ul className="settings-master-list">
                {localRows.length === 0 ? (
                  <li className="muted settings-master-empty">
                    Local Docker is unavailable or there are no containers. If you already saved places, click Refresh after Docker is running.
                  </li>
                ) : null}
                {localRows.map((row) => (
                  <li key={row.rowId}>
                    <button
                      type="button"
                      className={`settings-master-item ${selectedLocalRowId === row.rowId ? "active" : ""}`}
                      onClick={() => {
                        setSelectedLocalRowId(row.rowId);
                        setSelectedPlace(null);
                      }}
                    >
                      <span>{row.label}</span>
                      {row.container ? (
                        <span className="muted mono settings-master-sub">{row.container.id.slice(0, 12)}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ul className="settings-places-remote-stack">
              {sortedProfiles.length === 0 ? (
                <li className="muted settings-master-empty">No SSH connections.</li>
              ) : null}
              {sortedProfiles.map((p) => {
                const activeProfile = selectedRemoteSSHKey === p.id;
                const ckeys = remoteContainerKeys(p.id);
                return (
                  <li key={p.id} className="settings-places-remote-item">
                    <button
                      type="button"
                      className={`docker-profile settings-places-remote-profile ${activeProfile ? "active" : ""}`}
                      onClick={() => {
                        setSelectedRemoteSSHKey(p.id);
                        setSelectedDockerRemote(null);
                        setSelectedPlace(null);
                      }}
                    >
                      <div>
                        <div className="docker-profile-name">{p.name?.trim() ? p.name : `${p.username}@${p.host}`}</div>
                        <div className="docker-profile-meta">SSH connection</div>
                      </div>
                    </button>
                    {activeProfile ? (
                      <div className="settings-places-remote-under">
                        {ckeys.length === 0 ? (
                          <div className="muted">No Docker container places were saved for this connection.</div>
                        ) : (
                          ckeys.map((ck) => {
                            const activeC =
                              selectedDockerRemote?.profileId === p.id && selectedDockerRemote?.containerKey === ck;
                            return (
                              <div key={ck} className={`docker-container ${activeC ? "active" : ""}`}>
                                <button
                                  type="button"
                                  className="docker-container-row"
                                  onClick={() => {
                                    setSelectedDockerRemote({ profileId: p.id, containerKey: ck });
                                    setSelectedPlace(null);
                                  }}
                                >
                                  <div className="docker-container-info">
                                    <div className="docker-container-title">
                                      <span className="docker-container-name mono">{ck}</span>
                                    </div>
                                    <div className="docker-container-image">Saved places for this container key</div>
                                  </div>
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {orphanRemoteSSHKeys.map((k) => {
                const activeProfile = selectedRemoteSSHKey === k;
                const ckeys = remoteContainerKeys(k);
                return (
                  <li key={`orphan:${k}`} className="settings-places-remote-item">
                    <button
                      type="button"
                      className={`docker-profile settings-places-remote-profile ${activeProfile ? "active" : ""}`}
                      onClick={() => {
                        setSelectedRemoteSSHKey(k);
                        setSelectedDockerRemote(null);
                        setSelectedPlace(null);
                      }}
                    >
                      <div>
                        <div className="docker-profile-name">Unknown profile</div>
                        <div className="docker-profile-meta mono">{k.length > 24 ? `${k.slice(0, 24)}…` : k}</div>
                      </div>
                    </button>
                    {activeProfile ? (
                      <div className="settings-places-remote-under">
                        {ckeys.length === 0 ? (
                          <div className="muted">No Docker container places were saved for this connection.</div>
                        ) : (
                          ckeys.map((ck) => {
                            const activeC =
                              selectedDockerRemote?.profileId === k && selectedDockerRemote?.containerKey === ck;
                            return (
                              <div key={ck} className={`docker-container ${activeC ? "active" : ""}`}>
                                <button
                                  type="button"
                                  className="docker-container-row"
                                  onClick={() => {
                                    setSelectedDockerRemote({ profileId: k, containerKey: ck });
                                    setSelectedPlace(null);
                                  }}
                                >
                                  <div className="docker-container-info">
                                    <div className="docker-container-title">
                                      <span className="docker-container-name mono">{ck}</span>
                                    </div>
                                    <div className="docker-container-image">Saved places for this container key</div>
                                  </div>
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="settings-detail">
          <div className="settings-detail-head">Places</div>
          {segment === "connection" && !selectedConnProfileId ? (
            <div className="muted">Select a connection.</div>
          ) : segment === "docker_local" && !selectedLocalRowId ? (
            <div className="muted">Select a container on the left.</div>
          ) : segment === "docker_remote" && !selectedRemoteSSHKey ? (
            <div className="muted">Select a connection on the left.</div>
          ) : segment === "docker_remote" && !selectedDockerRemote ? (
            <div className="muted">Select a container under the connection.</div>
          ) : (
            <ul className="settings-place-pick-list">
              {(segment === "connection"
                ? connectionPlacesList
                : segment === "docker_local"
                  ? placesForSelectedLocalRow
                  : placesInSelectedDockerRemote
              ).map((pl) => (
                <li key={pl.id}>
                  <button
                    type="button"
                    className={`settings-place-pick ${selectedPlace?.id === pl.id ? "active" : ""}`}
                    onClick={() => setSelectedPlace(pl)}
                  >
                    <span className="settings-place-pick-name">{pl.name?.trim() ? pl.name : pl.remotePath}</span>
                    <span className="mono settings-place-pick-path">{pl.remotePath}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {segment === "connection" && selectedConnProfileId && connectionPlacesList.length === 0 ? (
            <div className="muted settings-detail-hint">No saved places for this connection yet.</div>
          ) : null}

          {segment === "docker_local" && selectedLocalRowId && placesForSelectedLocalRow.length === 0 ? (
            <div className="muted settings-detail-hint">No saved places for this container yet.</div>
          ) : null}
          {segment === "docker_remote" && selectedDockerRemote && placesInSelectedDockerRemote.length === 0 ? (
            <div className="muted settings-detail-hint">No places for the selected container.</div>
          ) : null}

          {selectedPlace ? (
            <div className="settings-place-detail">
              <div className="settings-detail-head">Details</div>
              <dl className="settings-dl">
                <dt>Name</dt>
                <dd>{selectedPlace.name?.trim() ? selectedPlace.name : "—"}</dd>
                <dt>Path</dt>
                <dd className="mono">{selectedPlace.remotePath}</dd>
                <dt>profileId</dt>
                <dd className="mono settings-break">{selectedPlace.profileId}</dd>
                <dt>Updated</dt>
                <dd className="mono">{selectedPlace.updatedAt ?? "—"}</dd>
              </dl>
              <div className="settings-detail-actions">
                <button className="btn" type="button" onClick={() => openCopy()}>
                  Copy to…
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => void removePlace()} disabled={busy}>
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {copyOpen && selectedPlace ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">Copy place</div>
            <div className="modal-body">
              <p className="muted">Copy “{selectedPlace.name?.trim() || selectedPlace.remotePath}”.</p>
              <div className="settings-places-segments settings-places-segments--modal">
                {(["connection", "docker_local", "docker_remote"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`settings-segment ${copyKind === s ? "active" : ""}`}
                    onClick={() => setCopyKind(s)}
                  >
                    {s === "connection" ? "Connection" : s === "docker_local" ? "Docker local" : "Docker remote"}
                  </button>
                ))}
              </div>
              {copyKind === "connection" ? (
                <label className="settings-field">
                  <span className="settings-field-label">Profile</span>
                  <select
                    className="settings-field-input"
                    value={copyConnProfileId}
                    onChange={(e) => setCopyConnProfileId(e.target.value)}
                  >
                    {sortedProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name?.trim() ? p.name : p.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : copyKind === "docker_local" ? (
                <label className="settings-field">
                  <span className="settings-field-label">Container name</span>
                  <input
                    className="settings-field-input mono"
                    value={copyLocalContainer}
                    onChange={(e) => setCopyLocalContainer(e.target.value)}
                    placeholder="e.g. my_app_1"
                  />
                </label>
              ) : (
                <>
                  <label className="settings-field">
                    <span className="settings-field-label">SSH profile</span>
                    <select
                      className="settings-field-input"
                      value={copyRemoteProfileId}
                      onChange={(e) => setCopyRemoteProfileId(e.target.value)}
                    >
                      {sortedProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name?.trim() ? p.name : p.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-field">
                    <span className="settings-field-label">Container name</span>
                    <input
                      className="settings-field-input mono"
                      value={copyRemoteContainer}
                      onChange={(e) => setCopyRemoteContainer(e.target.value)}
                      placeholder="Stable container name on the remote host"
                    />
                  </label>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setCopyOpen(false)} disabled={copyBusy}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void runCopy()} disabled={copyBusy}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
