// Structural mirror of @receptron/laya's request/response types (v0.1.2), so the dashboard can use them
// without installing onnxruntime. laya-service passes these straight to Laya.systemOne().

export type QuestionType = "choice" | "score" | "noul";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** ordered levels, index 0 = lowest */
  criteria: string[];
}
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  rl_agent: { act_probability: number };
}
export interface ScoreAnswer {
  type: "score";
  /** expected level (0 .. levels-1) */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
  rl_agent: { act_probability: number };
}
export interface NoulAnswer {
  type: "noul";
  /** P(true) */
  noul: number;
  rl_agent: { act_probability: number };
}
export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;
export type AnswerFor<Q extends Question> = Q extends ChoiceQuestion
  ? ChoiceAnswer
  : Q extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer;
