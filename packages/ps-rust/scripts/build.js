#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

const platform = process.platform;
const arch = process.arch;
const binaryName = platform === "win32" ? "ps.exe" : "ps";
const source = join(packageRoot, "target", "release", binaryName);
const destDir = join(packageRoot, "bin", platform, arch);
const dest = join(destDir, binaryName);

function runCargo() {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", ["build", "--release", "--bin", "ps"], {
      cwd: packageRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cargo build exited with code ${code}`));
    });
  });
}

async function main() {
  await runCargo();
  mkdirSync(destDir, { recursive: true });
  copyFileSync(source, dest);
  if (platform !== "win32") {
    chmodSync(dest, 0o755);
  }
  console.log(`placed ${dest}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
