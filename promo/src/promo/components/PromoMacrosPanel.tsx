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
  const rows = macros.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="panel macrospanel">
      <div className="panel-titlebar">
        <div className="panel-title">Macros</div>
        <div className="panel-meta">
          <span className="muted">{profileName}</span>
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" disabled>
            Demo
          </button>
        </div>
      </div>

      <div className="macrospanel-toolbar">
        <button className="btn" type="button" onClick={onBack}>
          ← Back
        </button>
        <input
          className="macrospanel-search"
          placeholder="Search macros…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-ghost" type="button" disabled>
          + Macro
        </button>
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
              <button className="btn btn-ghost" type="button" onClick={() => onRun(m)}>
                Run
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
