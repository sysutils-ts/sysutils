#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

const TARGETS = [
  { triple: "x86_64-pc-windows-msvc", platform: "win32", arch: "x64", bin: "ps.exe" },
  { triple: "aarch64-pc-windows-msvc", platform: "win32", arch: "arm64", bin: "ps.exe" },
  { triple: "x86_64-unknown-linux-gnu", platform: "linux", arch: "x64", bin: "ps" },
  { triple: "aarch64-unknown-linux-gnu", platform: "linux", arch: "arm64", bin: "ps" },
  { triple: "x86_64-apple-darwin", platform: "darwin", arch: "x64", bin: "ps" },
  { triple: "aarch64-apple-darwin", platform: "darwin", arch: "arm64", bin: "ps" },
];

function buildCmd(target) {
  const tool = process.env.SYSUTILS_RUST_TARGET_TOOL ?? "cargo";
  const subcommand = process.env.SYSUTILS_RUST_TARGET_SUBCOMMAND ?? "zigbuild";
  if (tool === "cargo" && subcommand === "zigbuild") {
    return {
      command: "cargo",
      args: ["zigbuild", "--release", "--bin", "ps", "--target", target.triple],
    };
  }
  return {
    command: tool,
    args: ["build", "--release", "--bin", "ps", "--target", target.triple],
  };
}

function run(target) {
  return new Promise((resolveP, reject) => {
    const { command, args } = buildCmd(target);
    const child = spawn(command, args, { cwd: packageRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveP();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function placeBinary(target) {
  const releaseDir = join(
    packageRoot,
    "target",
    target.triple,
    "release",
  );
  const source = join(releaseDir, target.bin);
  const destDir = join(packageRoot, "bin", target.platform, target.arch);
  const dest = join(destDir, target.bin);

  if (!existsSync(source)) {
    throw new Error(
      `Expected build artifact at ${source}. Build did not produce it.`,
    );
  }
  mkdirSync(destDir, { recursive: true });
  renameSync(source, dest);
  console.log(`placed ${dest}`);
}

async function main() {
  for (const target of TARGETS) {
    console.log(`==> building ${target.triple}`);
    await run(target);
    placeBinary(target);
  }
  console.log("all targets built");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
