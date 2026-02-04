import { useCallback, useEffect, useState } from "react";
import { Quit, WindowIsMaximised, WindowMinimise, WindowToggleMaximise } from "../../wailsjs/runtime/runtime";

function IconMinimise() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 8.5h8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconMaximise() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.25" y="2.25" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconRestore() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.25 2.75h5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M2.75 4.25h5v5h-5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3 3l6 6M9 3L3 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WindowControls() {
  const [isMaximised, setIsMaximised] = useState(false);

  const syncMax = useCallback(async () => {
    try {
      setIsMaximised(await WindowIsMaximised());
    } catch {
      // ignore (e.g., during early bootstrap)
    }
  }, []);

  useEffect(() => {
    void syncMax();
    const onMaybeChanged = () => void syncMax();
    window.addEventListener("resize", onMaybeChanged);
    window.addEventListener("focus", onMaybeChanged);
    return () => {
      window.removeEventListener("resize", onMaybeChanged);
      window.removeEventListener("focus", onMaybeChanged);
    };
  }, [syncMax]);

  const onToggleMax = useCallback(() => {
    WindowToggleMaximise();
    // Give the window manager a moment, then re-sync.
    setTimeout(() => void syncMax(), 50);
  }, [syncMax]);

  return (
    <div className="window-controls" aria-label="Window controls">
      <button
        className="window-btn"
        type="button"
        title="Minimize"
        onClick={(e) => {
          e.stopPropagation();
          WindowMinimise();
        }}
      >
        <IconMinimise />
      </button>
      <button
        className="window-btn"
        type="button"
        title={isMaximised ? "Restore" : "Maximize"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMax();
        }}
      >
        {isMaximised ? <IconRestore /> : <IconMaximise />}
      </button>
      <button
        className="window-btn close"
        type="button"
        title="Close"
        onClick={(e) => {
          e.stopPropagation();
          Quit();
        }}
      >
        <IconClose />
      </button>
    </div>
  );
}

