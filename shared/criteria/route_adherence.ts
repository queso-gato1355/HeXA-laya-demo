import { defineCriterion } from "./types";

export const routeAdherence = defineCriterion({
  name: "route_adherence",
  labelKo: "경로 유지",
  question: {
    type: "choice",
    instructions: "How should the robot handle its planned route?",
    criteria: {
      follow: "keep following the planned route",
      minor_deviation: "deviate slightly and rejoin the route",
      replan: "the route needs to be replanned",
    },
  },
  optionLabelsKo: { follow: "경로 유지", minor_deviation: "약간 이탈 후 복귀", replan: "경로 재계획" },
  rate: { pcHz: 0.2, piHz: 0.2 },
  priority: 5,
  riskLevel: (a) => (a.choice === "replan" ? 2 : a.choice === "minor_deviation" ? 1 : 0),
});
