import { LayaStateSchema } from "@shared/state";
import { describe, expect, it } from "vitest";
import { buildPlan, buildProgress } from "../route/plan";
import { detections, obj, routeFromPath } from "../testing";
import { buildState, fusedHeadingAt, headingAt, isApproaching, positionAt, positionOf, speedAt, stateObjects } from "./buildState";

const route = routeFromPath(
  [
    [0, 0],
    [0, 20],
    [-15, 20],
  ],
  1,
);
const plan = buildPlan(route);

describe("GPS helpers", () => {
  it("interpolates position linearly between 1 Hz fixes", () => {
    const p = positionAt(route, 2.5);
    expect(p.lat).toBeCloseTo((route[2].lat + route[3].lat) / 2, 9);
    expect(p.accuracyM).toBe(4);
  });
  it("speed is a 3-point moving average of segment speeds", () => {
    expect(speedAt(route, 5)).toBeCloseTo(1, 2);
  });
  it("heading = bearing of previous -> current fix, skipping stationary jitter", () => {
    expect(headingAt(route, 5)).toBeCloseTo(0, 0);
    expect(headingAt(route, 25)).toBeCloseTo(270, 0);
    const stopped = [...route.slice(0, 6), { ...route[5], t: 6 }, { ...route[5], t: 7 }];
    expect(headingAt(stopped, 6.5)).toBeCloseTo(0, 0);
  });
});

describe("fusedHeadingAt", () => {
  it("interpolates across the 0/360 wrap and clamps at the ends", () => {
    const s: [number, number][] = [
      [0, 350],
      [1, 10],
      [2, 30],
    ];
    expect(fusedHeadingAt(s, 0.5)).toBeCloseTo(0, 6);
    expect(fusedHeadingAt(s, 1.5)).toBeCloseTo(20, 6);
    expect(fusedHeadingAt(s, -1)).toBe(350);
    expect(fusedHeadingAt(s, 5)).toBe(30);
  });
});

describe("objects", () => {
  it("positions by bbox centre thirds", () => {
    expect(positionOf([0, 0, 200, 10], 1024)).toBe("left");
    expect(positionOf([450, 0, 550, 10], 1024)).toBe("center");
    expect(positionOf([800, 0, 1000, 10], 1024)).toBe("right");
  });

  it("approaching = same track id got > 0.3 m closer over the last second", () => {
    const det = detections(41, 20, (t) => ({ objects: [obj({ id: 7, distM: 5 - t * 0.5, bbox: [480, 200, 540, 400] })] }));
    expect(isApproaching(det, 2, 7, 4)).toBe(true);
    const still = detections(41, 20, () => ({ objects: [obj({ id: 7, distM: 5, bbox: [480, 200, 540, 400] })] }));
    expect(isApproaching(still, 2, 7, 5)).toBe(false);
    expect(isApproaching(det, 2, 99, 4)).toBe(false);
  });

  it("keeps the 6 closest, rounded to one decimal", () => {
    const many = Array.from({ length: 9 }, (_, i) => obj({ id: i, distM: 10 - i + 0.123, conf: 0.876, bbox: [0, 0, 100, 100] }));
    const det = detections(1, 20, () => ({ objects: many }));
    const out = stateObjects(det, det.frames[0], 0);
    expect(out).toHaveLength(6);
    expect(out[0].dist_m).toBe(2.1);
    expect(out[0].conf).toBe(0.9);
    expect(out.map((o) => o.dist_m)).toEqual([...out.map((o) => o.dist_m)].sort((a, b) => a - b));
  });
});

describe("buildState", () => {
  const det = detections(20 * 40, 20, (t) => ({
    freeSpace: { left: "open", center: t > 10 ? "partial" : "open", right: "blocked" },
    objects: [obj({ id: 3, cls: "car", distM: 8.04, bbox: [600, 200, 700, 300] })],
  }));
  const ctx = { route, plan, progress: buildProgress(plan, route), crossings: [{ tStart: 18, tEnd: 22 }], det };

  it("produces a schema-valid compact state", () => {
    const s = buildState(14, ctx);
    expect(LayaStateSchema.parse(s)).toEqual(s);
    expect(s.route.next_maneuver).toBe("turn_left");
    expect(s.route.dist_to_maneuver_m).toBeCloseTo(6, 0);
    expect(s.route.crossing_now).toBe(false);
    expect(s.free_space.center).toBe("partial");
    expect(s.objects[0]).toEqual({ type: "car", position: "center", dist_m: 8, approaching: false, conf: 0.8 });
    expect(buildState(20, ctx).route.crossing_now).toBe(true);
  });

  it("only uses numbers with at most one decimal", () => {
    const json = JSON.stringify(buildState(7.37, ctx));
    for (const m of json.match(/-?\d+\.\d+/g) ?? []) expect(m.split(".")[1].length).toBeLessThanOrEqual(1);
  });

  it("serializes well under Laya's 512-token budget", () => {
    expect(JSON.stringify(buildState(14, ctx)).length).toBeLessThan(900);
  });
});
