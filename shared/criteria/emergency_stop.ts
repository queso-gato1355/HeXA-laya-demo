import { defineCriterion, stepLevel } from "./types";

export const emergencyStop = defineCriterion({
  name: "emergency_stop",
  labelKo: "비상 정지",
  question: { type: "noul", instructions: "Must the robot perform an emergency stop immediately?" },
  optionLabelsKo: { true: "정지 필요", false: "불필요" },
  rate: { pcHz: 2, piHz: 2 },
  priority: 1,
  emphasize: true,
  // the arbiter stops at >= 0.5
  riskLevel: (a) => stepLevel(a.noul, [0.3, 0.5, 0.7]),
});
