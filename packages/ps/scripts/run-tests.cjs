'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
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

process.exit(result.status ?? (result.signal ? 1 : 0));
