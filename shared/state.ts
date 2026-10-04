// Laya input state and the /criteria/:name request/response contract, shared by the dashboard
// (builder + proxy) and laya-service (validation). Key order of the schema is the key order Laya sees.
import { z } from "zod";
import type { Answer, QuestionType } from "./laya-types";

export const MANEUVERS = ["straight", "slight_left", "turn_left", "slight_right", "turn_right", "u_turn", "arrived"] as const;
export type Maneuver = (typeof MANEUVERS)[number];

export const ZoneStateSchema = z.enum(["open", "partial", "blocked"]);
export type ZoneState = z.infer<typeof ZoneStateSchema>;
export const PositionSchema = z.enum(["left", "center", "right"]);
export type Position = z.infer<typeof PositionSchema>;

export const StateObjectSchema = z.object({
  type: z.string().max(24),
  position: PositionSchema,
  dist_m: z.number(),
  approaching: z.boolean(),
  conf: z.number(),
});
export type StateObject = z.infer<typeof StateObjectSchema>;

export const LayaStateSchema = z.object({
  robot: z.object({ speed_mps: z.number(), heading_deg: z.number() }),
  route: z.object({
    next_maneuver: z.enum(MANEUVERS),
    dist_to_maneuver_m: z.number(),
    crossing_now: z.boolean(),
    off_route_m: z.number(),
  }),
  gps: z.object({ accuracy_m: z.number() }),
  free_space: z.object({ left: ZoneStateSchema, center: ZoneStateSchema, right: ZoneStateSchema }),
  objects: z.array(StateObjectSchema).max(6),
});
export type LayaState = z.infer<typeof LayaStateSchema>;

export const CriterionRequestSchema = z.object({
  clipId: z.string().min(1).max(64),
  t: z.number().min(0),
  state: LayaStateSchema,
});
export type CriterionRequest = z.infer<typeof CriterionRequestSchema>;

/** Risk colour step: 0 safe/neutral .. 3 danger. null = not a risk criterion. */
export type RiskLevel = 0 | 1 | 2 | 3;

export interface Display {
  /** headline, Korean ("높음", "예 82%", "서행") */
  text: string;
  /** main number: score, P(choice) or P(true) */
  value: number;
  /** probability bars in option order, Korean labels */
  dist: { key: string; label: string; p: number }[];
  level: RiskLevel | null;
}

export interface CriterionResponse {
  criterion: string;
  type: QuestionType;
  /** raw Laya answer */
  answer: Answer;
  display: Display;
  /** service-side wall time for this request (queue wait + inference, + simulated delay in Pi budget mode) */
  latencyMs: number;
  /** inference only */
  computeMs: number;
  queueMs: number;
  inputTokens: number;
  cached: boolean;
  /** execution provider that produced it ("dml", "cuda", "cpu") */
  ep: string;
  /** set by the Next.js proxy in Pi budget mode */
  simulatedDelayMs?: number;
}

export interface LayaStatus {
  state: "loading" | "ready" | "missing" | "error" | "unreachable";
  message?: string;
  ep?: string;
  epRequested?: string[];
  epFallback?: boolean;
  quantized?: boolean;
  modelDir?: string;
  loadMs?: number;
  rssMB?: number;
  rssWarn?: boolean;
  platform?: string;
  /** added by the Next.js proxy */
  endpoint?: string;
  endpointIsLocal?: boolean;
}
