"use client";
// Top-left: original front video (master clock) + overlay.
import type { FinalCommand } from "@/lib/arbiter";
import type { CameraParams } from "@/lib/projection";
import type { NavInstruction } from "@/lib/route/maneuver";
import type { Ref } from "react";
import { OverlayCanvas, type OverlayToggles, type RibbonPx } from "./OverlayCanvas";
import { Toggle, videoBoxStyle } from "./ui";


export function VideoPanel({
  videoRef,
  src,
  width,
  height,
  toggles,
  setToggles,
  future,
  past,
  ribbon,
  nav,
  speedMps,
  command,
  cam,
  setCam,
  dev,
}: {
  videoRef: Ref<HTMLVideoElement>;
  src: string;
  width: number;
  height: number;
  toggles: OverlayToggles;
  setToggles: (t: OverlayToggles) => void;
  future: { u: number; v: number }[][];
  past: { u: number; v: number }[][];
  ribbon: RibbonPx | null;
  nav: NavInstruction;
  speedMps: number;
  command: FinalCommand;
  cam: CameraParams & { yawDeg: number };
  setCam: (c: CameraParams & { yawDeg: number }) => void;
  dev: boolean;
}) {
  return (
    <section className="panel flex min-h-0 flex-col">
      <div className="panel-title">
        원본 영상 <span className="text-[11px] font-normal text-slate-400">전방 카메라 1024×576 · 20fps · 마스터 클락</span>
        <div className="ml-auto flex gap-3">
          <Toggle label="Laya 주행도" checked={toggles.laya} onChange={(v) => setToggles({ ...toggles, laya: v })} />
          <Toggle label="GPS 경로" checked={toggles.gps} onChange={(v) => setToggles({ ...toggles, gps: v })} />
          <Toggle label="내비" checked={toggles.nav} onChange={(v) => setToggles({ ...toggles, nav: v })} />
          <Toggle label="속도" checked={toggles.speed} onChange={(v) => setToggles({ ...toggles, speed: v })} />
          <Toggle label="명령" checked={toggles.command} onChange={(v) => setToggles({ ...toggles, command: v })} />
        </div>
      </div>
      <div className="relative overflow-hidden rounded bg-black" style={videoBoxStyle(width, height)}>
        <video ref={videoRef} src={src} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" />
        <OverlayCanvas
          width={width}
          height={height}
          toggles={toggles}
          future={future}
          past={past}
          ribbon={ribbon}
          nav={nav}
          speedMps={speedMps}
          command={command}
        />
      </div>
      {dev && (
        <div className="mt-1.5 grid grid-cols-4 gap-2 rounded bg-black/30 p-1.5 text-[11px] text-slate-300">
          <span className="col-span-4 text-[10px] text-amber-300">dev: 경로 투영 파라미터 (src/config/rover.json 기본값)</span>
          {(
            [
              ["heightM", "카메라 높이 m", 0.1, 1.5, 0.05],
              ["pitchDeg", "피치 °", -30, 15, 0.5],
              ["hfovDeg", "HFOV °", 60, 140, 1],
              ["yawDeg", "요 보정 °", -30, 30, 0.5],
            ] as const
          ).map(([k, label, min, max, step]) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span>
                {label}: <b className="font-mono">{cam[k]}</b>
              </span>
              <input type="range" min={min} max={max} step={step} value={cam[k]} onChange={(e) => setCam({ ...cam, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
