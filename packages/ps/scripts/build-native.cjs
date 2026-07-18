#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function getRid(platform, arch) {
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const a = archMap[arch];
  if (!a) return undefined;
  if (platform === 'win32') return `win-${a}`;
  if (platform === 'linux') return `linux-${a}`;
  if (platform === 'darwin') return `osx-${a}`;
  return undefined;
}

function build(kind) {
  const rid = getRid(process.platform, process.arch);
  if (!rid) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    process.exit(1);
  }
  const allScript = path.resolve(__dirname, `build-${kind}-all.cjs`);
  const result = spawnSync(process.execPath, [allScript, rid], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

module.exports = { build };

if (require.main === module) {
  const kind = process.argv[2];
  if (!kind) {
    console.error('Usage: build-native.cjs <cli|nodeapi>');
    process.exit(1);
  }
  build(kind);
}
