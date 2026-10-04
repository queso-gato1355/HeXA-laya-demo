// Criteria registry. Adding a criterion = one new file + one line here.
import { collisionRisk } from "./collision_risk";
import { crossingSafe } from "./crossing_safe";
import { emergencyStop } from "./emergency_stop";
import { localizationTrust } from "./localization_trust";
import { maneuver } from "./maneuver";
import { pathBlocked } from "./path_blocked";
import { pedestrianYield } from "./pedestrian_yield";
import { perceptionConfidence } from "./perception_confidence";
import { routeAdherence } from "./route_adherence";
import { targetSpeed } from "./target_speed";
import type { CriterionDef } from "./types";

export const CRITERIA = [
  collisionRisk,
  maneuver,
  targetSpeed,
  pedestrianYield,
  pathBlocked,
  crossingSafe,
  emergencyStop,
  routeAdherence,
  localizationTrust,
  perceptionConfidence,
] as unknown as CriterionDef[];

const BY_NAME = new Map(CRITERIA.map((c) => [c.name, c]));

export function getCriterion(name: string): CriterionDef | undefined {
  return BY_NAME.get(name);
}

export { toDisplay } from "./types";
export type { CriterionDef } from "./types";
