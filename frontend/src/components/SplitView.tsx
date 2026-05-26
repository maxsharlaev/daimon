import { CSSProperties, ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import "./splitview.css";

type Props = {
  left: ReactNode;
  right: ReactNode;
  orientation?: "horizontal" | "vertical";
  /** Controlled split ratio (% of first pane). When set, only user drag updates persist via onPctChange. */
  pct?: number;
  initialLeftPct?: number;
  minLeftPx?: number;
  minRightPx?: number;
  onPctChange?: (pct: number) => void;
};

export function SplitView({
  left,
  right,
  orientation = "horizontal",
  pct: controlledPct,
  initialLeftPct = 34,
  minLeftPx = 260,
  minRightPx = 320,
  onPctChange,
}: Props) {
  const vertical = orientation === "vertical";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isControlled = controlledPct !== undefined;
  const [uncontrolledPct, setUncontrolledPct] = useState(() => clamp(initialLeftPct, 10, 90));
  const [dragPct, setDragPct] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ min: 10, max: 90 });
  const draggingRef = useRef(false);
  const storedPct = isControlled ? controlledPct : uncontrolledPct;
  const leftPct = clamp(dragPct ?? storedPct, bounds.min, bounds.max);
  const leftPctRef = useRef(leftPct);
  leftPctRef.current = leftPct;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateBounds = () => {
      const rect = el.getBoundingClientRect();
      const total = vertical ? rect.height : rect.width;
      if (total <= 0) return;
      const minFirstPct = (minLeftPx / total) * 100;
      const minSecondPct = (minRightPx / total) * 100;
      setBounds({ min: minFirstPct, max: 100 - minSecondPct });
    };
    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vertical, minLeftPx, minRightPx]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pos = vertical ? e.clientY - rect.top : e.clientX - rect.left;
      const total = vertical ? rect.height : rect.width;
      if (total <= 0) return;
      const pct = (pos / total) * 100;
      setDragPct(clamp(pct, bounds.min, bounds.max));
    },
    [vertical, bounds.min, bounds.max]
  );

  const onPointerUp = useCallback(() => {
    if (draggingRef.current) {
      const next = leftPctRef.current;
      onPctChange?.(next);
      if (!isControlled) setUncontrolledPct(next);
    }
    draggingRef.current = false;
    setDragPct(null);
  }, [onPctChange, isControlled]);

  const track = `${leftPct}fr 8px ${100 - leftPct}fr`;
  const gridStyle: CSSProperties = vertical
    ? { gridTemplateRows: track }
    : { gridTemplateColumns: track };

  return (
    <div
      className={`splitview ${vertical ? "splitview-vertical" : "splitview-horizontal"}`}
      ref={containerRef}
      style={gridStyle}
    >
      <div className="splitview-pane splitview-pane-first">{left}</div>
      <div
        className="splitview-divider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="splitview-pane splitview-pane-second">{right}</div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
