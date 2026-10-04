// fp32 vs INT8 accuracy regression on the 200 sample states x 10 criteria (pnpm quant:eval).
// Both run on the CPU EP so only the weights differ. -> docs/quant-eval.md
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Laya } from "@receptron/laya";
import { CRITERIA } from "../../shared/criteria/index";
import type { Answer, Question } from "../../shared/laya-types";
import { REPO_ROOT, loadEnvFile } from "./env";
import { checkBundle } from "./laya";

loadEnvFile();
const AGREE_WARN = 0.95;
const threads = Number(process.env.LAYA_INTRA_THREADS) || 8;
const SAMPLE = JSON.parse(readFileSync(path.join(REPO_ROOT, "shared", "sample-states.json"), "utf8")) as {
  states: { t: number; state: unknown }[];
};

async function runAll(dir: string): Promise<{ answers: Answer[][]; ms: number }> {
  checkBundle(dir);
  const laya = await Laya.load({ modelDir: dir, executionProviders: ["cpu"], sessionOptions: { intraOpNumThreads: threads } });
  const t0 = performance.now();
  const answers: Answer[][] = [];
  for (const [i, s] of SAMPLE.states.entries()) {
    const row: Answer[] = [];
    for (const c of CRITERIA) {
      const r = await laya.systemOne(s.state, { [c.name]: c.question as Question });
      row.push(r.answers[c.name] as Answer);
    }
    answers.push(row);
    if (i % 20 === 0) process.stdout.write(`\r  ${path.basename(dir)} ${i}/${SAMPLE.states.length}`);
  }
  const ms = performance.now() - t0;
  await laya.close();
  process.stdout.write(`\r  ${path.basename(dir)} done in ${(ms / 1000).toFixed(0)} s\n`);
  return { answers, ms };
}

const fp32Dir = path.join(REPO_ROOT, "models", "laya");
const int8Dir = path.join(REPO_ROOT, "models", "laya-int8");
const fp = await runAll(fp32Dir);
const q8 = await runAll(int8Dir);

const rows: string[] = [];
let choiceAgree = 0;
let choiceTotal = 0;
const warnings: string[] = [];
for (const [ci, c] of CRITERIA.entries()) {
  const a = fp.answers.map((r) => r[ci]);
  const b = q8.answers.map((r) => r[ci]);
  if (c.question.type === "choice") {
    const agree = a.filter((x, i) => x.type === "choice" && b[i].type === "choice" && x.choice === b[i].choice).length;
    choiceAgree += agree;
    choiceTotal += a.length;
    const rate = agree / a.length;
    if (rate < AGREE_WARN) warnings.push(`${c.name} choice 일치율 ${(rate * 100).toFixed(1)}%`);
    rows.push(`| ${c.name} | choice | 일치율 **${(rate * 100).toFixed(1)}%** | |`);
  } else if (c.question.type === "score") {
    const err = a.map((x, i) => Math.abs((x as { score: number }).score - (b[i] as { score: number }).score));
    rows.push(`| ${c.name} | score | 절대오차 평균 ${mean(err).toFixed(4)} | 최대 ${Math.max(...err).toFixed(4)} |`);
  } else {
    const err = a.map((x, i) => Math.abs((x as { noul: number }).noul - (b[i] as { noul: number }).noul));
    rows.push(`| ${c.name} | noul | 절대오차 평균 ${mean(err).toFixed(4)} | 최대 ${Math.max(...err).toFixed(4)} |`);
  }
}
function mean(xs: number[]) {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
const overall = choiceAgree / choiceTotal;
if (overall < AGREE_WARN) warnings.unshift(`전체 choice 일치율 ${(overall * 100).toFixed(1)}% < 95%`);
const quant = JSON.parse(readFileSync(path.join(int8Dir, "quantization.json"), "utf8"));

const md = `# Laya INT8 양자화 정확도 회귀 검사

측정일: ${new Date().toISOString().slice(0, 10)} · 호스트: ${os.platform()}-${os.arch()} ${os.cpus()[0]?.model.trim()} · CPU EP ${threads}스레드

- fp32: \`models/laya\` (1.7 GB) / INT8: \`models/laya-int8\` (${quant.size_mb} MB, ${quant.method}, ${quant.weight_type}, per-channel=${quant.per_channel}, ${quant.op_types.join("/")})
- 입력: \`shared/sample-states.json\` state ${SAMPLE.states.length}개 x 기준 ${CRITERIA.length}개 = ${SAMPLE.states.length * CRITERIA.length}회 호출씩 (기준마다 개별 \`systemOne\`)
- 소요: fp32 ${(fp.ms / 1000).toFixed(0)} s, INT8 ${(q8.ms / 1000).toFixed(0)} s (호출당 평균 ${(fp.ms / (SAMPLE.states.length * CRITERIA.length)).toFixed(0)} / ${(q8.ms / (SAMPLE.states.length * CRITERIA.length)).toFixed(0)} ms)

## 결과

**전체 choice 일치율: ${(overall * 100).toFixed(1)}%** (${choiceAgree}/${choiceTotal})

| 기준 | 유형 | 지표 | |
| --- | --- | --- | --- |
${rows.join("\n")}

${warnings.length ? `## ⚠ 경고\n\n${warnings.map((w) => `- ${w} (기준 95%)`).join("\n")}\n` : "경고 없음: 모든 choice 기준이 95% 이상 일치.\n"}
`;
writeFileSync(path.join(REPO_ROOT, "docs", "quant-eval.md"), md);
console.log(`wrote docs/quant-eval.md (choice agreement ${(overall * 100).toFixed(1)}%)`);
if (warnings.length) console.warn("WARNING: " + warnings.join("; "));
