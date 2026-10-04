// Hard safety layer: runs on every frame straight from the detector output, independent of Laya
// (on the rover it would run at the Hailo detection rate).
import type { DetFrame } from "./data";
import { positionOf } from "./state/buildState";

export const SAFETY_CENTER_M = 1.0;

export interface SafetyResult {
  stop: boolean;
  reason: string | null;
}

export function safetyCheck(frame: DetFrame, width: number): SafetyResult {
  const close = frame.objects.find((o) => positionOf(o.bbox, width) === "center" && o.distM < SAFETY_CENTER_M);
  if (close) return { stop: true, reason: `중앙 ${close.distM.toFixed(1)}m 이내 ${close.cls} (추정)` };
  if (frame.freeSpace?.center === "blocked") return { stop: true, reason: "중앙 여유 공간 막힘" };
  return { stop: false, reason: null };
}
