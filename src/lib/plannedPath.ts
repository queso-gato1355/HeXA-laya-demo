// Planned path ("Tesla-style" ribbon) from the final command: where the robot intends to drive over the
// next few seconds, in the robot's own frame (forward, right). It is drawn straight from the camera
// model, so unlike the GPS route it does not inherit GPS position/heading errors.
//
// The front camera only sees the ground from `minVisibleM` on (≈1.4 m for the calibrated FrodoBots camera),
// so lengths, turn starts and detours are placed relative to that, otherwise they would be off-screen.
import { ROVER, type RoverProfile, type SpeedLevel, speedFor } from "@/config/rover";
import type { ZoneState } from "@shared/state";
import type { Action } from "./arbiter";
import type { NavInstruction } from "./route/maneuver";

export const HORIZON_S = 4;
/** visible part of a moving path is at least this long */
export const MIN_VISIBLE_LEN_M = 2;
export const MAX_LEN_M = 8;
export const TURN_RADIUS_M = 1.5;
export const STEER_OFFSET_M = 0.7;
export const STEER_RAMP_M = 1.5;
const STEP_M = 0.1;
const STOP_LEN_M = 0.6;

/** sample of the centre line: f forward, r right (m), theta heading relative to now (rad, + = right) */
export interface PathPoint {
  f: number;
  r: number;
  theta: number;
}

export interface PlannedPath {
  kind: "drive" | "stop" | "yield";
  points: PathPoint[];
  lengthM: number;
}

const ZONE_RANK: Record<ZoneState, number> = { open: 0, partial: 1, blocked: 2 };

export function pathLength(action: Action, speed: SpeedLevel, minVisibleM = 0, rover: RoverProfile = ROVER): number {
  if (action === "STOP" || action === "yield_wait" || speed === "stop") return minVisibleM + STOP_LEN_M;
  return Math.min(MAX_LEN_M, Math.max(minVisibleM + MIN_VISIBLE_LEN_M, speedFor(speed, rover) * HORIZON_S));
}

/** side with more free space for a detour: -1 left, +1 right (ties go left) */
export function detourSide(fs?: { left: ZoneState; right: ZoneState }): -1 | 1 {
  if (!fs) return -1;
  return ZONE_RANK[fs.right] < ZONE_RANK[fs.left] ? 1 : -1;
}

export function plannedPath(opts: {
  action: Action;
  speed: SpeedLevel;
  nav: NavInstruction;
  freeSpace?: { left: ZoneState; center: ZoneState; right: ZoneState };
  /** nearest ground distance the camera sees (projection.nearestVisibleGroundM) */
  minVisibleM?: number;
  rover?: RoverProfile;
}): PlannedPath {
  const { action, speed, nav, freeSpace } = opts;
  const vis = opts.minVisibleM ?? 0;
  const L = pathLength(action, speed, vis, opts.rover);
  const stopping = action === "STOP" || speed === "stop";
  const kind: PlannedPath["kind"] = action === "yield_wait" ? "yield" : stopping ? "stop" : "drive";
  const start = Math.max(0, vis - 0.3); // a little below the frame edge so the ribbon reaches it

  if (action === "steer_around" && kind === "drive") {
    const side = detourSide(freeSpace);
    const s0 = Math.max(0, vis - 0.2); // sidestep starts where it becomes visible
    const Ls = Math.max(L, s0 + STEER_RAMP_M + 0.5); // always show the complete sidestep
    const points: PathPoint[] = [];
    for (let s = start; s <= Ls + 1e-9; s += STEP_M) {
      const u = Math.min(Math.max((s - s0) / STEER_RAMP_M, 0), 1);
      const r = (side * STEER_OFFSET_M * (1 - Math.cos(Math.PI * u))) / 2;
      const ramp = s > s0 && s < s0 + STEER_RAMP_M;
      const dr = ramp ? (side * STEER_OFFSET_M * Math.PI * Math.sin(Math.PI * u)) / (2 * STEER_RAMP_M) : 0;
      points.push({ f: s, r, theta: Math.atan(dr) });
    }
    return { kind, points, lengthM: Ls };
  }

  // curvature profile: straight until the turn starts, then a quarter circle, then straight
  let turnSign = 0;
  let turnStart = Infinity;
  if (kind === "drive" && (action === "turn_left" || action === "turn_right")) {
    turnSign = action === "turn_right" ? 1 : -1;
    const navSameDir =
      (turnSign > 0 && (nav.maneuver === "turn_right" || nav.maneuver === "slight_right")) ||
      (turnSign < 0 && (nav.maneuver === "turn_left" || nav.maneuver === "slight_left" || nav.maneuver === "u_turn"));
    // turn at the navigated junction when it is within view, otherwise "now" (just inside the view)
    turnStart = navSameDir ? Math.min(Math.max(nav.distM, vis + 0.3), Math.max(vis + 0.3, L * 0.6)) : vis + 0.3;
  }
  const turnEnd = turnStart + (Math.PI / 2) * TURN_RADIUS_M;
  const points: PathPoint[] = [];
  let f = 0;
  let r = 0;
  let theta = 0;
  const ds = STEP_M / 2; // integrate at half the output step, emit every other sample
  const n = Math.round(L / ds);
  const i0 = Math.round(start / ds);
  for (let i = 0; i <= n; i++) {
    const s = i * ds;
    if (i >= i0 && (i - i0) % 2 === 0) points.push({ f, r, theta });
    const k = s >= turnStart && s < turnEnd ? turnSign / TURN_RADIUS_M : 0;
    f += Math.cos(theta) * ds;
    r += Math.sin(theta) * ds;
    theta += k * ds;
  }
  return { kind, points, lengthM: L };
}

/** left/right ribbon edges of a centre line (robot frame) */
export function ribbonEdges(points: PathPoint[], widthM: number): { left: PathPoint[]; right: PathPoint[] } {
  const h = widthM / 2;
  return {
    left: points.map((p) => ({ f: p.f + Math.sin(p.theta) * h, r: p.r - Math.cos(p.theta) * h, theta: p.theta })),
    right: points.map((p) => ({ f: p.f - Math.sin(p.theta) * h, r: p.r + Math.cos(p.theta) * h, theta: p.theta })),
  };
}
