'use strict';

const path = require('node:path');
const { publishProject, runBuilds } = require('./build-native-all-base.cjs');

const RIDS = [
  { rid: 'win-x64', platform: 'win32', arch: 'x64', bin: 'ps-nodeapi.dll' },
  { rid: 'win-arm64', platform: 'win32', arch: 'arm64', bin: 'ps-nodeapi.dll' },
  { rid: 'linux-x64', platform: 'linux', arch: 'x64', bin: 'ps-nodeapi.dll' },
  { rid: 'linux-arm64', platform: 'linux', arch: 'arm64', bin: 'ps-nodeapi.dll' },
  { rid: 'osx-x64', platform: 'darwin', arch: 'x64', bin: 'ps-nodeapi.dll' },
  { rid: 'osx-arm64', platform: 'darwin', arch: 'arm64', bin: 'ps-nodeapi.dll' },
];

const projectRoot = path.resolve(__dirname, '..');
const projectFile = path.join(projectRoot, 'native', 'nodeapi', 'SysUtils.Ps.NodeApi.csproj');

function build(target) {
  const outDir = path.join(projectRoot, 'bin', 'nodeapi', target.rid);
  if (!publishProject(target, projectFile, outDir)) return false;
  console.log(`  -> bin/nodeapi/${target.rid}/${target.bin}`);
  return true;
}

runBuilds(RIDS, build);
