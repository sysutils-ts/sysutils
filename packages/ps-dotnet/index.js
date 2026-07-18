'use strict';

const path = require('node:path');
const binaries = require('./binaries.json');

function getBinaryPath() {
  const key = `${process.platform}-${process.arch}`;
  const rel = binaries[key];
  if (!rel) {
    throw new Error(`No prebuilt binary for ${key}. Supported: ${Object.keys(binaries).join(', ')}`);
  }
  return path.resolve(__dirname, rel);
}

module.exports = { getBinaryPath };