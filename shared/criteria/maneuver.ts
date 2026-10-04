import { defineCriterion } from "./types";

export const maneuver = defineCriterion({
  name: "maneuver",
  labelKo: "기동",
  question: {
    type: "choice",
    instructions: "Which maneuver should the sidewalk delivery robot perform now?",
    criteria: {
      go_straight: "continue forward along the route",
      turn_left: "turn left at the upcoming junction",
      turn_right: "turn right at the upcoming junction",
      steer_around: "make a small detour around an obstacle",
      yield_wait: "stop briefly and let others pass",
      stop: "come to a full stop",
    },
  },
  optionLabelsKo: {
    go_straight: "직진",
    turn_left: "좌회전",
    turn_right: "우회전",
    steer_around: "회피",
    yield_wait: "양보 대기",
    stop: "정지",
  },
  rate: { pcHz: 1, piHz: 1 },
  priority: 3,
  riskLevel: (a) => (a.choice === "stop" ? 3 : a.choice === "yield_wait" || a.choice === "steer_around" ? 1 : 0),
});
