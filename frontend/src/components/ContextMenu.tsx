import { useEffect, useRef } from "react";
import "./contextmenu.css";

export type ContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
};

type Props = {
  open: boolean;
  anchorEl: HTMLElement | null;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ open, anchorEl, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorEl]);

  if (!open || !anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = Math.min(rect.left, window.innerWidth - 260);

  return (
    <div className="ctxmenu-overlay">
      <div
        className="ctxmenu"
        ref={menuRef}
        style={{ top, left }}
        role="menu"
      >
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`ctxmenu-item ${it.danger ? "danger" : ""}`}
            disabled={!!it.disabled}
            onClick={() => {
              if (it.disabled) return;
              it.onClick();
              onClose();
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

