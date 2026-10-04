#!/usr/bin/env node
// Download every model this demo uses into ./models, once. Nothing downloads at runtime.
//   pnpm fetch-models [--only laya,scdepthv3,yolo,da2]
//
// models/laya/                 Laya ONNX bundle (receptron/laya-onnx, pinned revision, ~1.7 GB)
// models/scdepthv3/            SCDepthV3 ONNX from the Hailo Model Zoo (256x320, Hailo-8 HEF exists)
// models/yolo11n.pt            Ultralytics YOLO11n weights (AGPL-3.0)
// models/depth-anything-v2-small/  Depth Anything V2 Small (comparison mode only, not deployable)
//
// Existing files with the expected size are skipped. Downloads go to <file>.part and are renamed.

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "models");

const LAYA_REPO = "receptron/laya-onnx";
const LAYA_REVISION = "68f27dfe5a27a54fb2b1fefc432f43f972e90868"; // 2026-09-19
const LAYA_FILES = ["laya.onnx", "laya.onnx.data", "laya_config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"];
const DA2_REPO = "depth-anything/Depth-Anything-V2-Small-hf";
const DA2_FILES = ["config.json", "model.safetensors", "preprocessor_config.json"];

const hf = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;

const jobs = {
  laya: LAYA_FILES.map((f) => ({ url: hf(LAYA_REPO, LAYA_REVISION, f), dest: path.join(MODELS, "laya", f) })),
  scdepthv3: [
    {
      url: "https://hailo-model-zoo.s3.eu-west-2.amazonaws.com/DepthEstimation/indoor/scdepthv3/pretrained/2023-07-20/scdepthv3.zip",
      dest: path.join(MODELS, "scdepthv3", "scdepthv3.zip"),
      unzip: "scdepthv3.onnx",
    },
  ],
  yolo: [{ url: "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt", dest: path.join(MODELS, "yolo11n.pt") }],
  da2: DA2_FILES.map((f) => ({ url: hf(DA2_REPO, "main", f), dest: path.join(MODELS, "depth-anything-v2-small", f) })),
};

const size = async (p) => (await stat(p).catch(() => null))?.size ?? null;
const mb = (n) => (n / 1e6).toFixed(1);

async function remoteSize(url) {
  const r = await fetch(url, { method: "HEAD", redirect: "follow" }).catch(() => null);
  if (!r?.ok) return null;
  const n = Number(r.headers.get("x-linked-size") ?? r.headers.get("content-length"));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function download({ url, dest }) {
  const local = await size(dest);
  if (local !== null) {
    const remote = await remoteSize(url);
    if (remote === null || remote === local) {
      console.log(`skip  ${path.relative(ROOT, dest)} (${mb(local)} MB)`);
      return;
    }
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length")) || null;
  const tmp = `${dest}.part`;
  let got = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => {
    got += c.length;
    const now = Date.now();
    if (now - last > 500) {
      last = now;
      const pct = total ? ` ${((got / total) * 100).toFixed(1)}%` : "";
      process.stdout.write(`\r  get ${path.relative(ROOT, dest)} ${mb(got)}${total ? "/" + mb(total) : ""} MB${pct}   `);
    }
  });
  try {
    await pipeline(body, createWriteStream(tmp));
    await rename(tmp, dest);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  process.stdout.write(`\r  done ${path.relative(ROOT, dest)} ${mb(got)} MB${" ".repeat(20)}\n`);
}

function unzipOne(zip, member) {
  const out = path.join(path.dirname(zip), member);
  // tar on Windows 10+ (bsdtar) and Linux/macOS (with unzip fallback) both read zip files
  try {
    execFileSync("tar", ["-xf", zip, "-C", path.dirname(zip), member], { stdio: "inherit" });
  } catch {
    execFileSync("unzip", ["-o", zip, member, "-d", path.dirname(zip)], { stdio: "inherit" });
  }
  return out;
}

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i > 0 ? new Set(process.argv[i + 1].split(",")) : null;
})();

for (const [name, list] of Object.entries(jobs)) {
  if (only && !only.has(name)) continue;
  console.log(`== ${name}`);
  for (const job of list) {
    await download(job);
    if (job.unzip && (await size(path.join(path.dirname(job.dest), job.unzip))) === null) {
      unzipOne(job.dest, job.unzip);
    }
  }
}
console.log("models ready in ./models");
