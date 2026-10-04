import { defineCriterion, stepLevel } from "./types";

export const pedestrianYield = defineCriterion({
  name: "pedestrian_yield",
  labelKo: "보행자 양보",
  question: { type: "noul", instructions: "Should the robot yield to a pedestrian right now?" },
  optionLabelsKo: { true: "양보", false: "양보 불필요" },
  rate: { pcHz: 1, piHz: 1 },
  priority: 3,
  riskLevel: (a) => stepLevel(a.noul, [0.4, 0.6, 0.85]),
});
