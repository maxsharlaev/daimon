import { useCallback, useEffect, useMemo, useState } from "react";
import type { MacroBindingDTO, MacroDTO } from "../types/models";
import { DeleteMacro, ListMacroBindings, ListMacros, SetMacroFavorite, UpsertMacro } from "../../wailsjs/go/main/App";
import "./macrospanel.css";

type Props = {
  profileId: string;
  refreshToken: number;
  onBack: () => void;
  onCreate: () => void;
  onEdit: (m: MacroDTO) => void;
  onRun: (m: MacroDTO) => void;
};

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function MacrosPanel({ profileId, refreshToken, onBack, onCreate, onEdit, onRun }: Props) {
  const [macros, setMacros] = useState<MacroDTO[]>([]);
  const [bindings, setBindings] = useState<Record<string, MacroBindingDTO>>({});
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    setErr(null);
    try {
      const [m, b] = await Promise.all([ListMacros(), ListMacroBindings(profileId)]);
      setMacros(m as any);
      const byId: Record<string, MacroBindingDTO> = {};
      (b as any as MacroBindingDTO[]).forEach((x) => (byId[x.macroId] = x));
      setBindings(byId);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setMacros([]);
      setBindings({});
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".macrospanel-menu")) return;
      setOpenMenuId(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return macros.filter((m) => {
      if (favoritesOnly && !bindings[m.id]?.isFavorite) return false;
      if (!q) return true;
      if (m.name.toLowerCase().includes(q)) return true;
      return (m.tags ?? []).some((t) => t.toLowerCase().includes(q));
    });
  }, [macros, bindings, search, favoritesOnly]);

  return (
    <div className="panel macrospanel">
      <div className="panel-titlebar">
        <div className="panel-title">Macros</div>
        <div className="panel-meta">
          {err ? <span className="error-text">{err}</span> : null}
          {loading ? <span className="muted">loading...</span> : null}
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" type="button" onClick={onCreate} disabled={!profileId}>
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`star-toggle ${favoritesOnly ? "on" : ""}`}
          type="button"
          title="Show favorites for this connection"
          onClick={() => setFavoritesOnly((v) => !v)}
        >
          ★
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="macrospanel-list">
        {filtered.length === 0 ? <div className="empty">No macros.</div> : null}

        {filtered.map((m) => {
          const fav = !!bindings[m.id]?.isFavorite;
          return (
            <div key={m.id} className="macrospanel-item">
              <div className="macrospanel-main">
                <div className="macrospanel-name" title={m.name}>
                  {m.name}
                </div>
                <div className="macrospanel-tags">
                  {(m.tags ?? []).map((t) => (
                    <span key={t} className="macrospanel-tag" style={{ backgroundColor: `hsl(${hashHue(t)}, 45%, 30%)` }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="macrospanel-actions2">
                <button
                  className={`star ${fav ? "on" : ""}`}
                  type="button"
                  title={fav ? "Unfavorite" : "Favorite"}
                  onClick={async () => {
                    const next = await SetMacroFavorite(profileId, m.id, !fav);
                    setBindings((prev) => ({ ...prev, [m.id]: next as any }));
                  }}
                >
                  ★
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => onRun(m)}>
                  Run
                </button>
                <div className="macrospanel-menu">
                  <button
                    className="btn btn-ghost dots"
                    type="button"
                    title="More"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId((cur) => (cur === m.id ? null : m.id));
                    }}
                  >
                    ⋯
                  </button>
                  {openMenuId === m.id ? (
                    <div className="macrospanel-dropdown">
                      <button
                        className="menu-item"
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          onEdit(m);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="menu-item"
                        type="button"
                        onClick={async () => {
                          setOpenMenuId(null);
                          const copy = {
                            ...m,
                            id: "",
                            name: `${m.name} copy`,
                          };
                          await UpsertMacro(copy as any);
                          await load();
                        }}
                      >
                        Clone
                      </button>
                      <button
                        className="menu-item danger"
                        type="button"
                        onClick={async () => {
                          setOpenMenuId(null);
                          if (!confirm(`Delete macro?\n\n${m.name}`)) return;
                          await DeleteMacro(m.id);
                          await load();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
