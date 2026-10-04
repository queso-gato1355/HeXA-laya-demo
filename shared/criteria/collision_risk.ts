import { defineCriterion, stepLevel } from "./types";

export const collisionRisk = defineCriterion({
  name: "collision_risk",
  labelKo: "충돌 위험",
  question: {
    type: "score",
    instructions: "How likely is the delivery robot to collide with something in the next 3 seconds?",
    criteria: ["none", "low", "moderate", "high", "imminent"],
  },
  optionLabelsKo: { "0": "없음", "1": "낮음", "2": "보통", "3": "높음", "4": "임박" },
  rate: { pcHz: 2, piHz: 2 },
  priority: 1,
  emphasize: true,
  // expected level 0..4; the arbiter stops at >= 3.0
  riskLevel: (a) => stepLevel(a.score, [1.0, 2.0, 3.0]),
});
