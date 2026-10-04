import { describe, expect, it } from "vitest";
import { angDiff, bearing, haversine } from "../geo";
import { routeFromPath } from "../testing";
import { classifyTurn, nextManeuver } from "./maneuver";
import { buildPlan, planSlice, pointAtAlong, snapToPlan } from "./plan";

describe("geo", () => {
  it("bearing and haversine", () => {
    const a = { lat: 37.5, lon: 127 };
    const north = { lat: 37.5009, lon: 127 };
    expect(bearing(a, north)).toBeCloseTo(0, 3);
    expect(haversine(a, north)).toBeCloseTo(100.1, 0);
  });
  it("angDiff is signed, + = clockwise", () => {
    expect(angDiff(350, 10)).toBe(20);
    expect(angDiff(10, 350)).toBe(-20);
    expect(angDiff(0, 180)).toBe(180);
  });
});

describe("classifyTurn", () => {
  it.each([
    [10, "straight"],
    [-45, "slight_left"],
    [45, "slight_right"],
    [-90, "turn_left"],
    [90, "turn_right"],
    [170, "u_turn"],
  ] as const)("%d deg -> %s", (deg, m) => expect(classifyTurn(deg)).toBe(m));
});

describe("nextManeuver", () => {
  // north 30 m, then west 20 m (left turn), at 1 m/s
  const route = routeFromPath(
    [
      [0, 0],
      [0, 30],
      [-20, 30],
    ],
    1,
  );
  const plan = buildPlan(route);

  it("simplifies to the corner", () => {
    expect(plan.points.length).toBe(3);
    expect(plan.length).toBeCloseTo(50, 0);
  });

  it("reports the upcoming left turn and its distance", () => {
    const snap = snapToPlan(plan, route[24]); // 24 m north
    const nav = nextManeuver(plan, snap);
    expect(nav.maneuver).toBe("turn_left");
    expect(nav.distM).toBeCloseTo(6, 0);
    expect(nav.turnDeg).toBeCloseTo(-90, 0);
  });

  it("is straight after the turn and arrives at the end", () => {
    const after = nextManeuver(plan, snapToPlan(plan, route[35]));
    expect(after.maneuver).toBe("straight");
    expect(after.distM).toBeCloseTo(15, 0);
    const end = nextManeuver(plan, snapToPlan(plan, route[route.length - 2]));
    expect(end.maneuver).toBe("arrived");
  });

  it("slices the plan between along-distances (map-matched overlay)", () => {
    const s = planSlice(plan, 25, 35);
    expect(s).toHaveLength(3); // start, the corner, end
    expect(haversine(s[0], s[1])).toBeCloseTo(5, 0);
    expect(haversine(s[1], s[2])).toBeCloseTo(5, 0);
    expect(haversine(pointAtAlong(plan, 0), route[0])).toBeLessThan(0.01);
  });

  it("measures cross-track offset from the planned route", () => {
    const snap = snapToPlan(plan, { lat: route[10].lat, lon: route[10].lon + 2 / (111320 * Math.cos((37.5 * Math.PI) / 180)) });
    expect(snap.offset).toBeCloseTo(2, 1);
  });

  it("merges a junction split over two vertices into one right turn", () => {
    const r = routeFromPath(
      [
        [0, 0],
        [0, 20],
        [3, 23],
        [20, 23],
      ],
      1,
    );
    const p = buildPlan(r, 0.5);
    const nav = nextManeuver(p, snapToPlan(p, r[5]));
    expect(nav.maneuver).toBe("turn_right");
    expect(nav.turnDeg).toBeCloseTo(90, 0);
  });
});
