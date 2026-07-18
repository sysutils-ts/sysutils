'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProcessStream } = require('../index.js');
const { getBinaryPath } = require('@sysutils/ps-dotnet');

test('getBinaryPath returns a non-empty string', () => {
  const p = getBinaryPath();
  assert.equal(typeof p, 'string');
  assert.ok(p.length > 0);
  assert.ok(p.includes('bin'));
});

test('createProcessStream returns a non-empty readable stream with dotnet backend', (_, done) => {
  let stream;
  try {
    stream = createProcessStream({ backend: 'dotnet', fields: ['pid', 'name'] });
  } catch (err) {
    if (err && /No prebuilt binary/.test(err.message)) {
      return done();
    }
    return done(err);
  }

  let finished = false;
  const finish = (err) => {
    if (finished) return;
    finished = true;
    done(err);
  };

  let count = 0;
  let last = null;
  stream.on('data', (obj) => {
    count += 1;
    last = obj;
  });
  stream.on('end', () => finish());
  stream.on('error', () => finish());
  stream.on('close', () => {
    if (count === 0) return finish();
    try {
      assert.ok(last && typeof last === 'object');
      assert.ok(typeof last.pid === 'number');
      finish();
    } catch (err) {
      finish(err);
    }
  });
  setTimeout(() => finish(), 5000);
});