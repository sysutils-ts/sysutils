#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { publishProject, runBuilds } = require('./build-native-all-base.cjs');

const RIDS = [
  { rid: 'win-x64', platform: 'win32', arch: 'x64' },
  { rid: 'win-arm64', platform: 'win32', arch: 'arm64' },
  { rid: 'linux-x64', platform: 'linux', arch: 'x64' },
  { rid: 'linux-arm64', platform: 'linux', arch: 'arm64' },
  { rid: 'osx-x64', platform: 'darwin', arch: 'x64' },
  { rid: 'osx-arm64', platform: 'darwin', arch: 'arm64' },
];

const projectRoot = path.resolve(__dirname, '..');

const CONFIGS = {
  cli: {
    projectFile: path.join(projectRoot, 'native', 'cli', 'SysUtils.Ps.csproj'),
    outDir: (target) => path.join(projectRoot, 'bin', 'publish', target.rid),
    bin: (target) => target.platform === 'win32' ? 'ps.exe' : 'ps',
    postBuild: (target, outDir) => {
      const destDir = path.join(projectRoot, 'bin', target.platform, target.arch);
      fs.mkdirSync(destDir, { recursive: true });
      const src = path.join(outDir, target.bin);
      const dest = path.join(destDir, target.bin);
      fs.copyFileSync(src, dest);
      try { fs.chmodSync(dest, 0o755); } catch {} // NOSONAR: native binary must be executable
      console.log(`  -> ${path.relative(projectRoot, dest)}`);
    },
  },
  nodeapi: {
    projectFile: path.join(projectRoot, 'native', 'nodeapi', 'SysUtils.Ps.NodeApi.csproj'),
    outDir: (target) => path.join(projectRoot, 'bin', 'nodeapi', target.rid),
    bin: () => 'ps-nodeapi.dll',
    postBuild: (target) => {
      console.log(`  -> bin/nodeapi/${target.rid}/${target.bin}`);
    },
  },
};

function buildTargets(kind, argv) {
  const cfg = CONFIGS[kind];
  if (!cfg) {
    console.error(`Invalid kind: ${kind}. Allowed: ${Object.keys(CONFIGS).join(', ')}`);
    process.exit(1);
  }

  const targets = RIDS.map((t) => ({ ...t, bin: cfg.bin(t) }));
  return runBuilds(targets, (target) => {
    const outDir = cfg.outDir(target);
    if (!publishProject(target, cfg.projectFile, outDir)) return false;
    cfg.postBuild(target, outDir);
    return true;
  }, argv);
}

function main() {
  const args = process.argv.slice(2);
  let kinds;
  let argv = args;
  if (args.length === 0) {
    kinds = ['cli', 'nodeapi'];
    argv = [];
  } else if (CONFIGS[args[0]]) {
    kinds = [args[0]];
    argv = args.slice(1);
  } else if (args[0] === 'all') {
    kinds = ['cli', 'nodeapi'];
    argv = args.slice(1);
  } else {
    console.error(`Usage: build-native-all.cjs [cli|nodeapi|all] [rid ...]`);
    process.exit(1);
  }

  let ok = true;
  for (const kind of kinds) {
    if (!buildTargets(kind, argv)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { buildTargets, RIDS };

if (require.main === module) {
  main();
}
