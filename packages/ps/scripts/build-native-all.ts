#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  publishProject,
  RIDS,
  runBuilds,
  type Target,
} from "./build-native-all-base.ts";

type AllowedKind = "cli" | "nodeapi";

interface Config {
  projectFile: string;
  outDir: (target: Target) => string;
  bin: (target: Target) => string;
  postBuild: (target: Target, outDir: string) => void;
}

const projectRoot = path.resolve(import.meta.dirname, "..");

const CONFIGS: Record<AllowedKind, Config> = {
  cli: {
    projectFile: path.join(projectRoot, "native", "cli", "SysUtils.Ps.csproj"),
    outDir: (target) => path.join(projectRoot, "bin", "publish", target.rid),
    bin: (target) => (target.platform === "win32" ? "ps.exe" : "ps"),
    postBuild: (target, outDir) => {
      const destDir = path.join(
        projectRoot,
        "bin",
        target.platform,
        target.arch,
      );
      fs.mkdirSync(destDir, { recursive: true });
      const src = path.join(outDir, target.bin!);
      const dest = path.join(destDir, target.bin!);
      fs.copyFileSync(src, dest);
      try {
        fs.chmodSync(dest, 0o750);
      } catch {}
      console.log(`  -> ${path.relative(projectRoot, dest)}`);
    },
  },
  nodeapi: {
    projectFile: path.join(
      projectRoot,
      "native",
      "nodeapi",
      "SysUtils.Ps.NodeApi.csproj",
    ),
    outDir: (target) => path.join(projectRoot, "bin", "nodeapi", target.rid),
    bin: () => "ps-nodeapi.dll",
    postBuild: (target) => {
      console.log(`  -> bin/nodeapi/${target.rid}/${target.bin}`);
    },
  },
};

function isAllowedKind(value: string): value is AllowedKind {
  return value === "cli" || value === "nodeapi";
}

function buildTargets(kind: AllowedKind, argv: string[]): boolean {
  const cfg = CONFIGS[kind];

  const targets = RIDS.map((t) => ({ ...t, bin: cfg.bin(t) }));
  return runBuilds(
    targets,
    (target) => {
      const outDir = cfg.outDir(target);
      if (!publishProject(target, cfg.projectFile, outDir)) return false;
      cfg.postBuild(target, outDir);
      return true;
    },
    argv,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  let kinds: AllowedKind[];
  let argv: string[];
  if (args.length === 0) {
    kinds = ["cli", "nodeapi"];
    argv = [];
  } else if (isAllowedKind(args[0])) {
    kinds = [args[0]];
    argv = args.slice(1);
  } else if (args[0] === "all") {
    kinds = ["cli", "nodeapi"];
    argv = args.slice(1);
  } else {
    console.error(`Usage: build-native-all.ts [cli|nodeapi|all] [rid ...]`);
    process.exit(1);
  }

  let ok = true;
  for (const kind of kinds) {
    if (!buildTargets(kind, argv)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

export { buildTargets, RIDS };

if (import.meta.main) {
  main();
}
