'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  console.error(`Test dist directory does not exist: ${distDir}\nRun \`npm run build\` in @sysutils/ps first.`);
  process.exit(1);
}
const files = fs
  .readdirSync(distDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => path.join(distDir, name));

if (files.length === 0) {
  console.error('No compiled test files found in dist/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? (result.signal ? 1 : 0));
