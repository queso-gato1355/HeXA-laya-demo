import { defineCriterion, stepLevel } from "./types";

export const crossingSafe = defineCriterion({
  name: "crossing_safe",
  labelKo: "횡단 안전",
  question: { type: "noul", instructions: "Is it safe for the robot to cross the road now?" },
  optionLabelsKo: { true: "안전", false: "위험" },
  rate: { pcHz: 1, piHz: 1 },
  priority: 2,
  emphasize: true,
  // only asked inside a labelled crossing; otherwise the card shows "해당 없음"
  appliesTo: (s) => s.route.crossing_now,
  riskLevel: (a) => stepLevel(1 - a.noul, [0.3, 0.5, 0.7]),
});
