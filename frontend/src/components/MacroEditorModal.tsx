import { useEffect, useMemo, useState } from "react";
import type { MacroDTO, MacroDataItemDTO, MacroParamDTO } from "../types/models";
import "./macroeditormodal.css";

type Props = {
  open: boolean;
  macro?: MacroDTO | null;
  onCancel: () => void;
  onSave: (next: { id?: string; name: string; tags: string[]; script: string; dataItems: MacroDataItemDTO[]; params: MacroParamDTO[] }) => void;
};

type TabKey = "script" | "data" | "params";

export function MacroEditorModal({ open, macro, onCancel, onSave }: Props) {
  const [tab, setTab] = useState<TabKey>("script");
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [dataItems, setDataItems] = useState<MacroDataItemDTO[]>([]);
  const [params, setParams] = useState<MacroParamDTO[]>([]);

  useEffect(() => {
    if (!open) return;
    setTab("script");
    setName(macro?.name ?? "");
    setScript(macro?.script ?? "");
    setTags(macro?.tags ?? []);
    setTagInput("");
    setDataItems((macro?.dataItems ?? []).map((d, i) => ({ ...d, order: i })));
    setParams((macro?.params ?? []).map((p, i) => ({ ...p, order: i })));
  }, [open, macro]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (!tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal macroeditormodal">
        <div className="modal-title">{macro?.id ? "Edit Macro" : "New Macro"}</div>

        <div className="macroeditormodal-tabs">
          <button className={`tab ${tab === "script" ? "active" : ""}`} type="button" onClick={() => setTab("script")}>
            Script
          </button>
          <button className={`tab ${tab === "data" ? "active" : ""}`} type="button" onClick={() => setTab("data")}>
            Data
          </button>
          <button className={`tab ${tab === "params" ? "active" : ""}`} type="button" onClick={() => setTab("params")}>
            Params
          </button>
        </div>

        <div className="modal-body">
          {tab === "script" ? (
            <div className="macroeditormodal-tab">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <label>Tags</label>
              <div className="tag-input-row">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="nginx, web, deploy"
                />
                <button className="btn btn-ghost" type="button" onClick={addTag}>
                  Add
                </button>
              </div>
              <div className="tag-list">
                {tags.map((t) => (
                  <span key={t} className="tag-chip">
                    {t}
                    <button
                      className="tag-remove"
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <label>Script</label>
              <textarea rows={10} value={script} onChange={(e) => setScript(e.target.value)} />
              <div className="muted">Use ##param## and ??data?? placeholders.</div>
            </div>
          ) : null}

          {tab === "data" ? (
            <div className="macroeditormodal-tab">
              <div className="row-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setDataItems((prev) => [...prev, { id: "", key: "", value: "", order: prev.length }])}
                >
                  + Data
                </button>
              </div>
              {dataItems.map((d, idx) => (
                <div key={`${idx}-${d.id}`} className="kv-row">
                  <input
                    placeholder="key"
                    value={d.key}
                    onChange={(e) =>
                      setDataItems((prev) => prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))
                    }
                  />
                  <textarea
                    rows={3}
                    placeholder="value"
                    value={d.value}
                    onChange={(e) =>
                      setDataItems((prev) => prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)))
                    }
                  />
                  <button className="btn btn-ghost danger" type="button" onClick={() => setDataItems((prev) => prev.filter((_, i) => i !== idx))}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "params" ? (
            <div className="macroeditormodal-tab">
              <div className="row-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setParams((prev) => [...prev, { id: "", name: "", prompt: "", order: prev.length }])}
                >
                  + Param
                </button>
              </div>
              {params.map((p, idx) => (
                <div key={`${idx}-${p.id}`} className="param-row">
                  <input
                    placeholder="param_name"
                    value={p.name}
                    onChange={(e) =>
                      setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <input
                    placeholder="prompt"
                    value={p.prompt}
                    onChange={(e) =>
                      setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, prompt: e.target.value } : x)))
                    }
                  />
                  <button className="btn btn-ghost danger" type="button" onClick={() => setParams((prev) => prev.filter((_, i) => i !== idx))}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({
                id: macro?.id,
                name: name.trim(),
                tags,
                script,
                dataItems: dataItems.map((d, i) => ({ ...d, order: i })),
                params: params.map((p, i) => ({ ...p, order: i })),
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
