"use client";
// Bottom-left: object detection on the original video (canvas, toggleable): bbox, class, track id,
// estimated distance, plus the free-space zones of the bottom third.
import type { DetFrame } from "@/lib/data";
import { positionOf } from "@/lib/state/buildState";
import { type Ref, useEffect, useRef, useState } from "react";
import { Badge, Toggle, videoBoxStyle } from "./ui";

const CLASS_COLOR: Record<string, string> = {
  person: "#f43f5e",
  bicycle: "#f59e0b",
  motorcycle: "#f97316",
  car: "#38bdf8",
  bus: "#818cf8",
  truck: "#a78bfa",
  dog: "#fb7185",
};
const ZONE_COLOR = { open: "rgba(52,211,153,0.18)", partial: "rgba(250,204,21,0.28)", blocked: "rgba(244,63,94,0.38)" };
const ZONE_KO = { open: "열림", partial: "일부", blocked: "막힘" };
const POS_KO = { left: "좌", center: "중", right: "우" };
/** ByteTrack leaves new, unconfirmed detections without a track id (-1 in detections.json) */
const trackLabel = (id: number) => (id >= 0 ? `#${id}` : "#?");

export function DetectionPanel({
  videoRef,
  src,
  width,
  height,
  frame,
}: {
  videoRef: Ref<HTMLVideoElement>;
  src: string;
  width: number;
  height: number;
  frame: DetFrame;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState({ boxes: true, zones: true });

  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, width, height);
    if (show.zones && frame.freeSpace) {
      const zs = [frame.freeSpace.left, frame.freeSpace.center, frame.freeSpace.right];
      zs.forEach((z, i) => {
        g.fillStyle = ZONE_COLOR[z];
        g.fillRect((i * width) / 3, (height * 2) / 3, width / 3, height / 3);
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.font = "bold 18px sans-serif";
        g.fillText(ZONE_KO[z], (i * width) / 3 + 8, height - 10);
      });
    }
    if (!show.boxes) return;
    for (const o of frame.objects) {
      const [x1, y1, x2, y2] = o.bbox;
      const col = CLASS_COLOR[o.cls] ?? "#e2e8f0";
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const label = `${o.cls} ${trackLabel(o.id)} · ~${o.distM.toFixed(1)}m 추정`;
      g.font = "bold 15px sans-serif";
      const w = g.measureText(label).width + 8;
      const ly = y1 > 22 ? y1 - 20 : y1 + 2;
      g.fillStyle = col;
      g.fillRect(x1, ly, w, 19);
      g.fillStyle = "#0b0f14";
      g.fillText(label, x1 + 4, ly + 15);
    }
  }, [frame, width, height, show]);

  const closest = [...frame.objects].sort((a, b) => a.distM - b.distM).slice(0, 4);
  return (
    <section className="panel flex min-h-0 flex-col">
      <div className="panel-title">
        객체 인식 <Badge color="#0f766e">YOLO11n · 640 · ByteTrack</Badge>
        <div className="ml-auto flex gap-3">
          <Toggle label="박스" checked={show.boxes} onChange={(v) => setShow({ ...show, boxes: v })} />
          <Toggle label="여유 공간" checked={show.zones} onChange={(v) => setShow({ ...show, zones: v })} />
        </div>
      </div>
      <div className="relative overflow-hidden rounded bg-black" style={videoBoxStyle(width, height)}>
        <video ref={videoRef} src={src} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" />
        <canvas ref={ref} width={width} height={height} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>객체 {frame.objects.length}개</span>
        {closest.map((o, i) => (
          // id is -1 for boxes ByteTrack has not confirmed yet, so it is not unique on its own
          <span key={`${i}-${o.id}-${o.cls}`}>
            {o.cls}
            {trackLabel(o.id)} {POS_KO[positionOf(o.bbox, width)]} ~{o.distM.toFixed(1)}m
          </span>
        ))}
        <span className="ml-auto text-slate-500">거리는 핀홀/지면 가정 추정치 (측정값 아님)</span>
      </div>
    </section>
  );
}
