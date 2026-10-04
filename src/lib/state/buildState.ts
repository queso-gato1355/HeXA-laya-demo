// Current playback time -> compact Laya input state (fits well inside Laya's 512-token state budget).
// All numbers are rounded to one decimal so the serialized state (and its tokens) is stable.
import type { Crossing, GpsPoint } from "@/data/routes/types";
import type { LayaState, Position, StateObject } from "@shared/state";
import { type DetFrame, type Detections, frameAt } from "../data";
import { type LatLon, bearing, haversine, round1 } from "../geo";
import { nextManeuver } from "../route/maneuver";
import { type ProgressTable, type RoutePlan, snapAtTime } from "../route/plan";

export const MAX_OBJECTS = 6;
export const APPROACH_WINDOW_S = 1.0;
export const APPROACH_MIN_M = 0.3;
const MIN_HEADING_BASE_M = 2.0;

export interface StateContext {
  route: GpsPoint[];
  plan: RoutePlan;
  /** buildProgress(plan, route) */
  progress: ProgressTable;
  crossings: Crossing[];
  det: Detections;
  /** [t, deg] heading samples (compass + camera yaw, scripts/preprocess/heading.py); GPS course if empty */
  heading?: [number, number][];
}

/** index i such that route[i].t <= t < route[i+1].t (clamped) */
export function segmentIndex(route: GpsPoint[], t: number): number {
  if (t <= route[0].t) return 0;
  for (let i = 0; i < route.length - 1; i++) if (t < route[i + 1].t) return i;
  return route.length - 2;
}

/** GPS is 1 Hz: linear interpolation at playback time t. */
export function positionAt(route: GpsPoint[], t: number): LatLon & { accuracyM: number } {
  const i = segmentIndex(route, t);
  const a = route[i];
  const b = route[i + 1];
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t || 1)));
  return {
    lat: a.lat + (b.lat - a.lat) * u,
    lon: a.lon + (b.lon - a.lon) * u,
    accuracyM: a.accuracyM + (b.accuracyM - a.accuracyM) * u,
  };
}

/** latest fix at or before t */
export function latestFixIndex(route: GpsPoint[], t: number): number {
  let i = 0;
  while (i < route.length - 1 && route[i + 1].t <= t) i++;
  return i;
}

/** speed of each GPS segment, haversine / dt */
export function segmentSpeeds(route: GpsPoint[]): number[] {
  return route.slice(0, -1).map((a, i) => haversine(a, route[i + 1]) / Math.max(route[i + 1].t - a.t, 1e-3));
}

/** 3-point moving average of segment speeds around t */
export function speedAt(route: GpsPoint[], t: number, speeds = segmentSpeeds(route)): number {
  const i = segmentIndex(route, t);
  const win = [i - 1, i, i + 1].filter((k) => k >= 0 && k < speeds.length);
  return win.reduce((s, k) => s + speeds[k], 0) / win.length;
}

/**
 * Bearing previous -> current GPS fix. "Previous" is the latest earlier fix at least
 * MIN_HEADING_BASE_M away: 1 Hz fixes quantized to 1e-6 deg (~0.1 m) give meaningless bearings
 * (often exactly 0 or 90) over shorter baselines, and while standing still the heading is held.
 */
export function headingAt(route: GpsPoint[], t: number): number {
  for (let c = latestFixIndex(route, t); c > 0; c--) {
    for (let j = c - 1; j >= 0; j--) {
      if (haversine(route[j], route[c]) >= MIN_HEADING_BASE_M) return bearing(route[j], route[c]);
    }
  }
  for (let c = 1; c < route.length; c++) {
    if (haversine(route[0], route[c]) >= MIN_HEADING_BASE_M) return bearing(route[0], route[c]);
  }
  return 0;
}

/** Circular interpolation of a [t, deg] heading series (handles the 359 -> 0 wrap). */
export function fusedHeadingAt(series: [number, number][], t: number): number {
  if (t <= series[0][0]) return series[0][1];
  const last = series[series.length - 1];
  if (t >= last[0]) return last[1];
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, a] = series[lo];
  const [t1, b] = series[hi];
  const u = (t - t0) / (t1 - t0 || 1);
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * u) % 360) + 360) % 360;
}

/** Robot heading at t: fused IMU/camera heading when available, else GPS course. */
export function robotHeadingAt(ctx: Pick<StateContext, "route" | "heading">, t: number): number {
  return ctx.heading?.length ? fusedHeadingAt(ctx.heading, t) : headingAt(ctx.route, t);
}

export function positionOf(bbox: [number, number, number, number], width: number): Position {
  const cx = (bbox[0] + bbox[2]) / 2;
  if (cx < width / 3) return "left";
  if (cx > (2 * width) / 3) return "right";
  return "center";
}

export function isApproaching(det: Detections, t: number, id: number, distM: number): boolean {
  if (id < 0 || t < APPROACH_WINDOW_S - 1e-6) return false;
  const prev = frameAt(det, t - APPROACH_WINDOW_S).objects.find((o) => o.id === id);
  return prev ? prev.distM - distM > APPROACH_MIN_M : false;
}

export function stateObjects(det: Detections, frame: DetFrame, t: number): StateObject[] {
  return [...frame.objects]
    .sort((a, b) => a.distM - b.distM)
    .slice(0, MAX_OBJECTS)
    .map((o) => ({
      type: o.cls,
      position: positionOf(o.bbox, det.width),
      dist_m: round1(o.distM),
      approaching: isApproaching(det, t, o.id, o.distM),
      conf: round1(o.conf),
    }));
}

export function inCrossing(crossings: Crossing[], t: number): boolean {
  return crossings.some((c) => t >= c.tStart && t <= c.tEnd);
}

export function buildState(t: number, ctx: StateContext): LayaState {
  const pos = positionAt(ctx.route, t);
  const snap = snapAtTime(ctx.plan, ctx.progress, t);
  const nav = nextManeuver(ctx.plan, snap);
  const frame = frameAt(ctx.det, t);
  return {
    robot: { speed_mps: round1(speedAt(ctx.route, t)), heading_deg: round1(robotHeadingAt(ctx, t)) },
    route: {
      next_maneuver: nav.maneuver,
      dist_to_maneuver_m: round1(nav.distM),
      crossing_now: inCrossing(ctx.crossings, t),
      off_route_m: round1(snap.offset),
    },
    gps: { accuracy_m: round1(pos.accuracyM) },
    free_space: frame.freeSpace ?? { left: "open", center: "open", right: "open" },
    objects: stateObjects(ctx.det, frame, t),
  };
}
