import { describe, expect, it } from "vitest";
import { LatencyTracker, cyclePeriodS, isDue, planCycle, type SchedEntry } from "./scheduler";

const entries: SchedEntry[] = [
  { name: "collision_risk", rateHz: 2, priority: 1, applies: true },
  { name: "maneuver", rateHz: 1, priority: 3, applies: true },
  { name: "route_adherence", rateHz: 0.2, priority: 5, applies: true },
  { name: "crossing_safe", rateHz: 1, priority: 2, applies: false },
];

describe("scheduler", () => {
  it("cycle period follows the fastest criterion", () => {
    expect(cyclePeriodS(entries)).toBe(0.5);
    expect(cyclePeriodS(entries, 1)).toBe(1);
  });

  it("isDue honours each criterion's own rate and backward seeks", () => {
    expect(isDue(10, undefined, 1)).toBe(true);
    expect(isDue(10, 9.5, 2)).toBe(true);
    expect(isDue(10, 9.5, 1)).toBe(false);
    expect(isDue(10, 12, 1)).toBe(true);
  });

  it("runs due criteria by priority and skips low priority over budget", () => {
    const plan = planCycle({
      now: 10,
      entries,
      lastRun: {},
      periodS: 0.5, // budget 350 ms
      estimateMs: () => 150,
    });
    expect(plan.run).toEqual(["collision_risk", "maneuver"]);
    expect(plan.skipped).toEqual(["route_adherence"]);
    expect(plan.notApplicable).toEqual(["crossing_safe"]);
  });

  it("always runs the top criterion even if it alone is over budget", () => {
    const plan = planCycle({ now: 1, entries, lastRun: {}, periodS: 0.5, estimateMs: () => 1000 });
    expect(plan.run).toEqual(["collision_risk"]);
  });

  it("force (pause/seek) runs everything applicable", () => {
    const plan = planCycle({ now: 1, entries, lastRun: { collision_risk: 1, maneuver: 1, route_adherence: 1 }, periodS: 0.5, estimateMs: () => 1000, force: true });
    expect(plan.run).toHaveLength(3);
  });

  it("latency tracker ignores the cold first call and estimates a high percentile", () => {
    const lt = new LatencyTracker(100);
    expect(lt.estimate("x")).toBe(100);
    lt.add("x", 5000); // cold start
    expect(lt.has("x")).toBe(false);
    for (const ms of [50, 60, 70, 80, 300]) lt.add("x", ms);
    expect(lt.estimate("x")).toBe(300);
    for (const ms of [50, 60, 70, 80, 55]) lt.add("x", ms);
    expect(lt.estimate("x")).toBeLessThan(300);
  });
});
