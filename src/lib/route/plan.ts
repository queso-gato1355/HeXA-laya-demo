// Planned route = the recorded GPS track simplified with Ramer-Douglas-Peucker. The raw (interpolated)
// GPS position then deviates from it by a realistic cross-track error (off_route_m), and the
// simplified vertices are clean junction points for maneuver detection.
import type { GpsPoint } from "@/data/routes/types";
import { type LatLon, angDiff, bearing, haversine, toEN } from "../geo";

export interface RoutePlan {
  origin: LatLon;
  /** simplified waypoints */
  points: LatLon[];
  /** local metres of each waypoint relative to origin */
  en: { e: number; n: number }[];
  /** cumulative distance along the plan at each waypoint */
  cum: number[];
  /** bearing of segment i (points[i] -> points[i+1]) */
  segBearing: number[];
  length: number;
}

export interface Snap {
  seg: number;
  /** distance along the plan, metres */
  along: number;
  /** perpendicular distance to the plan, metres */
  offset: number;
}

function rdp(pts: { e: number; n: number }[], eps: number): number[] {
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegDist(pts[i], pts[a], pts[b]).dist;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([a, best], [best, b]);
    }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
}

export function pointSegDist(p: { e: number; n: number }, a: { e: number; n: number }, b: { e: number; n: number }) {
  const dx = b.e - a.e;
  const dy = b.n - a.n;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy) / len2)) : 0;
  const x = a.e + u * dx;
  const y = a.n + u * dy;
  return { dist: Math.hypot(p.e - x, p.n - y), u };
}

export function buildPlan(route: GpsPoint[], epsM = 1.5): RoutePlan {
  const origin = { lat: route[0].lat, lon: route[0].lon };
  const allEn = route.map((p) => toEN(origin, p));
  const idx = rdp(allEn, epsM);
  const points = idx.map((i) => ({ lat: route[i].lat, lon: route[i].lon }));
  const en = idx.map((i) => allEn[i]);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  const segBearing = points.slice(0, -1).map((p, i) => bearing(p, points[i + 1]));
  return { origin, points, en, cum, segBearing, length: cum[cum.length - 1] };
}

export function snapToPlan(plan: RoutePlan, pos: LatLon, hintSeg = 0): Snap {
  const p = toEN(plan.origin, pos);
  let best: Snap = { seg: 0, along: 0, offset: Infinity };
  for (let i = 0; i < plan.points.length - 1; i++) {
    const { dist, u } = pointSegDist(p, plan.en[i], plan.en[i + 1]);
    // prefer segments at/after the hint when distances tie (the route can pass near itself)
    const score = dist + (i < hintSeg ? 0.5 : 0);
    const bestScore = best.offset + (best.seg < hintSeg ? 0.5 : 0);
    if (score < bestScore) {
      best = { seg: i, along: plan.cum[i] + u * (plan.cum[i + 1] - plan.cum[i]), offset: dist };
    }
  }
  return best;
}

export interface ProgressTable {
  t: number[];
  along: number[];
  offset: number[];
}

/**
 * Snap every GPS fix in time order, never moving backwards along the plan. A robot that stands still
 * at a junction (GPS jitter) would otherwise flip between the segments before and after the corner.
 */
export function buildProgress(plan: RoutePlan, route: GpsPoint[]): ProgressTable {
  const out: ProgressTable = { t: [], along: [], offset: [] };
  let seg = 0;
  let along = 0;
  for (const p of route) {
    const en = toEN(plan.origin, p);
    let best = { seg, along, offset: Infinity };
    // look at the current segment and the next two only
    for (let i = seg; i < Math.min(seg + 3, plan.points.length - 1); i++) {
      const { dist, u } = pointSegDist(en, plan.en[i], plan.en[i + 1]);
      if (dist < best.offset - 0.25) best = { seg: i, along: plan.cum[i] + u * (plan.cum[i + 1] - plan.cum[i]), offset: dist };
    }
    seg = best.seg;
    along = Math.max(along, best.along);
    out.t.push(p.t);
    out.along.push(along);
    out.offset.push(best.offset);
  }
  return out;
}

/** Snap at playback time t from the progress table (linear interpolation between fixes). */
export function snapAtTime(plan: RoutePlan, table: ProgressTable, t: number): Snap {
  const n = table.t.length;
  let i = 0;
  while (i < n - 2 && t >= table.t[i + 1]) i++;
  const u = Math.max(0, Math.min(1, (t - table.t[i]) / (table.t[i + 1] - table.t[i] || 1)));
  const along = table.along[i] + (table.along[i + 1] - table.along[i]) * u;
  const offset = table.offset[i] + (table.offset[i + 1] - table.offset[i]) * u;
  let seg = 0;
  while (seg < plan.points.length - 2 && along >= plan.cum[seg + 1]) seg++;
  return { seg, along, offset };
}

/** Point on the plan at a distance along it (clamped to the ends). */
export function pointAtAlong(plan: RoutePlan, along: number): LatLon {
  const a = Math.max(0, Math.min(plan.length, along));
  let i = 0;
  while (i < plan.points.length - 2 && a > plan.cum[i + 1]) i++;
  const seg = plan.cum[i + 1] - plan.cum[i] || 1;
  const u = (a - plan.cum[i]) / seg;
  const p = plan.points[i];
  const q = plan.points[i + 1];
  return { lat: p.lat + (q.lat - p.lat) * u, lon: p.lon + (q.lon - p.lon) * u };
}

/** Plan polyline between two along-distances, with interpolated end points. */
export function planSlice(plan: RoutePlan, from: number, to: number): LatLon[] {
  const a = Math.max(0, Math.min(plan.length, from));
  const b = Math.max(0, Math.min(plan.length, to));
  const out = [pointAtAlong(plan, a)];
  for (let i = 0; i < plan.points.length; i++) if (plan.cum[i] > a && plan.cum[i] < b) out.push(plan.points[i]);
  out.push(pointAtAlong(plan, b));
  return out;
}

/** Signed heading change at vertex i (between segment i-1 and i). */
export function turnAt(plan: RoutePlan, i: number): number {
  if (i <= 0 || i >= plan.segBearing.length) return 0;
  return angDiff(plan.segBearing[i - 1], plan.segBearing[i]);
}
