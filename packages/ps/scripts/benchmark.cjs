#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const distIndex = path.resolve(__dirname, '..', 'dist', 'index.mjs');
if (!fs.existsSync(distIndex)) {
  console.error('Benchmark requires a built package. Run `npm run build -w packages/ps` first.');
  process.exit(1);
}

const runsArg = parseInt(getArg('--runs') ?? process.env.SYSUTILS_PS_BENCHMARK_RUNS ?? '50', 10);
const warmupArg = parseInt(getArg('--warmup') ?? process.env.SYSUTILS_PS_BENCHMARK_WARMUP ?? '3', 10);
const fieldsArg = getArg('--fields') ?? 'pid,ppid,name';
const summaryFile = getArg('--summary') ?? process.env.GITHUB_STEP_SUMMARY;
const compare = hasArg('--compare') || process.env.SYSUTILS_PS_BENCHMARK_COMPARE === '1';

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function percentile(sorted, p) {
  const idx = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

async function runOne(fn, iterations, warmups) {
  const times = [];
  let result;
  let error;

  for (let i = 0; i < warmups; i++) {
    try {
      await fn();
    } catch {
      // best-effort warmup; failures are reported in the timed loop
    }
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      result = await fn();
      times.push(performance.now() - start);
    } catch (e) {
      error = e;
      break;
    }
  }

  return { times, result, error };
}

async function main() {
  const { listProcesses, getBinaryPath } = await import(pathToFileURL(distIndex).href);

  const fields = fieldsArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const backends = [];

  if (getBinaryPath('dotnet')) {
    backends.push({
      name: '@sysutils/ps CLI',
      id: 'dotnet',
      fn: () => listProcesses({ backend: 'dotnet', fields }),
    });
  }

  if (getBinaryPath('dotnet-nodeapi')) {
    backends.push({
      name: '@sysutils/ps in-process',
      id: 'dotnet-nodeapi',
      fn: () => listProcesses({ backend: 'dotnet-nodeapi', fields }),
    });
  }

  if (compare) {
    try {
      const mod = await import('ps-list');
      const psList = mod.default ?? mod;
      if (typeof psList !== 'function') {
        throw new Error('ps-list did not export a callable function');
      }
      backends.push({
        name: 'ps-list',
        id: 'ps-list',
        fn: psList,
      });
    } catch (e) {
      console.warn(`ps-list comparison unavailable: ${e.message}`);
      if (hasArg('--compare')) {
        // When explicitly requested, surface the failure as a result row.
        backends.push({
          name: 'ps-list',
          id: 'ps-list',
          fn: () => {
            throw e;
          },
        });
      }
    }
  }

  if (backends.length === 0) {
    console.error(
      'No backends available to benchmark. Run `npm run build:cli` and/or `npm run build:nodeapi` first.',
    );
    process.exit(1);
  }

  const results = [];
  for (const backend of backends) {
    process.stderr.write(`Benchmarking ${backend.name} (${runsArg} runs, ${warmupArg} warmup)... `);
    const { times, result, error } = await runOne(backend.fn, runsArg, warmupArg);
    if (error) {
      process.stderr.write(`failed: ${error.message}\n`);
      results.push({ ...backend, error: error.message });
      continue;
    }
    process.stderr.write(`done\n`);
    const s = stats(times);
    const count = Array.isArray(result) ? result.length : 'n/a';
    results.push({ ...backend, stats: s, count });
  }

  const meta = {
    node: process.version,
    dotnet: tryGetDotnetVersion(),
    rid: `${process.platform}-${process.arch}`,
    fields,
    runs: runsArg,
    warmup: warmupArg,
    date: new Date().toISOString(),
  };

  const payload = { meta, results };
  const html = renderHtml(meta, results);

  if (summaryFile) {
    fs.appendFileSync(summaryFile, html);
  }

  // Write JSON to stdout and exit explicitly. Forcing exit avoids the
  // node-api-dotnet shutdown hang that can occur in some Node.js versions.
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n', () => {
    process.exit(0);
  });
}

function tryGetDotnetVersion() {
  try {
    const { execSync } = require('node:child_process');
    return execSync('dotnet --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function renderHtml(meta, results) {
  const rows = results
    .map((r) => {
      if (r.error) {
        return `<tr><td>${escapeHtml(r.name)}</td><td colspan="6"><em>${escapeHtml(r.error)}</em></td></tr>`;
      }
      const s = r.stats;
      return `<tr>
  <td>${escapeHtml(r.name)}</td>
  <td>${format(s.mean)}</td>
  <td>${format(s.min)}</td>
  <td>${format(s.max)}</td>
  <td>${format(s.p95)}</td>
  <td>${format(s.p99)}</td>
  <td>${r.count}</td>
</tr>`;
    })
    .join('\n');

  return `
<h2>@sysutils/ps benchmark — ${escapeHtml(meta.rid)}</h2>
<p>
  <strong>Node.js:</strong> ${escapeHtml(meta.node)}<br>
  <strong>.NET SDK:</strong> ${escapeHtml(meta.dotnet)}<br>
  <strong>Fields:</strong> ${escapeHtml(meta.fields.join(','))}<br>
  <strong>Iterations:</strong> ${meta.runs}<br>
  <strong>Warmup:</strong> ${meta.warmup}<br>
  <strong>Date:</strong> ${escapeHtml(meta.date)}
</p>
<table>
  <thead>
    <tr>
      <th>Backend</th>
      <th>Mean (ms)</th>
      <th>Min (ms)</th>
      <th>Max (ms)</th>
      <th>P95 (ms)</th>
      <th>P99 (ms)</th>
      <th>Processes</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function format(ms) {
  return Number(ms).toFixed(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
