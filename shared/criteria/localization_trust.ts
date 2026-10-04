import { defineCriterion } from "./types";

export const localizationTrust = defineCriterion({
  name: "localization_trust",
  labelKo: "위치 신뢰도",
  question: {
    type: "score",
    instructions: "How reliable is the robot's current position estimate?",
    criteria: ["unreliable", "weak", "acceptable", "good"],
  },
  optionLabelsKo: { "0": "신뢰 불가", "1": "약함", "2": "양호", "3": "좋음" },
  rate: { pcHz: 0.1, piHz: 0.1 },
  priority: 6,
  // low trust = higher risk
  riskLevel: (a) => (a.score < 1 ? 3 : a.score < 1.5 ? 2 : a.score < 2 ? 1 : 0),
});
