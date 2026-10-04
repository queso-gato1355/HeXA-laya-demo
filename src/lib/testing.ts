// Test fixtures: synthetic routes/detections in local metres.
import type { GpsPoint } from "@/data/routes/types";
import type { DetFrame, DetObject, Detections } from "./data";
import { fromEN } from "./geo";

export const ORIGIN = { lat: 37.5, lon: 127.0 };

/** points every `dt` seconds along a path of (east, north) metre vertices at constant speed */
export function routeFromPath(vertices: [number, number][], speed: number, dt = 1, accuracyM = 4): GpsPoint[] {
  const out: GpsPoint[] = [];
  let t = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const [e0, n0] = vertices[i];
    const [e1, n1] = vertices[i + 1];
    const len = Math.hypot(e1 - e0, n1 - n0);
    const steps = Math.max(1, Math.round(len / (speed * dt)));
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      out.push({ t: round2(t), ...fromEN(ORIGIN, e0 + (e1 - e0) * u, n0 + (n1 - n0) * u), accuracyM });
      t += (len / steps) / speed;
    }
  }
  const [e, n] = vertices[vertices.length - 1];
  out.push({ t: round2(t), ...fromEN(ORIGIN, e, n), accuracyM });
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function obj(partial: Partial<DetObject> & { bbox: DetObject["bbox"] }): DetObject {
  return { id: 1, cls: "person", conf: 0.83, distM: 5, distSource: "pinhole", ...partial };
}

export function detections(n: number, fps: number, fill: (t: number, i: number) => Partial<DetFrame>): Detections {
  return {
    fps,
    width: 1024,
    height: 576,
    frames: Array.from({ length: n }, (_, i) => {
      const t = i / fps;
      return { t, objects: [], ...fill(t, i) };
    }),
  };
}
