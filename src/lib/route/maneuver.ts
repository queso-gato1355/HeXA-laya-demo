// Deterministic navigation instruction ("내비 지시"), shown next to — not mixed with — Laya's judgement.
import type { Maneuver } from "@shared/state";
import { type RoutePlan, type Snap, turnAt } from "./plan";

export const TRIGGER_DEG = 30;
export const ARRIVE_M = 3;
/** after the trigger vertex, keep summing same-direction turns within this distance (one junction) */
const MERGE_M = 8;

export interface NavInstruction {
  maneuver: Maneuver;
  distM: number;
  /** signed total heading change of the maneuver (deg, + = right) */
  turnDeg: number;
  /** waypoint index of the maneuver point (plan.points) */
  vertex: number | null;
}

export function classifyTurn(deg: number): Maneuver {
  const a = Math.abs(deg);
  if (a < TRIGGER_DEG) return "straight";
  if (a >= 150) return "u_turn";
  const right = deg > 0;
  if (a < 60) return right ? "slight_right" : "slight_left";
  return right ? "turn_right" : "turn_left";
}

export function nextManeuver(plan: RoutePlan, snap: Snap): NavInstruction {
  const remaining = Math.max(0, plan.length - snap.along);
  if (remaining < ARRIVE_M) return { maneuver: "arrived", distM: remaining, turnDeg: 0, vertex: plan.points.length - 1 };

  // accumulate bearing change over the vertices ahead of the current segment
  let cum = 0;
  for (let v = snap.seg + 1; v < plan.points.length - 1; v++) {
    cum += turnAt(plan, v);
    if (Math.abs(cum) >= TRIGGER_DEG) {
      let total = cum;
      for (let w = v + 1; w < plan.points.length - 1 && plan.cum[w] - plan.cum[v] <= MERGE_M; w++) {
        const d = turnAt(plan, w);
        if (Math.sign(d) === Math.sign(total)) total += d;
      }
      return { maneuver: classifyTurn(total), distM: Math.max(0, plan.cum[v] - snap.along), turnDeg: total, vertex: v };
    }
  }
  return { maneuver: "straight", distM: remaining, turnDeg: 0, vertex: null };
}

export const MANEUVER_KO: Record<Maneuver, string> = {
  straight: "직진",
  slight_left: "왼쪽 방향",
  turn_left: "좌회전",
  slight_right: "오른쪽 방향",
  turn_right: "우회전",
  u_turn: "유턴",
  arrived: "도착",
};
