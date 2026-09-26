import { useState } from "react";
import type { Macro, Profile } from "../demo/data";

type Props = {
  profileId: string;
  profiles: Profile[];
  macros: Macro[];
  onBack: () => void;
  onRun: (macro: Macro) => void;
};

export function PromoMacrosPanel({ profileId, profiles, macros, onBack, onRun }: Props) {
  const profileName = profiles.find((p) => p.id === profileId)?.name ?? profileId;
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Macro | null>(null);
  const rows = macros.filter((m) => {
    if (favoritesOnly && !favorites[m.id]) return false;
    return m.name.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="panel macrospanel">
      <div className="panel-titlebar">
        <div className="panel-title">Macros</div>
        <div className="panel-meta">
          <span className="muted">{profileName}</span>
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={() => setEditor({ id: "", name: "", tags: [], preview: "" })}>
            + Macro
          </button>
        </div>
      </div>

      <div className="macrospanel-toolbar">
        <button className="btn" type="button" onClick={onBack}>
          ← Back
        </button>
        <input
          className="macrospanel-search"
          placeholder="Search by name or tag (e.g. nginx)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className={`star-toggle ${favoritesOnly ? "on" : ""}`} type="button" title="Show favorites for this connection" onClick={() => setFavoritesOnly((value) => !value)}>
          ★
        </button>
        <button className="btn btn-ghost" type="button">Refresh</button>
      </div>

      <div className="macrospanel-list">
        {rows.length === 0 ? <div className="empty">No macros found.</div> : null}
        {rows.map((m) => (
          <div key={m.id} className="macrospanel-item">
            <div className="macrospanel-main">
              <div className="macrospanel-name">{m.name}</div>
              <div className="macrospanel-tags">
                {m.tags.map((t) => (
                  <span key={t} className="macrospanel-tag" style={{ background: "rgba(95, 120, 240, 0.4)" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="macrospanel-actions2">
              <button className={`star ${favorites[m.id] ? "on" : ""}`} type="button" title={favorites[m.id] ? "Unfavorite" : "Favorite"} onClick={() => setFavorites((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}>
                ★
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => onRun(m)}>
                Run
              </button>
              <div className="macrospanel-menu">
                <button className="btn btn-ghost dots" type="button" title="More" onClick={() => setOpenMenuId((cur) => (cur === m.id ? null : m.id))}>⋯</button>
                {openMenuId === m.id ? (
                  <div className="macrospanel-dropdown">
                    <button className="menu-item" type="button" onClick={() => { setOpenMenuId(null); setEditor(m); }}>Edit</button>
                    <button className="menu-item" type="button" onClick={() => setOpenMenuId(null)}>Clone</button>
                    <button className="menu-item danger" type="button" onClick={() => setOpenMenuId(null)}>Delete</button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      {editor ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal macroeditormodal">
            <div className="modal-title">{editor.id ? "Edit Macro" : "New Macro"}</div>
            <div className="modal-body form">
              <div className="row"><label>Name</label><input defaultValue={editor.name} /></div>
              <div className="row"><label>Tags</label><input defaultValue={editor.tags.join(", ")} /></div>
              <div className="row"><label>Script</label><textarea className="mono" rows={6} defaultValue={editor.preview} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setEditor(null)}>Cancel</button>
              <button className="btn" type="button" onClick={() => setEditor(null)}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
