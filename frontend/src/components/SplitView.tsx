import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import "./splitview.css";

type Props = {
  left: ReactNode;
  right: ReactNode;
  initialLeftPct?: number; // 0..100
  minLeftPx?: number;
  minRightPx?: number;
};

export function SplitView({
  left,
  right,
  initialLeftPct = 34,
  minLeftPx = 260,
  minRightPx = 320,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPct, setLeftPct] = useState(() => clamp(initialLeftPct, 10, 90));
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;

    // enforce min sizes (px) converted to pct
    const minLeftPct = (minLeftPx / rect.width) * 100;
    const minRightPct = (minRightPx / rect.width) * 100;
    setLeftPct(clamp(pct, minLeftPct, 100 - minRightPct));
  }, [minLeftPx, minRightPx]);

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // If window size changes, ensure we still respect min panes
  useEffect(() => {
    const handler = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const minLeftPct = (minLeftPx / rect.width) * 100;
      const minRightPct = (minRightPx / rect.width) * 100;
      setLeftPct((p) => clamp(p, minLeftPct, 100 - minRightPct));
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [minLeftPx, minRightPx]);

  return (
    <div className="splitview" ref={containerRef}>
      <div className="splitview-pane" style={{ width: `${leftPct}%` }}>
        {left}
      </div>
      <div
        className="splitview-divider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="splitview-pane" style={{ width: `${100 - leftPct}%` }}>
        {right}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

