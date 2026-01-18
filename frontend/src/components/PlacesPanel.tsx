import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlaceDTO, ProfileDTO } from "../types/models";
import { DeletePlace, ListPlaces } from "../../wailsjs/go/main/App";
import "./placespanel.css";

type Props = {
  profileId: string;
  profiles: ProfileDTO[];
  refreshToken: number;
  onBack: () => void;
  onGoTerminal: (remotePath: string) => void;
  onGoFiles: (remotePath: string) => void;
  onAddNew: () => void;
  onEdit: (p: PlaceDTO) => void;
};

export function PlacesPanel({ profileId, profiles, refreshToken, onBack, onGoTerminal, onGoFiles, onAddNew, onEdit }: Props) {
  const [places, setPlaces] = useState<PlaceDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const profileName = useMemo(() => profiles.find((p) => p.id === profileId)?.name ?? profileId, [profiles, profileId]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const hasBackendFn = typeof (window as any)?.go?.main?.App?.ListPlaces === "function";
      if (!hasBackendFn) {
        throw new Error("Backend method ListPlaces is not available. Please restart the app / rebuild Wails backend.");
      }
      const rows = await ListPlaces(profileId);
      setPlaces(rows as any);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <div className="panel placespanel">
      <div className="panel-titlebar">
        <div className="panel-title">Places</div>
        <div className="panel-meta">
          <span className="muted">{profileName}</span>
          {err ? <span className="error-text">{err}</span> : null}
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={onAddNew} disabled={!profileId}>
            + Place
          </button>
        </div>
      </div>

      <div className="placespanel-toolbar">
        <button className="btn" type="button" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="placespanel-list">
        {places.length === 0 ? <div className="empty">No places yet.</div> : null}

        {places.map((p) => (
          <div key={p.id} className="placespanel-item">
            <div className="placespanel-main" title={p.remotePath}>
              <div className="placespanel-name">{p.name?.trim() ? p.name : p.remotePath}</div>
              <div className="placespanel-path mono">{p.remotePath}</div>
            </div>
            <div className="placespanel-actions2">
              <button className="btn btn-ghost" type="button" onClick={() => onGoTerminal(p.remotePath)}>
                Terminal
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => onGoFiles(p.remotePath)}>
                Files
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => onEdit(p)}>
                Edit
              </button>
              <button
                className="btn btn-ghost danger"
                type="button"
                onClick={async () => {
                  if (!confirm(`Delete place?\n\n${p.name || ""}\n${p.remotePath}`)) return;
                  const hasBackendFn = typeof (window as any)?.go?.main?.App?.DeletePlace === "function";
                  if (!hasBackendFn) {
                    alert("Backend method DeletePlace is not available. Please restart the app / rebuild Wails backend.");
                    return;
                  }
                  await DeletePlace(p.id);
                  await load();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

