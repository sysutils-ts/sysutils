'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RIDS = [
  { rid: 'win-x64', platform: 'win32', arch: 'x64', bin: 'ps.exe' },
  { rid: 'win-arm64', platform: 'win32', arch: 'arm64', bin: 'ps.exe' },
  { rid: 'linux-x64', platform: 'linux', arch: 'x64', bin: 'ps' },
  { rid: 'linux-arm64', platform: 'linux', arch: 'arm64', bin: 'ps' },
  { rid: 'osx-x64', platform: 'darwin', arch: 'x64', bin: 'ps' },
  { rid: 'osx-arm64', platform: 'darwin', arch: 'arm64', bin: 'ps' },
];

const projectDir = path.resolve(__dirname, '..');
const publishBase = path.join(projectDir, 'bin');

function build(target) {
  console.log(`Building ${target.rid} ...`);
  const outDir = path.join(publishBase, 'publish', target.rid);
  const args = [
    'publish',
    projectDir,
    '-c', 'Release',
    '-r', target.rid,
    '-o', outDir,
    '-p:PublishSingleFile=true',
    '-p:SelfContained=true',
    '-p:TrimMode=partial',
    '-p:AssemblyName=ps',
    '--nologo',
  ];
  const r = spawnSync('dotnet', args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`dotnet publish failed for ${target.rid}`);
    return false;
  }
  const destDir = path.join(projectDir, 'bin', target.platform, target.arch);
  fs.mkdirSync(destDir, { recursive: true });
  const src = path.join(outDir, target.bin);
  const dest = path.join(destDir, target.bin);
  fs.copyFileSync(src, dest);
  try { fs.chmodSync(dest, 0o755); } catch {}
  console.log(`  -> ${path.relative(projectDir, dest)}`);
  return true;
}

function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? RIDS.filter(t => only.includes(t.rid)) : RIDS;
  let ok = true;
  for (const t of targets) {
    if (!build(t)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

main();