import { ROVER, speedFor } from "../../src/config/rover";
import { defineCriterion } from "./types";

// m/s strings follow the rover profile (maxSpeedMps), e.g. 1.2 -> 0 / 0.3 / 0.7 / 1.2
const ms = (v: number) => (v === 0 ? "0 m/s" : `about ${v} m/s`);

export const targetSpeed = defineCriterion({
  name: "target_speed",
  labelKo: "목표 속도",
  question: {
    type: "choice",
    instructions: "What speed should the robot drive at right now?",
    criteria: {
      stop: ms(speedFor("stop", ROVER)),
      crawl: ms(speedFor("crawl", ROVER)),
      slow: ms(speedFor("slow", ROVER)),
      normal: ms(speedFor("normal", ROVER)),
    },
  },
  optionLabelsKo: {
    stop: "정지",
    crawl: `최저속 ${speedFor("crawl", ROVER)} m/s`,
    slow: `서행 ${speedFor("slow", ROVER)} m/s`,
    normal: `보통 ${speedFor("normal", ROVER)} m/s`,
  },
  rate: { pcHz: 1, piHz: 1 },
  priority: 3,
  riskLevel: (a) => (a.choice === "stop" ? 2 : a.choice === "crawl" ? 1 : 0),
});
