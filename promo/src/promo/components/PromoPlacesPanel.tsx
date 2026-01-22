import type { Place, Profile } from "../demo/data";

type Props = {
  profileId: string;
  profiles: Profile[];
  places: Place[];
  onBack: () => void;
  onGoTerminal: (remotePath: string) => void;
  onGoFiles: (remotePath: string) => void;
};

export function PromoPlacesPanel({ profileId, profiles, places, onBack, onGoTerminal, onGoFiles }: Props) {
  const profileName = profiles.find((p) => p.id === profileId)?.name ?? profileId;
  const rows = places.filter((p) => p.profileId === profileId);

  return (
    <div className="panel placespanel">
      <div className="panel-titlebar">
        <div className="panel-title">Places</div>
        <div className="panel-meta">
          <span className="muted">{profileName}</span>
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" disabled>
            Demo
          </button>
        </div>
      </div>

      <div className="placespanel-toolbar">
        <button className="btn" type="button" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-ghost" type="button" disabled>
          Refresh
        </button>
      </div>

      <div className="placespanel-list">
        {rows.length === 0 ? <div className="empty">No places yet.</div> : null}
        {rows.map((p) => (
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
              <button className="btn btn-ghost" type="button" disabled>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
