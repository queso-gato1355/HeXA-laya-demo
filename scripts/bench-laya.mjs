#!/usr/bin/env node
// pnpm bench:laya [--pi | --pi-proxy] [...] -> runs laya-service/src/bench.ts (needs laya-service deps).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// run tsx's CLI with this node binary: no shell, so paths with spaces / non-ASCII survive on Windows
const tsxCli = path.join(root, "laya-service", "node_modules", "tsx", "dist", "cli.mjs");
const r = spawnSync(process.execPath, [tsxCli, path.join(root, "laya-service", "src", "bench.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: path.join(root, "laya-service"),
});
process.exit(r.status ?? 1);
