import { useEffect, useMemo, useState } from "react";
import type { MacroDTO } from "../types/models";
import { isLikelySecretKey, renderMacro } from "../utils/macroRender";
import "./macrorunmodal.css";

type Props = {
  open: boolean;
  macro: MacroDTO | null;
  onCancel: () => void;
  onRun: (script: string) => void;
};

export function MacroRunModal({ open, macro, onCancel, onRun }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !macro) return;
    const init: Record<string, string> = {};
    (macro.params ?? []).forEach((p) => (init[p.name] = ""));
    setValues(init);
  }, [open, macro]);

  const renderReal = useMemo(() => {
    if (!macro) return { script: "", warnings: [] as string[] };
    return renderMacro(macro, values);
  }, [macro, values]);

  const renderPreview = useMemo(() => {
    if (!macro) return { script: "", warnings: [] as string[] };
    const maskedParams: Record<string, string> = {};
    Object.entries(values).forEach(([k, v]) => {
      maskedParams[k] = isLikelySecretKey(k) ? "****" : v;
    });
    const maskedMacro: MacroDTO = {
      ...macro,
      dataItems: (macro.dataItems ?? []).map((d) =>
        isLikelySecretKey(d.key) ? { ...d, value: "****" } : d
      ),
    };
    return renderMacro(maskedMacro, maskedParams);
  }, [macro, values]);

  if (!open || !macro) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal macrorunmodal">
        <div className="modal-title">Run: {macro.name}</div>
        <div className="modal-body">
          {(macro.params ?? []).length === 0 ? (
            <div className="muted">No parameters required.</div>
          ) : (
            <div className="macrorunmodal-params">
              {(macro.params ?? []).map((p) => (
                <label key={p.name}>
                  <span>{p.prompt || p.name}</span>
                  <input
                    value={values[p.name] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}

          {renderReal.warnings.length > 0 ? (
            <div className="macrorunmodal-warnings">
              {renderReal.warnings.map((w, i) => (
                <div key={`${w}-${i}`} className="warning-text">
                  {w}
                </div>
              ))}
            </div>
          ) : null}

          <label>Preview</label>
          <textarea readOnly rows={12} value={renderPreview.script} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={() => onRun(renderReal.script)}>
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
