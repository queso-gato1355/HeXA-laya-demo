import { describe, expect, it } from "vitest";
import type { NavInstruction } from "./route/maneuver";
import { MAX_LEN_M, TURN_RADIUS_M, detourSide, pathLength, plannedPath, ribbonEdges } from "./plannedPath";

const nav = (maneuver: NavInstruction["maneuver"], distM = 20): NavInstruction => ({ maneuver, distM, turnDeg: 0, vertex: null });
const last = <T,>(a: T[]) => a[a.length - 1];

describe("plannedPath", () => {
  it("length follows target speed x 4 s, at least 2 m beyond the first visible ground", () => {
    expect(pathLength("go_straight", "normal")).toBeCloseTo(4.8, 6); // 1.2 m/s
    expect(pathLength("go_straight", "crawl")).toBe(2); // 1.2 -> min 0 + 2
    expect(pathLength("go_straight", "crawl", 1.4)).toBeCloseTo(3.4, 6);
    expect(pathLength("STOP", "stop", 1.4)).toBeCloseTo(2.0, 6);
    expect(pathLength("go_straight", "normal", 10)).toBe(MAX_LEN_M);
  });

  it("go_straight stays on the centre line from the first visible ground", () => {
    const p = plannedPath({ action: "go_straight", speed: "slow", nav: nav("straight") });
    expect(p.kind).toBe("drive");
    expect(p.points[0].f).toBeCloseTo(0, 6);
    expect(p.points.every((q) => q.r === 0)).toBe(true);
    expect(last(p.points).f).toBeCloseTo(2.8, 1); // 0.7 m/s x 4 s
    const q = plannedPath({ action: "go_straight", speed: "slow", nav: nav("straight"), minVisibleM: 1.4 });
    expect(q.points[0].f).toBeCloseTo(1.1, 6); // starts just below the frame edge
  });

  it("turn_right bends right (positive r) and ends heading ~90 deg right", () => {
    const p = plannedPath({ action: "turn_right", speed: "normal", nav: nav("turn_right", 2), minVisibleM: 1.4 });
    const end = last(p.points);
    expect(end.r).toBeGreaterThan(0.5);
    expect(end.theta).toBeCloseTo(Math.PI / 2, 1);
    // quarter circle starting at the junction (2 m ahead)
    expect(end.f).toBeLessThanOrEqual(2 + TURN_RADIUS_M + 0.05);
  });

  it("turn_left bends left", () => {
    const p = plannedPath({ action: "turn_left", speed: "slow", nav: nav("straight") });
    expect(last(p.points).r).toBeLessThan(0);
  });

  it("steer_around shifts toward the freer side", () => {
    const fs = { left: "blocked", center: "partial", right: "open" } as const;
    expect(detourSide(fs)).toBe(1);
    const p = plannedPath({ action: "steer_around", speed: "crawl", nav: nav("straight"), freeSpace: fs });
    expect(last(p.points).r).toBeCloseTo(0.7, 1);
    const q = plannedPath({ action: "steer_around", speed: "crawl", nav: nav("straight"), freeSpace: fs, minVisibleM: 1.4 });
    expect(q.points.find((x) => x.f >= 1.15)!.r).toBeLessThan(0.05); // sidestep begins inside the view
    expect(detourSide({ left: "open", right: "open" })).toBe(-1);
  });

  it("STOP / yield_wait give a short stop-or-yield path", () => {
    expect(plannedPath({ action: "STOP", speed: "stop", nav: nav("straight") }).kind).toBe("stop");
    const y = plannedPath({ action: "yield_wait", speed: "stop", nav: nav("straight") });
    expect(y.kind).toBe("yield");
    expect(last(y.points).f).toBeLessThanOrEqual(0.61);
    expect(last(plannedPath({ action: "STOP", speed: "stop", nav: nav("straight"), minVisibleM: 1.4 }).points).f).toBeCloseTo(2.0, 1);
  });

  it("ribbon edges are half a body width either side", () => {
    const p = plannedPath({ action: "go_straight", speed: "slow", nav: nav("straight") });
    const { left, right } = ribbonEdges(p.points, 0.4);
    expect(left[0].r).toBeCloseTo(-0.2, 6);
    expect(right[0].r).toBeCloseTo(0.2, 6);
  });
});
