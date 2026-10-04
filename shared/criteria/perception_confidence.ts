import { defineCriterion } from "./types";

export const perceptionConfidence = defineCriterion({
  name: "perception_confidence",
  labelKo: "인식 신뢰도",
  question: {
    type: "score",
    instructions: "How trustworthy is the robot's current perception of its surroundings?",
    criteria: ["very low", "low", "medium", "high"],
  },
  optionLabelsKo: { "0": "매우 낮음", "1": "낮음", "2": "보통", "3": "높음" },
  rate: { pcHz: 0.2, piHz: 0.2 },
  priority: 5,
  // low confidence = higher risk
  riskLevel: (a) => (a.score < 1 ? 3 : a.score < 1.5 ? 2 : a.score < 2 ? 1 : 0),
});
