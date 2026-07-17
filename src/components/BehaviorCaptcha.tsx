"use client";

import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

type BehaviorTrackPoint = {
  x: number;
  y: number;
  t: number;
};

type BehaviorCaptchaChallenge = {
  token: string;
  mode: "slide" | "click_order";
  expiresAt: number;
  slide?: {
    targetX: number;
    tolerance: number;
  };
  clickOrder?: {
    order: string[];
    items: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
    }>;
  };
};

type ClickRecord = {
  id?: string;
  x?: number;
  y?: number;
  t?: number;
};

export function BehaviorCaptcha({
  open,
  onCancel,
  onVerified,
}: {
  open: boolean;
  onCancel: () => void;
  onVerified: (token: string) => void;
}) {
  const [challenge, setChallenge] = useState<BehaviorCaptchaChallenge | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [clicks, setClicks] = useState<ClickRecord[]>([]);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(0);
  const trackRef = useRef<BehaviorTrackPoint[]>([]);
  const pointerStartRef = useRef({ x: 0, dragX: 0 });

  useEffect(() => {
    if (open) void loadChallenge();
  }, [open]);

  async function loadChallenge(options: { keepMessage?: boolean } = {}) {
    setBusy(true);
    if (!options.keepMessage) setMessage("");
    setChallenge(null);
    setClicks([]);
    setDragX(0);
    trackRef.current = [];
    startRef.current = 0;
    const response = await fetch("/api/auth/behavior-captcha/challenge", { method: "POST" });
    if (!response.ok) {
      setMessage("验证码加载失败，请重试。");
      setBusy(false);
      return;
    }
    setChallenge(await response.json() as BehaviorCaptchaChallenge);
    setBusy(false);
  }

  function beginTrack(event: PointerEvent<HTMLElement>) {
    const now = performance.now();
    if (!startRef.current) {
      startRef.current = now;
      trackRef.current = [];
    }
    trackRef.current.push({ x: event.clientX, y: event.clientY, t: now - startRef.current });
  }

  function appendTrack(event: PointerEvent<HTMLElement>) {
    if (!startRef.current) return;
    const now = performance.now();
    trackRef.current.push({ x: event.clientX, y: event.clientY, t: now - startRef.current });
  }

  async function verify(payload: {
    slide?: { finalX?: number };
    clickOrder?: { clicks?: ClickRecord[] };
  }) {
    if (!challenge || busy) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/behavior-captcha/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeToken: challenge.token,
        mode: challenge.mode,
        durationMs: Math.round(performance.now() - startRef.current),
        track: trackRef.current,
        ...payload,
      }),
    });
    const body = await response.json().catch(() => ({})) as { token?: string; error?: string };
    if (!response.ok || !body.token) {
      setMessage(body.error || "验证不通过，请重试。");
      setBusy(false);
      await loadChallenge({ keepMessage: true });
      return;
    }
    setBusy(false);
    onVerified(body.token);
  }

  function handleSlidePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!challenge?.slide || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    pointerStartRef.current = { x: event.clientX, dragX };
    beginTrack(event);
  }

  function handleSlidePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging || !challenge?.slide) return;
    appendTrack(event);
    setDragX(Math.max(0, Math.min(260, pointerStartRef.current.dragX + event.clientX - pointerStartRef.current.x)));
  }

  function handleSlidePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    appendTrack(event);
    setDragging(false);
    const finalX = Math.max(0, Math.min(260, pointerStartRef.current.dragX + event.clientX - pointerStartRef.current.x));
    setDragX(finalX);
    void verify({ slide: { finalX } });
  }

  function handleCaptchaAreaMove(event: PointerEvent<HTMLDivElement>) {
    if (!startRef.current) beginTrack(event);
    else appendTrack(event);
  }

  function handleClickItem(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!challenge?.clickOrder || busy) return;
    beginTrack(event);
    appendTrack(event);
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const nextClicks = [...clicks, {
      id,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      t: performance.now() - startRef.current,
    }];
    setClicks(nextClicks);
    if (nextClicks.length === challenge.clickOrder.order.length) {
      void verify({ clickOrder: { clicks: nextClicks } });
    }
  }

  if (!open) return null;

  const orderLabels = challenge?.clickOrder
    ? challenge.clickOrder.order
      .map((id) => challenge.clickOrder?.items.find((item) => item.id === id)?.label)
      .filter(Boolean)
      .join(" → ")
    : "";

  return (
    <div className="chron-captcha-backdrop" role="presentation">
      <section aria-label="行为验证码" aria-modal="true" className="chron-captcha-modal" role="dialog">
        <div className="chron-captcha-head">
          <div><span>行为验证</span><strong>完成验证后继续注册</strong></div>
          <button aria-label="关闭行为验证码" onClick={onCancel} type="button">×</button>
        </div>

        {!challenge ? (
          <div className="chron-captcha-loading">{busy ? "加载中…" : ""}</div>
        ) : challenge.mode === "slide" && challenge.slide ? (
          <div className="chron-captcha-track">
            <span className="chron-captcha-target" style={{ left: challenge.slide.targetX }} />
            <button
              aria-label="拖动滑块"
              className="chron-captcha-handle"
              disabled={busy}
              onPointerDown={handleSlidePointerDown}
              onPointerMove={handleSlidePointerMove}
              onPointerUp={handleSlidePointerUp}
              style={{ transform: `translateX(${dragX}px)` }}
              type="button"
            >
              ⇥
            </button>
          </div>
        ) : challenge.clickOrder ? (
          <div className="chron-captcha-click">
            <div className="chron-captcha-order">{orderLabels}</div>
            <div className="chron-captcha-click-area" onPointerMove={handleCaptchaAreaMove}>
              {challenge.clickOrder.items.map((item) => (
                <button
                  aria-label={`点击 ${item.label}`}
                  className={clicks.some((click) => click.id === item.id) ? "selected" : ""}
                  disabled={busy}
                  key={item.id}
                  onPointerDown={(event) => handleClickItem(event, item.id)}
                  style={{ left: item.x, top: item.y }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {message ? <p className="chron-error">{message}</p> : null}
        <button className="chron-captcha-refresh" disabled={busy} onClick={() => void loadChallenge()} type="button">
          换一个验证
        </button>
      </section>
    </div>
  );
}
