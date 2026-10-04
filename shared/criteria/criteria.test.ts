import { describe, expect, it } from "vitest";
import { CRITERIA, getCriterion, toDisplay } from "./index";

describe("criteria registry", () => {
  it("has the 10 criteria with one question each and Korean labels", () => {
    expect(CRITERIA.map((c) => c.name)).toEqual([
      "collision_risk",
      "maneuver",
      "target_speed",
      "pedestrian_yield",
      "path_blocked",
      "crossing_safe",
      "emergency_stop",
      "route_adherence",
      "localization_trust",
      "perception_confidence",
    ]);
    for (const c of CRITERIA) {
      expect(c.labelKo).toMatch(/[가-힣]/);
      expect(c.rate.pcHz).toBeGreaterThan(0);
      expect(c.rate.piHz).toBeGreaterThan(0);
    }
    expect(getCriterion("nope")).toBeUndefined();
    expect(getCriterion("toString")).toBeUndefined();
  });

  it("keeps the instruction strings verbatim", () => {
    expect(getCriterion("collision_risk")!.question).toEqual({
      type: "score",
      instructions: "How likely is the delivery robot to collide with something in the next 3 seconds?",
      criteria: ["none", "low", "moderate", "high", "imminent"],
    });
    expect(getCriterion("crossing_safe")!.question.instructions).toBe("Is it safe for the robot to cross the road now?");
  });

  it("target_speed m/s strings come from the rover's max speed", () => {
    expect(getCriterion("target_speed")!.question.criteria).toEqual({
      stop: "0 m/s",
      crawl: "about 0.3 m/s",
      slow: "about 0.7 m/s",
      normal: "about 1.2 m/s",
    });
  });

  it("maps answers to Korean display with risk levels", () => {
    const cr = getCriterion("collision_risk")!;
    const d = toDisplay(cr, {
      type: "score",
      score: 3.2,
      legend: {},
      probabilities: { "0": 0, "1": 0.1, "2": 0.1, "3": 0.3, "4": 0.5 },
      confidence: 0.5,
      rl_agent: { act_probability: 1 },
    });
    expect(d.text).toBe("높음 (3.20)");
    expect(d.level).toBe(3);
    expect(d.dist.map((x) => x.label)).toEqual(["없음", "낮음", "보통", "높음", "임박"]);

    const es = toDisplay(getCriterion("emergency_stop")!, { type: "noul", noul: 0.82, rl_agent: { act_probability: 1 } });
    expect(es.text).toBe("정지 필요 82%");
    expect(es.level).toBe(3);
  });
});
