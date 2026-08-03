"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

interface Props {
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  /** Keep the handle visible when its panel content is the scroll container. */
  pinToViewport?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Desktop side-panel resize control. The panel grows when this left-edge handle moves left. */
export function ResizablePanelHandle({
  label,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  pinToViewport = false,
}: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const finishDrag = () => {
    dragRef.current = null;
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width };
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onWidthChange(clamp(drag.startWidth + drag.startX - event.clientX, minWidth, maxWidth));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 40 : 20;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(clamp(width + step, minWidth, maxWidth));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(clamp(width - step, minWidth, maxWidth));
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(minWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(maxWidth);
    }
  };

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label}宽度调整`}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleKeyDown}
      title="向左拖动加宽，向右拖动缩窄"
      style={{
        position: pinToViewport ? "fixed" : "absolute",
        top: pinToViewport ? "calc(50% + 34px)" : 0,
        right: pinToViewport ? width - 9 : undefined,
        left: pinToViewport ? undefined : -9,
        bottom: pinToViewport ? undefined : 0,
        width: 18,
        height: pinToViewport ? 42 : undefined,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "col-resize",
        touchAction: "none",
        transform: pinToViewport ? "translateY(-50%)" : undefined,
        zIndex: pinToViewport ? 41 : 2,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: pinToViewport ? "static" : "absolute",
          top: pinToViewport ? undefined : "50%",
          left: 0,
          display: "grid",
          width: 18,
          height: 42,
          placeItems: "center",
          transform: pinToViewport ? undefined : "translateY(-50%)",
          borderRadius: 999,
          background: "rgba(128,128,128,0.5)",
          color: "#fff",
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        ↔
      </span>
    </button>
  );
}
