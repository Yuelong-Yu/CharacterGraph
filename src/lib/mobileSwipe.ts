export type MobileSwipeAxis = "pending" | "vertical" | "horizontal";
export type MobileDeckDirection = -1 | 0 | 1;

export const MOBILE_SWIPE_AXIS_LOCK_PX = 10;
export const MOBILE_SWIPE_DISTANCE_RATIO = 0.15;
export const MOBILE_SWIPE_FLICK_MIN_PX = 20;
export const MOBILE_SWIPE_FLICK_VELOCITY = 0.45;

const AXIS_DOMINANCE_RATIO = 1.15;

export function lockMobileSwipeAxis({
  dx,
  dy,
}: {
  dx: number;
  dy: number;
}): MobileSwipeAxis {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < MOBILE_SWIPE_AXIS_LOCK_PX) return "pending";
  if (absY >= absX * AXIS_DOMINANCE_RATIO) return "vertical";
  if (absX >= absY * AXIS_DOMINANCE_RATIO) return "horizontal";
  return "pending";
}

export function resolveMobileCardSwipe({
  axis,
  dy,
  elapsedMs,
  stageHeight,
}: {
  axis: MobileSwipeAxis;
  dx: number;
  dy: number;
  elapsedMs: number;
  stageHeight: number;
}): MobileDeckDirection {
  if (axis !== "vertical" || dy === 0) return 0;

  const distance = Math.abs(dy);
  const passedDistance = stageHeight > 0
    && distance >= stageHeight * MOBILE_SWIPE_DISTANCE_RATIO;
  const velocity = distance / Math.max(1, elapsedMs);
  const passedFlick = distance >= MOBILE_SWIPE_FLICK_MIN_PX
    && velocity >= MOBILE_SWIPE_FLICK_VELOCITY;

  if (!passedDistance && !passedFlick) return 0;
  return dy < 0 ? 1 : -1;
}
