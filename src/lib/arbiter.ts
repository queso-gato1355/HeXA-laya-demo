// Final command arbiter: combines the per-criterion Laya answers with deterministic rules.
// The rule list below is also rendered in the UI, in this order.
import type { SpeedLevel } from "@/config/rover";
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "@shared/laya-types";
import type { Maneuver } from "@shared/state";
import type { SafetyResult } from "./safety";

export type Action = "STOP" | "go_straight" | "turn_left" | "turn_right" | "steer_around" | "yield_wait";
export type RuleId = "safety" | "emergency" | "collision" | "blocked" | "default";

export const STALE_AFTER_S = 1.5;
export const RULES: { id: RuleId; textKo: string }[] = [
  { id: "safety", textKo: "하드 안전: 중앙 1m 이내 객체 또는 중앙 여유 공간 막힘 → 정지 (Laya 무관, 매 프레임)" },
  { id: "emergency", textKo: "emergency_stop ≥ 0.5 → 정지" },
  { id: "collision", textKo: "collision_risk ≥ 3.0 → 정지" },
  { id: "blocked", textKo: "path_blocked ≥ 0.6 → maneuver가 회피면 회피, 아니면 양보 대기" },
  { id: "default", textKo: "그 외 → maneuver + target_speed" },
];
export const STALE_RULE_KO = `결과 나이 > ${STALE_AFTER_S}s 인 기준은 제외하고 속도 상한을 최저속(crawl)으로 낮춤`;

/** criteria the arbiter reads; if any is stale the command is degraded */
export const ARBITER_CRITERIA = ["emergency_stop", "collision_risk", "path_blocked", "maneuver", "target_speed"] as const;

export interface TimedAnswer {
  /** playback time of the state the answer was computed for */
  t: number;
  answer: Answer;
}

export interface FinalCommand {
  action: Action;
  speed: SpeedLevel;
  rule: RuleId;
  reasonKo: string;
  safetyOverride: boolean;
  /** criteria excluded because their result is too old (or missing) */
  stale: string[];
  degraded: boolean;
}

const SPEED_ORDER: SpeedLevel[] = ["stop", "crawl", "slow", "normal"];
const minSpeed = (a: SpeedLevel, b: SpeedLevel) => (SPEED_ORDER.indexOf(a) <= SPEED_ORDER.indexOf(b) ? a : b);

export function resultAge(now: number, r: TimedAnswer | undefined): number {
  return r ? now - r.t : Infinity;
}

/** stale = older than STALE_AFTER_S, missing, or from the future (after a backwards seek) */
export function isStale(now: number, r: TimedAnswer | undefined): boolean {
  const age = resultAge(now, r);
  return !(age <= STALE_AFTER_S && age >= -0.25);
}

export function navToAction(m: Maneuver): Action {
  if (m === "turn_left" || m === "slight_left" || m === "u_turn") return "turn_left";
  if (m === "turn_right" || m === "slight_right") return "turn_right";
  if (m === "arrived") return "STOP";
  return "go_straight";
}

const CHOICE_TO_ACTION: Record<string, Action> = {
  go_straight: "go_straight",
  turn_left: "turn_left",
  turn_right: "turn_right",
  steer_around: "steer_around",
  yield_wait: "yield_wait",
  stop: "STOP",
};

export function arbitrate(input: {
  now: number;
  results: Partial<Record<string, TimedAnswer>>;
  safety: SafetyResult;
  nav: Maneuver;
}): FinalCommand {
  const { now, results, safety, nav } = input;
  const stale = ARBITER_CRITERIA.filter((c) => isStale(now, results[c]));
  const fresh = <A extends Answer>(c: string) => (isStale(now, results[c]) ? undefined : (results[c]?.answer as A | undefined));
  const degraded = stale.length > 0;
  const base = { stale, degraded };

  if (safety.stop) {
    return { ...base, action: "STOP", speed: "stop", rule: "safety", reasonKo: safety.reason ?? "안전 규칙", safetyOverride: true };
  }
  const es = fresh<NoulAnswer>("emergency_stop");
  if (es && es.noul >= 0.5) {
    return { ...base, action: "STOP", speed: "stop", rule: "emergency", reasonKo: `비상 정지 ${es.noul.toFixed(2)}`, safetyOverride: false };
  }
  const cr = fresh<ScoreAnswer>("collision_risk");
  if (cr && cr.score >= 3.0) {
    return { ...base, action: "STOP", speed: "stop", rule: "collision", reasonKo: `충돌 위험 ${cr.score.toFixed(2)}`, safetyOverride: false };
  }

  const man = fresh<ChoiceAnswer>("maneuver");
  const ts = fresh<ChoiceAnswer>("target_speed");
  let speed: SpeedLevel = ts && SPEED_ORDER.includes(ts.choice as SpeedLevel) ? (ts.choice as SpeedLevel) : "crawl";
  if (degraded) speed = minSpeed(speed, "crawl");

  const pb = fresh<NoulAnswer>("path_blocked");
  if (pb && pb.noul >= 0.6) {
    const action: Action = man?.choice === "steer_around" ? "steer_around" : "yield_wait";
    return {
      ...base,
      action,
      speed: action === "yield_wait" ? "stop" : minSpeed(speed, "slow"),
      rule: "blocked",
      reasonKo: `경로 막힘 ${pb.noul.toFixed(2)}`,
      safetyOverride: false,
    };
  }

  const action = man ? CHOICE_TO_ACTION[man.choice] ?? navToAction(nav) : navToAction(nav);
  if (action === "STOP" || action === "yield_wait") speed = "stop";
  return {
    ...base,
    action,
    speed,
    rule: "default",
    reasonKo: man ? `Laya 기동 판단` : `내비 지시 사용 (Laya 기동 결과 없음)`,
    safetyOverride: false,
  };
}

export const ACTION_KO: Record<Action, string> = {
  STOP: "정지",
  go_straight: "직진",
  turn_left: "좌회전",
  turn_right: "우회전",
  steer_around: "회피",
  yield_wait: "양보 대기",
};
