import { describe, expect, it } from "vitest";

import { lockMobileSwipeAxis, resolveMobileCardSwipe } from "./mobileSwipe";

describe("lockMobileSwipeAxis", () => {
  it("waits for deliberate movement before locking an axis", () => {
    expect(lockMobileSwipeAxis({ dx: 3, dy: -8 })).toBe("pending");
  });

  it("locks clearly vertical movement and rejects clearly horizontal movement", () => {
    expect(lockMobileSwipeAxis({ dx: 4, dy: -18 })).toBe("vertical");
    expect(lockMobileSwipeAxis({ dx: 20, dy: -4 })).toBe("horizontal");
  });
});

describe("resolveMobileCardSwipe", () => {
  it("moves to the next card after an upward distance swipe", () => {
    expect(resolveMobileCardSwipe({
      axis: "vertical",
      dx: 6,
      dy: -96,
      elapsedMs: 500,
      stageHeight: 600,
    })).toBe(1);
  });

  it("moves to the previous card after a downward distance swipe", () => {
    expect(resolveMobileCardSwipe({
      axis: "vertical",
      dx: -4,
      dy: 96,
      elapsedMs: 500,
      stageHeight: 600,
    })).toBe(-1);
  });

  it("accepts a short, fast flick after the minimum travel distance", () => {
    expect(resolveMobileCardSwipe({
      axis: "vertical",
      dx: 2,
      dy: -24,
      elapsedMs: 40,
      stageHeight: 600,
    })).toBe(1);
  });

  it("rebounds after a short, slow drag", () => {
    expect(resolveMobileCardSwipe({
      axis: "vertical",
      dx: 2,
      dy: -24,
      elapsedMs: 400,
      stageHeight: 600,
    })).toBe(0);
  });

  it("does not switch after a horizontal or unresolved gesture", () => {
    expect(resolveMobileCardSwipe({
      axis: "horizontal",
      dx: 120,
      dy: -30,
      elapsedMs: 100,
      stageHeight: 600,
    })).toBe(0);
    expect(resolveMobileCardSwipe({
      axis: "pending",
      dx: 8,
      dy: -8,
      elapsedMs: 100,
      stageHeight: 600,
    })).toBe(0);
  });
});
