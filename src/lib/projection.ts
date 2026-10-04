// Project GPS route points onto the front camera image: flat ground + pinhole camera.
import { type LatLon, toEN } from "./geo";

export interface CameraParams {
  heightM: number;
  /** negative = looking down */
  pitchDeg: number;
  hfovDeg: number;
  width: number;
  height: number;
}

/** camera frame: x right, y down, z forward (metres) */
export interface CamPoint {
  x: number;
  y: number;
  z: number;
}

export const NEAR_Z = 0.3;

/** Ground point given in robot-local metres (forward, right) -> camera frame. */
export function groundToCamera(forward: number, right: number, cam: CameraParams): CamPoint {
  const a = (-cam.pitchDeg * Math.PI) / 180; // positive when looking down
  const h = cam.heightM; // ground is h below the camera
  return {
    x: right,
    y: h * Math.cos(a) - forward * Math.sin(a),
    z: forward * Math.cos(a) + h * Math.sin(a),
  };
}

export function focalPx(cam: CameraParams): number {
  return cam.width / 2 / Math.tan((cam.hfovDeg * Math.PI) / 360);
}

export function cameraToImage(p: CamPoint, cam: CameraParams): { u: number; v: number } {
  const f = focalPx(cam);
  return { u: cam.width / 2 + (f * p.x) / p.z, v: cam.height / 2 + (f * p.y) / p.z };
}

/** Distance to the nearest ground point visible at the bottom image row (flat ground). */
export function nearestVisibleGroundM(cam: CameraParams): number {
  // bottom-row ray angle below the optical axis, minus upward pitch
  const below = Math.atan(cam.height / 2 / focalPx(cam)) - (cam.pitchDeg * Math.PI) / 180;
  return below > 1e-3 ? cam.heightM / Math.tan(below) : Infinity;
}

/** World point -> robot-local (forward, right) metres given robot position and heading (deg from north). */
export function worldToRobot(robot: LatLon, headingDeg: number, p: LatLon): { forward: number; right: number } {
  const { e, n } = toEN(robot, p);
  const h = (headingDeg * Math.PI) / 180;
  return { forward: e * Math.sin(h) + n * Math.cos(h), right: e * Math.cos(h) - n * Math.sin(h) };
}

/**
 * Project a ground polyline. Segments crossing the near plane are clipped in 3D so lines that pass
 * behind the camera do not wrap around. Returns pixel polylines (one per visible run).
 */
export function projectPolyline(
  pts: LatLon[],
  robot: LatLon,
  headingDeg: number,
  cam: CameraParams,
): { u: number; v: number }[][] {
  const cp = pts.map((p) => {
    const r = worldToRobot(robot, headingDeg, p);
    return groundToCamera(r.forward, r.right, cam);
  });
  const runs: { u: number; v: number }[][] = [];
  let cur: { u: number; v: number }[] = [];
  const lerp = (a: CamPoint, b: CamPoint, s: number): CamPoint => ({
    x: a.x + (b.x - a.x) * s,
    y: a.y + (b.y - a.y) * s,
    z: a.z + (b.z - a.z) * s,
  });
  for (let i = 0; i < cp.length; i++) {
    const p = cp[i];
    const prev = i > 0 ? cp[i - 1] : null;
    const inFront = p.z >= NEAR_Z;
    if (prev && (prev.z >= NEAR_Z) !== inFront) {
      const s = (NEAR_Z - prev.z) / (p.z - prev.z);
      cur.push(cameraToImage(lerp(prev, p, s), cam));
      if (!inFront) {
        runs.push(cur);
        cur = [];
      }
    }
    if (inFront) cur.push(cameraToImage(p, cam));
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}
