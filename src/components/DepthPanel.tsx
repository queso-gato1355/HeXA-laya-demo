"use client";
// Top-right: depth heatmap video(s) + legend. Near = blue, far = red (the reverse of the usual
// convention). Relative depth has no metric scale, so the legend shows ranks, not metres.
import type { ClipMeta } from "@/lib/data";
import type { Ref } from "react";
import { Badge, TURBO_GRADIENT, Toggle, videoBoxStyle } from "./ui";

function Legend({ metric, nearM, farM }: { metric: boolean; nearM: number | null; farM: number | null }) {
  const ticks = metric && nearM !== null && farM !== null ? [`${nearM}m`, `${((nearM + farM) / 2).toFixed(1)}m`, `${farM}m`] : ["p2", "중간", "p98"];
  return (
    <div className="mt-1.5">
      <div className="h-2.5 rounded" style={{ background: TURBO_GRADIENT }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
        <span>가까움 (파랑) · {ticks[0]}</span>
        <span>{ticks[1]}</span>
        <span>{ticks[2]} · 멀리 (빨강)</span>
      </div>
      {!metric && <div className="text-[10px] text-slate-500">상대 깊이: 미터 눈금 없음 · 클립 전체 2–98 퍼센타일 고정 정규화 (프레임별 정규화 안 함)</div>}
    </div>
  );
}

export function DepthPanel({
  meta,
  base,
  depthRef,
  compareRef,
  compare,
  setCompare,
}: {
  meta: ClipMeta;
  base: string;
  depthRef: Ref<HTMLVideoElement>;
  compareRef: Ref<HTMLVideoElement>;
  compare: boolean;
  setCompare: (v: boolean) => void;
}) {
  const cmp = meta.comparison;
  const aspect = `${meta.width} / ${meta.height}`;
  return (
    <section className="panel flex min-h-0 flex-col">
      <div className="panel-title">
        깊이 히트맵
        <Badge color="#0f766e">SCDepthV3 · 256×320 · {meta.hz}Hz</Badge>
        <span className="text-[10px] font-normal text-emerald-400">Hailo-8 배포 가능</span>
        {cmp && (
          <div className="ml-auto">
            <Toggle label="비교 모드 (DA-V2)" checked={compare} onChange={setCompare} />
          </div>
        )}
      </div>
      <div className={compare && cmp ? "grid grid-cols-2 gap-1.5" : ""}>
        <div className="relative overflow-hidden rounded bg-black" style={compare && cmp ? { aspectRatio: aspect } : videoBoxStyle(meta.width, meta.height)}>
          <video ref={depthRef} src={`${base}/${meta.video}`} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" />
        </div>
        {compare && cmp && (
          <div className="relative overflow-hidden rounded bg-black" style={compare && cmp ? { aspectRatio: aspect } : videoBoxStyle(meta.width, meta.height)}>
            <video ref={compareRef} src={`${base}/${cmp.video}`} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" />
            <div className="absolute left-1 top-1 flex gap-1">
              <Badge color="#be123c">배포 불가</Badge>
              <Badge color="#334155">Depth Anything V2 Small · {cmp.hz}Hz</Badge>
            </div>
          </div>
        )}
      </div>
      <Legend metric={meta.depthMode === "metric"} nearM={meta.nearM} farM={meta.farM} />
    </section>
  );
}
