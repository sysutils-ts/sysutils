#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { RIDS, type Target } from "./build-native-all-base.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");

function packageName(target: Target): string {
  return `@sysutils/ps-${target.platform}-${target.arch}`;
}

function cliFileName(target: Target): string {
  return target.platform === "win32" ? "ps.exe" : "ps";
}

function ensureEmptyDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function writePackageJson(
  target: Target,
  packageDir: string,
  version: string,
): void {
  const pkg = {
    name: packageName(target),
    version,
    description: `Native @sysutils/ps binaries for ${target.platform}-${target.arch}`,
    type: "module",
    os: [target.platform],
    cpu: [target.arch],
    files: ["bin"],
    repository: {
      type: "git",
      url: "https://github.com/sysutils-ts/sysutils.git",
      directory: "packages/ps",
    },
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    keywords: [
      "sysutils",
      "ps",
      "process",
      "process-list",
      "native",
      "binary",
      target.platform,
      target.arch,
    ],
  };
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
    "utf8",
  );
}

function writeReadme(target: Target, packageDir: string): void {
  const text = `# ${packageName(target)}\n\nNative binaries for @sysutils/ps on ${target.platform} ${target.arch}.\n`;
  fs.writeFileSync(path.join(packageDir, "README.md"), text, "utf8");
}

function buildOne(target: Target, version: string): string {
  const packageDir = path.join(
    projectRoot,
    "dist-platforms",
    `${target.platform}-${target.arch}`,
  );
  ensureEmptyDir(packageDir);

  // CLI binary
  const cliSrc = path.join(
    projectRoot,
    "bin",
    target.platform,
    target.arch,
    cliFileName(target),
  );
  const cliDestDir = path.join(packageDir, "bin");
  fs.mkdirSync(cliDestDir, { recursive: true });
  if (!fs.existsSync(cliSrc)) {
    throw new Error(`CLI binary not found for ${target.rid}: ${cliSrc}`);
  }
  const cliDest = path.join(cliDestDir, cliFileName(target));
  fs.copyFileSync(cliSrc, cliDest);
  if (target.platform !== "win32") {
    try {
      // nosemgrep
      fs.chmodSync(cliDest, 0o755); // NOSONAR S2612: published CLI binary must be world-executable for global npm installs
    } catch {}
  }

  // Node-API assembly and its dependencies
  const nodeapiSrcDir = path.join(projectRoot, "bin", "nodeapi", target.rid);
  const nodeapiDestDir = path.join(packageDir, "bin", "nodeapi");
  if (fs.existsSync(nodeapiSrcDir)) {
    fs.mkdirSync(nodeapiDestDir, { recursive: true });
    fs.cpSync(nodeapiSrcDir, nodeapiDestDir, { recursive: true });
  }

  writePackageJson(target, packageDir, version);
  writeReadme(target, packageDir);

  return packageDir;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: build-platform-packages.ts <version> [rid ...]");
    process.exit(1);
  }
  const version = args[0];
  const only = args.slice(1);
  const targets = only.length
    ? RIDS.filter((t) => only.includes(t.rid))
    : RIDS;

  const unknown = only.filter((r) => !RIDS.some((t) => t.rid === r));
  if (unknown.length) {
    console.error(`Unknown RIDs: ${unknown.join(", ")}`);
    process.exit(1);
  }

  if (targets.length === 0) {
    console.error("No targets selected.");
    process.exit(1);
  }

  const packages: string[] = [];
  for (const target of targets) {
    const packageDir = buildOne(target, version);
    packages.push(packageDir);
    console.log(`Built ${packageName(target)}@${version} -> ${packageDir}`);
  }

  console.log(`\nBuilt ${packages.length} platform package(s).`);
}

main();
