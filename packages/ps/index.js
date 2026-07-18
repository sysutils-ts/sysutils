'use strict';

const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const readline = require('node:readline');
const { getBinaryPath } = require('@sysutils/ps-dotnet');

const DEFAULT_FIELDS = ['pid', 'ppid', 'name', 'command', 'memory', 'cpu'];

function createProcessStream(options = {}) {
  const { backend = 'dotnet', fields = DEFAULT_FIELDS } = options;

  if (backend !== 'dotnet') {
    throw new Error(`Unsupported backend: ${backend}`);
  }

  const bin = getBinaryPath();
  const args = [];
  if (fields && fields.length) {
    args.push('--fields', fields.join(','));
  }

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const parser = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  const stream = new Readable({ objectMode: true, read() {} });
  stream.process = child;

  parser.on('line', (line) => {
    if (!line) return;
    try {
      stream.push(JSON.parse(line));
    } catch (err) {
      stream.emit('parseError', err);
    }
  });

  child.stderr.on('data', (chunk) => {
    stream.emit('stderr', chunk);
  });

  child.on('error', (err) => {
    stream.destroy(err);
  });

  child.on('close', (code) => {
    parser.close();
    if (code !== 0) {
      stream.destroy(new Error(`ps exited with code ${code}`));
      return;
    }
    stream.push(null);
  });

  return stream;
}

module.exports = { createProcessStream };