import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./dropdown-select.css";

export type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Variant = "field" | "pill" | "pillOp" | "joinChip" | "andPill";

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  /** Shown when value is empty or not in list */
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  variant?: Variant;
  /** For pill variants: narrow layout */
  inline?: boolean;
  className?: string;
  "aria-label"?: string;
  id?: string;
  emptyMessage?: string;
  /** Optional header line inside panel (e.g. "ANY") */
  listHeader?: string;
  /** Panel horizontal alignment relative to trigger */
  dropdownAlign?: "start" | "center";
};

export function DropdownSelect({
  value,
  onChange,
  options,
  placeholder = "—",
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search…",
  variant = "field",
  inline = false,
  className = "",
  "aria-label": ariaLabel,
  id: idProp,
  emptyMessage = "No options",
  listHeader,
  dropdownAlign = "start",
}: Props) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const triggerId = idProp ?? `${uid}-trigger`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = useMemo(() => {
    const o = options.find((x) => x.value === value);
    return o?.label;
  }, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  const displayLabel = selectedLabel ?? (value ? value : placeholder);
  const showPlaceholder = !selectedLabel && (!value || value === "");

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && searchable) {
      queueMicrotask(() => searchInputRef.current?.focus());
    }
  }, [open, searchable]);

  const toggle = () => {
    if (disabled) return;
    setOpen((o) => !o);
    if (open) setQuery("");
  };

  const triggerClass =
    variant === "field"
      ? "ds-trigger ds-trigger--field"
      : variant === "pillOp"
        ? "ds-trigger ds-trigger--pill ds-trigger--pill-op"
        : variant === "joinChip"
          ? "ds-trigger ds-trigger--join-chip"
          : variant === "andPill"
            ? "ds-trigger ds-trigger--and-pill"
            : "ds-trigger ds-trigger--pill";

  return (
    <div
      ref={rootRef}
      className={`ds-root${inline ? " ds-root--inline" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        id={triggerId}
        className={triggerClass}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={toggle}
      >
        <span
          className={`ds-trigger-label${showPlaceholder ? " ds-trigger-placeholder" : ""}`}
        >
          {displayLabel}
        </span>
      </button>
      {open ? (
        <div
          id={listboxId}
          className={`ds-dropdown${dropdownAlign === "center" ? " ds-dropdown--center" : ""}`}
          role="listbox"
          aria-labelledby={ariaLabel ? triggerId : undefined}
        >
          {searchable ? (
            <div className="ds-dropdown-search" onMouseDown={(e) => e.preventDefault()}>
              <input
                ref={searchInputRef}
                type="text"
                className="ds-dropdown-search-input"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={searchPlaceholder}
              />
            </div>
          ) : null}
          {listHeader ? <div className="ds-dropdown-hdr">{listHeader}</div> : null}
          <div className="ds-dropdown-scroll">
            {filtered.length === 0 ? (
              <div className="ds-dropdown-empty">{emptyMessage}</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  className="ds-dropdown-item"
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    close();
                  }}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
