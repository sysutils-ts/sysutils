'use strict';

const { spawnSync } = require('node:child_process');

function publishProject(target, projectFile, outDir) {
  const args = [
    'publish',
    projectFile,
    '-c', 'Release',
    '-r', target.rid,
    '-o', outDir,
    '--nologo',
  ];
  const r = spawnSync('dotnet', args, { stdio: 'inherit' }); // NOSONAR: dotnet is the .NET SDK CLI resolved from PATH; args are generated internally
  if (r.status !== 0) {
    console.error(`dotnet publish failed for ${target.rid}`);
    return false;
  }
  return true;
}

function runBuilds(targets, buildFn) {
  const only = process.argv.slice(2);
  const filtered = only.length ? targets.filter((t) => only.includes(t.rid)) : targets;
  let ok = true;
  for (const t of filtered) {
    if (!buildFn(t)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { publishProject, runBuilds };
