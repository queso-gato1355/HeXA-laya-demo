"use client";
import piProfile from "@shared/pi-profile.json";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROVER } from "@/config/rover";
import { getClip } from "@/data/routes";
import { type FinalCommand, arbitrate, type TimedAnswer } from "@/lib/arbiter";
import { type ClipData, frameAt, loadClip } from "@/lib/data";
import { plannedPath, ribbonEdges } from "@/lib/plannedPath";
import { type CameraParams, NEAR_Z, cameraToImage, groundToCamera, nearestVisibleGroundM, projectPolyline } from "@/lib/projection";
import { nextManeuver } from "@/lib/route/maneuver";
import { buildPlan, buildProgress, planSlice, pointAtAlong, snapAtTime } from "@/lib/route/plan";
import { safetyCheck } from "@/lib/safety";
import { buildState, positionAt, robotHeadingAt, speedAt } from "@/lib/state/buildState";
import { attachSync, onEveryFrame } from "@/lib/sync";
import { type Profile, useDecisions } from "@/lib/useDecisions";
import { useLayaStatus } from "@/lib/useLayaStatus";
import { useSystemMetrics } from "@/lib/useSystemMetrics";
import { DecisionPanel } from "./DecisionPanel";
import { DepthPanel } from "./DepthPanel";
import { DetectionPanel } from "./DetectionPanel";
import { ResourcePanel } from "./ResourcePanel";
import { StatusBar } from "./StatusBar";
import { type TimelineEvent, Timeline } from "./Timeline";
import { VideoPanel } from "./VideoPanel";

const MiniMap = dynamic(() => import("./MiniMap"), { ssr: false, loading: () => <div className="h-full w-full rounded bg-[#0f141b]" /> });

const PI = piProfile as { rates: Record<string, number>; p95Ms: Record<string, number> };
const DEV = process.env.NODE_ENV === "development";
const ROUTE_AHEAD_M = 30;
const ROUTE_BEHIND_M = 10;

export default function Dashboard({ clipId }: { clipId: string }) {
  // the page remounts this component per clip (key = clipId), so these are fixed for its lifetime
  const C = getClip(clipId);
  const [clip, setClip] = useState<ClipData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const status = useLayaStatus();
  const metrics = useSystemMetrics();
  const [profile, setProfile] = useState<Profile>("pc");
  const [compare, setCompare] = useState(false);
  const [toggles, setToggles] = useState({ gps: true, laya: true, nav: true, speed: true, command: true });
  const [camAdj, setCamAdj] = useState({ heightM: ROVER.cameraHeightM, pitchDeg: ROVER.cameraPitchDeg, hfovDeg: ROVER.hfovDeg, yawDeg: 0 });
  const [sideTab, setSideTab] = useState<"map" | "state" | "resource">("map");

  const frontRef = useRef<HTMLVideoElement>(null);
  const detRef = useRef<HTMLVideoElement>(null);
  const depthRef = useRef<HTMLVideoElement>(null);
  const cmpRef = useRef<HTMLVideoElement>(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    loadClip(clipId).then(
      (c) => {
        setClip(c);
        // per-clip calibrated camera (calibrate_camera.py), else the global rover profile
        if (c.camera) setCamAdj((a) => ({ ...a, heightM: c.camera!.cameraHeightM, pitchDeg: c.camera!.cameraPitchDeg, hfovDeg: c.camera!.hfovDeg }));
      },
      (e) => setLoadError(String(e)),
    );
  }, [clipId]);

  const plan = useMemo(() => buildPlan(C.route), [C]);
  const progress = useMemo(() => buildProgress(plan, C.route), [plan, C]);
  const ctx = useMemo(
    () => (clip ? { route: C.route, plan, progress, crossings: C.crossings, det: clip.det, heading: C.heading } : null),
    [clip, plan, progress, C],
  );
  const getT = useCallback(() => tRef.current, []);

  const engine = useDecisions({
    clipId,
    ctx,
    getT,
    playing,
    ready: status.state === "ready",
    profile: status.endpointIsLocal === false ? "pc" : profile,
    decisionHz: status.decisionHz ?? 1,
    piRates: PI.rates,
    piP95: PI.p95Ms,
  });
  const { evaluateNow } = engine;

  // ---------------------------------------------------------------- master clock + sync
  useEffect(() => {
    const master = frontRef.current;
    if (!master || !clip) return;
    const setTime = (mt: number) => {
      tRef.current = mt;
      setT(mt);
    };
    // while paused, the last presented frame's mediaTime can trail currentTime by a few frames, which
    // would make answers computed for currentTime look like they come from the future
    const stopFrame = onEveryFrame(master, (mt) => setTime(master.paused ? master.currentTime : mt));
    const stopSync = attachSync(master, () => [detRef.current, depthRef.current, cmpRef.current].filter((v): v is HTMLVideoElement => !!v));
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setTime(master.currentTime);
      evaluateNow();
    };
    const onSeeked = () => {
      setTime(master.currentTime);
      evaluateNow();
    };
    master.addEventListener("play", onPlay);
    master.addEventListener("pause", onPause);
    master.addEventListener("seeked", onSeeked);
    master.addEventListener("ended", onPause);
    return () => {
      stopFrame();
      stopSync();
      master.removeEventListener("play", onPlay);
      master.removeEventListener("pause", onPause);
      master.removeEventListener("seeked", onSeeked);
      master.removeEventListener("ended", onPause);
    };
  }, [clip, evaluateNow]);

  // the comparison video mounts later; bring it to the master time immediately
  useEffect(() => {
    if (compare && cmpRef.current && frontRef.current) cmpRef.current.currentTime = frontRef.current.currentTime;
  }, [compare]);

  const seek = useCallback((to: number) => {
    const v = frontRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(to, (v.duration || C.durationS) - 0.05));
  }, [C]);
  const toggle = useCallback(() => {
    const v = frontRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const changeRate = useCallback((r: number) => {
    setRate(r);
    if (frontRef.current) frontRef.current.playbackRate = r;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowLeft") seek(tRef.current - 2);
      else if (e.code === "ArrowRight") seek(tRef.current + 2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek]);

  // ---------------------------------------------------------------- per-frame derived values
  const derived = useMemo(() => {
    if (!ctx || !clip) return null;
    const frame = frameAt(clip.det, t);
    const state = buildState(t, ctx);
    const pos = positionAt(C.route, t);
    const heading = robotHeadingAt(ctx, t);
    const nav = nextManeuver(plan, snapAtTime(plan, progress, t));
    const safety = safetyCheck(frame, clip.det.width);
    return { frame, state, pos, heading, nav, safety, speed: speedAt(C.route, t) };
  }, [ctx, clip, t, plan, progress, C]);

  const command: FinalCommand | null = useMemo(() => {
    if (!derived) return null;
    const results: Record<string, TimedAnswer> = {};
    for (const [k, r] of Object.entries(engine.results)) results[k] = { t: r.t, answer: r.response.answer };
    return arbitrate({ now: t, results, safety: derived.safety, nav: derived.nav.maneuver });
  }, [derived, engine.results, t]);

  // route overlay projection (GPS route, fused heading) + planned-path ribbon (robot frame)
  const overlay = useMemo(() => {
    if (!derived || !clip || !command) return { future: [], past: [], ribbon: null };
    const cam: CameraParams = { heightM: camAdj.heightM, pitchDeg: camAdj.pitchDeg, hfovDeg: camAdj.hfovDeg, width: clip.meta.width, height: clip.meta.height };
    const heading = derived.heading + camAdj.yawDeg;
    // map-matched: draw the planned route from the robot's snapped position on it, so the 1-2 m lateral
    // noise of individual 1 Hz fixes right in front of the robot does not swing the line around
    const along = snapAtTime(plan, progress, t).along;
    const origin = pointAtAlong(plan, along);
    const fut = planSlice(plan, along, along + ROUTE_AHEAD_M);
    const past = planSlice(plan, along - ROUTE_BEHIND_M, along);
    const path = plannedPath({
      action: command.action,
      speed: command.speed,
      nav: derived.nav,
      freeSpace: derived.frame.freeSpace,
      minVisibleM: nearestVisibleGroundM(cam),
    });
    const edges = ribbonEdges(path.points, ROVER.widthM);
    const px = (side: typeof edges.left) =>
      side.map((p) => groundToCamera(p.f, p.r, cam)).filter((c) => c.z >= NEAR_Z).map((c) => cameraToImage(c, cam));
    return {
      future: projectPolyline(fut, origin, heading, cam),
      past: projectPolyline(past, origin, heading, cam),
      ribbon: { kind: path.kind, left: px(edges.left), right: px(edges.right) },
    };
  }, [derived, clip, camAdj, t, command, plan, progress]);

  // ---------------------------------------------------------------- timeline events
  const prevCmd = useRef<{ action: string; safety: boolean } | null>(null);
  const pendingSafety = useRef<number | null>(null);
  useEffect(() => {
    if (!command || status.state !== "ready") return;
    const prev = prevCmd.current;
    const add: TimelineEvent[] = [];
    const tt = Math.round(t * 10) / 10;
    if (prev && prev.action !== command.action) add.push({ t: tt, kind: "command", label: command.action });
    if (command.safetyOverride && !prev?.safety) {
      add.push({ t: tt, kind: "safety", label: "하드 안전" });
      pendingSafety.current = t;
    }
    prevCmd.current = { action: command.action, safety: command.safetyOverride };
    // timeline markers accumulate transitions of a time-driven stream; they cannot be derived from
    // the current frame alone, so they are appended here when a transition is observed
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (add.length) setEvents((ev) => dedupe([...ev, ...add]));
  }, [command, t, status.state]);

  // Laya "catching up": first risky Laya answer after a hard-safety stop began
  useEffect(() => {
    const ts = pendingSafety.current;
    if (ts === null) return;
    const risky = (["collision_risk", "emergency_stop", "path_blocked"] as const)
      .map((n) => engine.results[n])
      .filter((r) => r && r.t >= ts - 0.05 && (r.response.display.level ?? 0) >= 2);
    if (risky.length) {
      const at = Math.min(...risky.map((r) => r!.receivedAt));
      setEvents((ev) => dedupe([...ev, { t: Math.round(at * 10) / 10, kind: "laya-late", label: `+${(at - ts).toFixed(1)}s` }]));
      pendingSafety.current = null;
    } else if (tRef.current - ts > 5) {
      pendingSafety.current = null;
    }
  }, [engine.results]);

  // ---------------------------------------------------------------- render
  if (loadError) return <div className="p-6 text-rose-400">클립 데이터를 불러오지 못했습니다: {loadError}</div>;
  if (!clip || !derived || !command) return <div className="p-6 text-slate-400">클립 데이터 로딩 중…</div>;

  const base = `/data/${clipId}`;
  const crossingLines = C.crossings.map((c) => C.route.filter((p) => p.t >= c.tStart && p.t <= c.tEnd));

  return (
    <main className="mx-auto flex min-h-screen max-w-[1920px] flex-col gap-2 p-2">
      <StatusBar status={status} profile={profile} setProfile={setProfile} clipId={clipId} metrics={metrics} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-2">
        <div className="grid min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] grid-rows-[auto_auto] gap-2">
          <VideoPanel
            videoRef={frontRef}
            src={`${base}/front.mp4`}
            width={clip.meta.width}
            height={clip.meta.height}
            toggles={toggles}
            setToggles={setToggles}
            future={overlay.future}
            past={overlay.past}
            ribbon={overlay.ribbon}
            nav={derived.nav}
            speedMps={derived.speed}
            command={command}
            cam={{ ...camAdj, width: clip.meta.width, height: clip.meta.height }}
            setCam={(c) => setCamAdj({ heightM: c.heightM, pitchDeg: c.pitchDeg, hfovDeg: c.hfovDeg, yawDeg: c.yawDeg })}
            dev={DEV}
          />
          <DepthPanel meta={clip.meta} base={base} depthRef={depthRef} compareRef={cmpRef} compare={compare} setCompare={setCompare} />
          <DetectionPanel videoRef={detRef} src={`${base}/front.mp4`} width={clip.meta.width} height={clip.meta.height} frame={derived.frame} />
          <DecisionPanel engine={engine} command={command} state={derived.state} now={t} status={status} profile={status.endpointIsLocal === false ? "pc" : profile} />
        </div>
        <aside className="panel flex min-h-0 flex-col">
          <div className="mb-1.5 flex gap-1 text-[12px]">
            {(
              [
                ["map", "미니맵"],
                ["state", "현재 state"],
                ["resource", "리소스"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setSideTab(k)} className={`rounded px-2 py-0.5 ${sideTab === k ? "bg-sky-600" : "bg-slate-800 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {sideTab === "map" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className="min-h-[320px] flex-1">
                <MiniMap
                  track={C.route}
                  plan={plan.points}
                  crossings={crossingLines}
                  pos={derived.pos}
                  headingDeg={derived.heading}
                  destination={C.destination}
                />
              </div>
              <div className="text-[10px] leading-relaxed text-slate-400">
                <div>회색: GPS 궤적(1Hz) · 파랑 점선: 계획 경로(RDP 단순화) · 주황: 횡단 구간 · 연두: 목적지</div>
                <div>
                  위치 {derived.pos.lat.toFixed(6)}, {derived.pos.lon.toFixed(6)} · 방위 {derived.heading.toFixed(0)}° ({C.headingSource === "gps" ? "GPS" : "나침반+영상 융합"}) · GPS 정확도 {derived.pos.accuracyM}m (가정)
                </div>
                <div>
                  경로 이탈 {derived.state.route.off_route_m}m · 남은 거리 {Math.max(0, plan.length - snapAtTime(plan, progress, t).along).toFixed(0)}m
                </div>
                {process.env.NEXT_PUBLIC_MAP_TILES !== "osm" && <div className="text-slate-500">지도 타일 꺼짐 (오프라인). NEXT_PUBLIC_MAP_TILES=osm 으로 켤 수 있음</div>}
              </div>
            </div>
          ) : sideTab === "resource" ? (
            <ResourcePanel metrics={metrics} />
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto rounded bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-emerald-200">
              {JSON.stringify(derived.state, null, 1)}
            </pre>
          )}
        </aside>
      </div>
      <Timeline
        t={t}
        duration={C.durationS}
        playing={playing}
        rate={rate}
        history={engine.history}
        events={events}
        crossings={C.crossings}
        onSeek={seek}
        onToggle={toggle}
        onRate={changeRate}
      />
      <footer className="px-1 pb-1 text-[10px] leading-relaxed text-slate-500">
        출처·라이선스: 주행 영상/GPS{" "}
        <a className="underline" href="https://huggingface.co/datasets/BitRobot/FrodoBots-2K">
          FrodoBots-2K
        </a>{" "}
        (CC-BY-SA-4.0, FrodoBots Lab) · 결정 모델 Laya (Apache-2.0, Convai Innovations) via @receptron/laya (MIT) · 객체 인식 YOLO11n
        (Ultralytics, AGPL-3.0) · 깊이 SCDepthV3 (Hailo Model Zoo, GPL-3.0) / Depth Anything V2 Small (Apache-2.0, 비교용) ·
        모든 거리·깊이는 단안 영상 기반 추정치 · 시연 전용, 실제 로봇 제어용 아님
      </footer>
    </main>
  );
}

function dedupe(ev: TimelineEvent[]): TimelineEvent[] {
  const m = new Map(ev.map((e) => [`${e.kind}@${e.t}`, e]));
  return [...m.values()].sort((a, b) => a.t - b.t);
}

