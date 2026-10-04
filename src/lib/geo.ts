export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLon, b: LatLon): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a -> b, degrees clockwise from north in [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest difference b - a in (-180, 180]; positive = clockwise (to the right). */
export function angDiff(a: number, b: number): number {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** Local east/north metres of p relative to origin (equirectangular, fine for < 1 km). */
export function toEN(origin: LatLon, p: LatLon): { e: number; n: number } {
  return {
    e: rad(p.lon - origin.lon) * R * Math.cos(rad(origin.lat)),
    n: rad(p.lat - origin.lat) * R,
  };
}

export function fromEN(origin: LatLon, e: number, n: number): LatLon {
  return {
    lat: origin.lat + deg(n / R),
    lon: origin.lon + deg(e / (R * Math.cos(rad(origin.lat)))),
  };
}

export const round1 = (v: number) => Math.round(v * 10) / 10;
