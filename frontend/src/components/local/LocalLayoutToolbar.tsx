import type { LocalLayoutFlags, LocalSystemInfo } from "../../types/local";

type Props = {
  layout: LocalLayoutFlags;
  system: LocalSystemInfo | null;
  onChange: (next: LocalLayoutFlags) => void;
};

function visibleCount(layout: LocalLayoutFlags) {
  return (layout.leftPanel ? 1 : 0) + (layout.rightPanel ? 1 : 0) + (layout.terminal ? 1 : 0);
}

export function LocalLayoutToolbar({ layout, system, onChange }: Props) {
  const toggle = (key: keyof LocalLayoutFlags) => {
    const next = { ...layout, [key]: !layout[key] };
    // Do not allow hiding everything — keep at least one block visible.
    if (visibleCount(next) === 0) return;
    onChange(next);
  };

  const badge = system
    ? `${system.osDisplayName} · ${system.hostname} · ${system.arch}`
    : "Local system";

  return (
    <div className="local-layout-toolbar" role="toolbar" aria-label="Local workspace layout">
      <span className="local-system-badge" title={system?.defaultShell ?? ""}>
        {badge}
      </span>
      <button
        type="button"
        className={`btn btn-ghost ${layout.leftPanel ? "active" : ""}`}
        onClick={() => toggle("leftPanel")}
        aria-pressed={layout.leftPanel}
      >
        Left panel
      </button>
      <button
        type="button"
        className={`btn btn-ghost ${layout.rightPanel ? "active" : ""}`}
        onClick={() => toggle("rightPanel")}
        aria-pressed={layout.rightPanel}
      >
        Right panel
      </button>
      <button
        type="button"
        className={`btn btn-ghost ${layout.terminal ? "active" : ""}`}
        onClick={() => toggle("terminal")}
        aria-pressed={layout.terminal}
      >
        Terminal
      </button>
    </div>
  );
}
