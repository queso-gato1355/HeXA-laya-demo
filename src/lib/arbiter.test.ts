import type { Answer } from "@shared/laya-types";
import { describe, expect, it } from "vitest";
import { arbitrate, isStale, type TimedAnswer } from "./arbiter";
import { safetyCheck } from "./safety";
import { obj } from "./testing";

const noul = (p: number): Answer => ({ type: "noul", noul: p, rl_agent: { act_probability: 1 } });
const score = (s: number): Answer => ({ type: "score", score: s, legend: {}, probabilities: {}, confidence: 1, rl_agent: { act_probability: 1 } });
const choice = (c: string): Answer => ({ type: "choice", choice: c, probabilities: { [c]: 1 }, confidence: 1, rl_agent: { act_probability: 1 } });

const at = (t: number, a: Answer): TimedAnswer => ({ t, answer: a });
const ok = { stop: false, reason: null };

function results(now: number, o: Partial<Record<string, Answer>> = {}) {
  const base: Record<string, Answer> = {
    emergency_stop: noul(0.1),
    collision_risk: score(0.5),
    path_blocked: noul(0.1),
    maneuver: choice("go_straight"),
    target_speed: choice("normal"),
    ...o,
  } as Record<string, Answer>;
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, at(now, v)]));
}

describe("arbitrate", () => {
  it("default: maneuver + target_speed", () => {
    const c = arbitrate({ now: 10, results: results(10), safety: ok, nav: "straight" });
    expect(c).toMatchObject({ action: "go_straight", speed: "normal", rule: "default", degraded: false });
  });
  it("emergency_stop >= 0.5 stops", () => {
    expect(arbitrate({ now: 10, results: results(10, { emergency_stop: noul(0.5) }), safety: ok, nav: "straight" }).rule).toBe("emergency");
  });
  it("collision_risk >= 3.0 stops", () => {
    const c = arbitrate({ now: 10, results: results(10, { collision_risk: score(3.0) }), safety: ok, nav: "straight" });
    expect(c).toMatchObject({ action: "STOP", speed: "stop", rule: "collision" });
  });
  it("path_blocked >= 0.6 -> steer_around if Laya says so, else yield_wait", () => {
    const a = arbitrate({ now: 10, results: results(10, { path_blocked: noul(0.7), maneuver: choice("steer_around") }), safety: ok, nav: "straight" });
    expect(a.action).toBe("steer_around");
    const b = arbitrate({ now: 10, results: results(10, { path_blocked: noul(0.7) }), safety: ok, nav: "straight" });
    expect(b).toMatchObject({ action: "yield_wait", speed: "stop" });
  });
  it("safety layer overrides Laya", () => {
    const c = arbitrate({ now: 10, results: results(10), safety: { stop: true, reason: "x" }, nav: "straight" });
    expect(c).toMatchObject({ action: "STOP", safetyOverride: true, rule: "safety" });
  });
  it("stale results are excluded and speed is capped at crawl", () => {
    const r = results(10);
    r.collision_risk = at(8, score(3.5)); // 2 s old -> ignored
    const c = arbitrate({ now: 10, results: r, safety: ok, nav: "straight" });
    expect(c).toMatchObject({ action: "go_straight", speed: "crawl", degraded: true, stale: ["collision_risk"] });
  });
  it("falls back to the nav instruction without a fresh maneuver", () => {
    const r = results(10);
    delete r.maneuver;
    expect(arbitrate({ now: 10, results: r, safety: ok, nav: "turn_right" }).action).toBe("turn_right");
  });
  it("results from the future (after seeking back) are stale", () => {
    expect(isStale(5, at(9, noul(0)))).toBe(true);
    expect(isStale(5, at(4, noul(0)))).toBe(false);
  });
});

describe("safetyCheck", () => {
  it("stops for a centre object within 1 m or a blocked centre zone", () => {
    const near = { t: 0, objects: [obj({ distM: 0.8, bbox: [450, 300, 560, 576] })] };
    expect(safetyCheck(near, 1024).stop).toBe(true);
    const side = { t: 0, objects: [obj({ distM: 0.8, bbox: [0, 300, 100, 576] })] };
    expect(safetyCheck(side, 1024).stop).toBe(false);
    const blocked = { t: 0, objects: [], freeSpace: { left: "open", center: "blocked", right: "open" } as const };
    expect(safetyCheck(blocked, 1024).stop).toBe(true);
  });
});
