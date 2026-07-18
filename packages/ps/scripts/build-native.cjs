#!/usr/bin/env node
'use strict';

const { RIDS, buildTargets } = require('./build-native-all.cjs');

const ALLOWED_KINDS = new Set(['cli', 'nodeapi']);
const ALLOWED_RIDS = new Set(RIDS.map((t) => t.rid));

function getRid(platform, arch) {
  const match = RIDS.find((t) => t.platform === platform && t.arch === arch);
  return match?.rid;
}

function build(kind) {
  if (!ALLOWED_KINDS.has(kind)) {
    console.error(`Invalid kind: ${kind}. Allowed: ${Array.from(ALLOWED_KINDS).join(', ')}`);
    process.exit(1);
  }
  const rid = getRid(process.platform, process.arch);
  if (!rid || !ALLOWED_RIDS.has(rid)) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    process.exit(1);
  }
  process.exit(buildTargets(kind, [rid]) ? 0 : 1);
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
