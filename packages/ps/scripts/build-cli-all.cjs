'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { publishProject, runBuilds } = require('./build-native-all-base.cjs');

const RIDS = [
  { rid: 'win-x64', platform: 'win32', arch: 'x64', bin: 'ps.exe' },
  { rid: 'win-arm64', platform: 'win32', arch: 'arm64', bin: 'ps.exe' },
  { rid: 'linux-x64', platform: 'linux', arch: 'x64', bin: 'ps' },
  { rid: 'linux-arm64', platform: 'linux', arch: 'arm64', bin: 'ps' },
  { rid: 'osx-x64', platform: 'darwin', arch: 'x64', bin: 'ps' },
  { rid: 'osx-arm64', platform: 'darwin', arch: 'arm64', bin: 'ps' },
];

const projectRoot = path.resolve(__dirname, '..');
const projectFile = path.join(projectRoot, 'native', 'cli', 'SysUtils.Ps.csproj');

function build(target) {
  const outDir = path.join(projectRoot, 'bin', 'publish', target.rid);
  if (!publishProject(target, projectFile, outDir)) return false;

  const destDir = path.join(projectRoot, 'bin', target.platform, target.arch);
  fs.mkdirSync(destDir, { recursive: true });
  const src = path.join(outDir, target.bin);
  const dest = path.join(destDir, target.bin);
  fs.copyFileSync(src, dest);
  try { fs.chmodSync(dest, 0o755); } catch {} // NOSONAR: native binary must be executable
  console.log(`  -> ${path.relative(projectRoot, dest)}`);
  return true;
}

runBuilds(RIDS, build);
