import { defineCriterion, stepLevel } from "./types";

export const pathBlocked = defineCriterion({
  name: "path_blocked",
  labelKo: "전방 경로 막힘",
  question: { type: "noul", instructions: "Is the robot's forward path blocked?" },
  optionLabelsKo: { true: "막힘", false: "열림" },
  rate: { pcHz: 2, piHz: 2 },
  priority: 2,
  emphasize: true,
  // the arbiter switches to steer_around / yield_wait at >= 0.6
  riskLevel: (a) => stepLevel(a.noul, [0.4, 0.6, 0.8]),
});
