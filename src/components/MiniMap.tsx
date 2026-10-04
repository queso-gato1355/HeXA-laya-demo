"use client";
// Minimap. Default: no tiles at all (runtime makes zero non-localhost requests) - just the route and the
// current position. NEXT_PUBLIC_MAP_TILES=osm adds OpenStreetMap tiles.
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { LatLon } from "@/lib/geo";

const TILES = process.env.NEXT_PUBLIC_MAP_TILES === "osm";

function Follow({ pos }: { pos: LatLon }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([pos.lat, pos.lon], { animate: false });
  }, [map, pos.lat, pos.lon]);
  return null;
}

export default function MiniMap(props: {
  track: LatLon[];
  plan: LatLon[];
  crossings: LatLon[][];
  pos: LatLon;
  headingDeg: number;
  destination: LatLon;
}) {
  const { pos, headingDeg } = props;
  const h = (headingDeg * Math.PI) / 180;
  const ahead: LatLon = {
    lat: pos.lat + (Math.cos(h) * 4) / 111320,
    lon: pos.lon + (Math.sin(h) * 4) / (111320 * Math.cos((pos.lat * Math.PI) / 180)),
  };
  return (
    <MapContainer
      center={[pos.lat, pos.lon]}
      zoom={20}
      maxZoom={22}
      zoomControl={false}
      attributionControl={TILES}
      className="h-full w-full rounded"
      style={{ minHeight: 260 }}
    >
      {TILES && (
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" maxNativeZoom={19} maxZoom={22} />
      )}
      <Polyline positions={props.track.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#64748b", weight: 3, opacity: 0.8 }} />
      <Polyline positions={props.plan.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#38bdf8", weight: 2, dashArray: "4 4" }} />
      {props.crossings.map((c, i) => (
        <Polyline key={i} positions={c.map((p) => [p.lat, p.lon])} pathOptions={{ color: "#fb923c", weight: 7, opacity: 0.6 }} />
      ))}
      <CircleMarker center={[props.destination.lat, props.destination.lon]} radius={6} pathOptions={{ color: "#a3e635", fillOpacity: 0.9 }} />
      <Polyline positions={[[pos.lat, pos.lon], [ahead.lat, ahead.lon]]} pathOptions={{ color: "#f8fafc", weight: 3 }} />
      <CircleMarker center={[pos.lat, pos.lon]} radius={7} pathOptions={{ color: "#f8fafc", fillColor: "#0ea5e9", fillOpacity: 1, weight: 2 }} />
      <Follow pos={pos} />
    </MapContainer>
  );
}
