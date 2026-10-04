import type { Answer, AnswerFor, Question } from "../laya-types";
import type { Display, LayaState, RiskLevel } from "../state";

export interface CriterionDef<Q extends Question = Question> {
  /** URL segment and Laya question id */
  name: string;
  labelKo: string;
  /** one question per criterion, one systemOne call per request */
  question: Q;
  /** Korean label per option key (choice keys, score level index as string, "true"/"false" for noul) */
  optionLabelsKo: Record<string, string>;
  /** scheduler rate per profile; pi values come from docs/bench-pi.md */
  rate: { pcHz: number; piHz: number };
  /** 1 = most important; the scheduler drops the highest numbers first when over budget */
  priority: number;
  /** highlight with risk colours in the decision panel */
  emphasize?: boolean;
  /** criterion only makes sense in some states (crossing_safe); otherwise UI shows "해당 없음" */
  appliesTo?: (state: LayaState) => boolean;
  riskLevel: (answer: AnswerFor<Q>) => RiskLevel | null;
}

export function defineCriterion<Q extends Question>(def: CriterionDef<Q>): CriterionDef<Q> {
  return def;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Steps for "higher = worse" probabilities / scores. */
export function stepLevel(v: number, steps: [number, number, number]): RiskLevel {
  if (v >= steps[2]) return 3;
  if (v >= steps[1]) return 2;
  if (v >= steps[0]) return 1;
  return 0;
}

export function toDisplay(def: CriterionDef, answer: Answer): Display {
  const L = def.optionLabelsKo;
  const level = def.riskLevel(answer as never);
  if (answer.type === "choice") {
    const dist = Object.entries(answer.probabilities).map(([key, p]) => ({ key, label: L[key] ?? key, p }));
    const p = answer.probabilities[answer.choice] ?? 0;
    return { text: L[answer.choice] ?? answer.choice, value: p, dist, level };
  }
  if (answer.type === "score") {
    const dist = Object.entries(answer.probabilities).map(([key, p]) => ({ key, label: L[key] ?? answer.legend[key] ?? key, p }));
    const top = Math.min(Math.round(answer.score), dist.length - 1);
    return { text: `${dist[top]?.label ?? ""} (${answer.score.toFixed(2)})`, value: answer.score, dist, level };
  }
  const yes = answer.noul;
  return {
    text: yes >= 0.5 ? `${L.true ?? "예"} ${pct(yes)}` : `${L.false ?? "아니오"} ${pct(1 - yes)}`,
    value: yes,
    dist: [
      { key: "false", label: L.false ?? "아니오", p: Math.round((1 - yes) * 1e4) / 1e4 },
      { key: "true", label: L.true ?? "예", p: yes },
    ],
    level,
  };
}
