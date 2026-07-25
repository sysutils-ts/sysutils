#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

interface Stats {
  n: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

interface Meta {
  node: string;
  rid: string;
  fields: string[];
  runs: number;
  warmup: number;
  cold?: number;
  date: string;
}

interface Backend {
  name: string;
  id: string;
  fn: () => Promise<unknown>;
}

interface Result extends Backend {
  stats?: Stats;
  count?: number | string;
  error?: string;
}

interface PsModule {
  listProcesses: (options?: {
    backend?: string;
    fields?: string[];
  }) => Promise<unknown>;
  getBinaryPath: (backend?: string) => string | undefined;
}

const distIndex = path.resolve(import.meta.dirname, "..", "dist", "index.mjs");
if (!fs.existsSync(distIndex)) {
  console.error(
    "Benchmark requires a built package. Run `npm run build -w packages/ps` first.",
  );
  process.exit(1);
}

const MAX_BENCHMARK_ITERATIONS = 100_000;

const KNOWN_FLAGS = new Set([
  "--runs",
  "--warmup",
  "--fields",
  "--summary",
  "--svg",
  "--compare",
  "--cold",
  "--backend",
  "--cold-sample",
]);

const runsArg = parseInteger(
  getArg("--runs") ?? process.env.SYSUTILS_PS_BENCHMARK_RUNS,
  50,
  "--runs",
  1,
);
const warmupArg = parseInteger(
  getArg("--warmup") ?? process.env.SYSUTILS_PS_BENCHMARK_WARMUP,
  3,
  "--warmup",
  0,
);
const fieldsArg = getArg("--fields") ?? "pid,ppid,name";
const summaryFile = resolveCliOutputPath(
  getArg("--summary"),
  process.env.GITHUB_STEP_SUMMARY,
  "--summary",
);
const svgFile = resolveCliOutputPath(
  getArg("--svg"),
  process.env.SYSUTILS_PS_BENCHMARK_SVG,
  "--svg",
);
const compare =
  hasArg("--compare") || process.env.SYSUTILS_PS_BENCHMARK_COMPARE === "1";
const coldArg = parseInteger(
  getArg("--cold") ?? "0",
  0,
  "--cold",
  0,
);

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  const next = process.argv[idx + 1];
  if (
    idx + 1 >= process.argv.length ||
    KNOWN_FLAGS.has(next) ||
    next.startsWith("-")
  ) {
    console.error(`Missing value for ${name}.`);
    process.exit(1);
  }
  return next;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function resolveCliOutputPath(
  raw: string | undefined,
  envValue: string | undefined,
  name: string,
): string | undefined {
  const source = raw ?? envValue;
  if (!source) return undefined;

  // Environment-provided paths (e.g. GITHUB_STEP_SUMMARY) are trusted.
  if (raw === undefined) return source;

  const resolved = path.resolve(process.cwd(), source);
  const cwd = path.resolve(process.cwd());
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    console.error(
      `Invalid ${name}: must be a path inside the current working directory.`,
    );
    process.exit(1);
  }
  return resolved;
}

function parseInteger(
  raw: string | undefined,
  defaultValue: number,
  name: string,
  min: number,
): number {
  const str = (raw ?? String(defaultValue)).trim();
  if (!/^\d+$/.test(str)) {
    console.error(
      `Invalid ${name} value: must be an integer (got "${str}").`,
    );
    process.exit(1);
  }
  const n = Number(str);
  if (!Number.isSafeInteger(n) || n > MAX_BENCHMARK_ITERATIONS) {
    console.error(
      `Invalid ${name} value: must be a safe integer not exceeding ${MAX_BENCHMARK_ITERATIONS} (got "${str}").`,
    );
    process.exit(1);
  }
  if (n < min) {
    console.error(
      `Invalid ${name} value: must be at least ${min} (got ${n}).`,
    );
    process.exit(1);
  }
  return n;
}

function parseFields(raw: string): string[] {
  const rawItems = raw.split(",");
  const fields = rawItems.map((s) => s.trim()).filter(Boolean);
  if (fields.length !== rawItems.length) {
    console.error(
      `Invalid --fields: all entries must be non-empty (got "${raw}").`,
    );
    process.exit(1);
  }
  return fields;
}

function percentile(sorted: number[], p: number): number {
  const idx = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function stats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sorted.length === 0) {
    throw new Error("stats called with empty times array");
  }
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0],
    max: sorted.at(-1)!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

async function runOne(
  fn: () => Promise<unknown>,
  iterations: number,
  warmups: number,
): Promise<{ times: number[]; result: unknown; error: Error | undefined }> {
  const times: number[] = [];
  let result: unknown;
  let error: Error | undefined;

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
      error = e instanceof Error ? e : new Error(String(e));
      break;
    }
  }

  return { times, result, error };
}

function buildMeta(
  fields: string[],
  runs: number,
  warmup: number,
  cold: number,
): Meta {
  return {
    node: process.version,
    rid: `${process.platform}-${process.arch}`,
    fields,
    runs,
    warmup,
    cold: cold || undefined,
    date: new Date().toISOString(),
  };
}

interface BackendDescriptor {
  id: string;
  name: string;
}

const NATIVE_BACKEND_DESCRIPTORS: BackendDescriptor[] = [
  { id: "dotnet", name: "@sysutils/ps CLI" },
  { id: "dotnet-nodeapi", name: "@sysutils/ps in-process" },
];

function resolveBackends(
  listProcesses: PsModule["listProcesses"],
  getBinaryPath: PsModule["getBinaryPath"],
  fields: string[],
): Backend[] {
  const backends: Backend[] = [];
  for (const { id, name } of NATIVE_BACKEND_DESCRIPTORS) {
    if (getBinaryPath(id)) {
      backends.push({
        name,
        id,
        fn: () => listProcesses({ backend: id, fields }),
      });
    }
  }
  return backends;
}

async function resolveAllBackends(
  listProcesses: PsModule["listProcesses"],
  getBinaryPath: PsModule["getBinaryPath"],
  fields: string[],
): Promise<Backend[]> {
  const backends = resolveBackends(listProcesses, getBinaryPath, fields);
  if (compare) {
    await maybeAddPsListBackend(backends);
  }
  return backends;
}

async function maybeAddPsListBackend(backends: Backend[]): Promise<void> {
  try {
    const mod = (await import("ps-list")) as { default?: unknown };
    const psList = mod.default ?? mod;
    if (typeof psList !== "function") {
      throw new TypeError("ps-list did not export a callable function");
    }
    backends.push({
      name: "ps-list (full list, all fields)",
      id: "ps-list",
      fn: psList as () => Promise<unknown>,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`ps-list comparison unavailable: ${message}`);
    if (compare) {
      const err = e instanceof Error ? e : new Error(String(e));
      backends.push({
        name: "ps-list (full list, all fields)",
        id: "ps-list",
        fn: () => {
          throw err;
        },
      });
    }
  }
}

function resolveColdTimeoutMs(): number {
  const configured = Number(process.env.SYSUTILS_PS_COLD_TIMEOUT_MS);
  if (
    Number.isSafeInteger(configured) &&
    configured > 0 &&
    configured <= 2_147_483_647
  ) {
    return configured;
  }
  return 30_000;
}

const COLD_SAMPLE_TIMEOUT_MS = resolveColdTimeoutMs();

async function spawnColdSample(
  backend: Backend,
  fields: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    [
      import.meta.filename,
      "--cold-sample",
      "--backend",
      backend.id,
      "--fields",
      fields.join(","),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stdout = "";
  let stderr = "";

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      stderr += "cold sample timed out\n";
      child.kill("SIGKILL");
      resolve({ code: null, stdout, stderr });
    }, COLD_SAMPLE_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stderr += `${err.message}\n`;
      resolve({ code: null, stdout, stderr });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseColdSampleOutput(line: string): {
  duration: number;
  count: number | null;
} {
  const parsed = JSON.parse(line) as {
    duration?: number;
    count?: number | null;
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  if (typeof parsed.duration !== "number") {
    throw new Error(`Invalid cold sample output: ${line}`);
  }
  return { duration: parsed.duration, count: parsed.count ?? null };
}

async function runOneColdSample(
  backend: Backend,
  fields: string[],
): Promise<{ duration: number; count: number | null }> {
  const { code, stdout, stderr } = await spawnColdSample(backend, fields);
  const line = stdout.trim().split("\n").pop() ?? stdout.trim();

  let message: string | undefined;
  try {
    const parsed = JSON.parse(line) as { error?: string };
    message = parsed.error;
  } catch {
    // Ignore malformed JSON; fall through to stderr/code fallback.
  }

  if (code !== 0) {
    throw new Error(message || stderr.trim() || `cold sample exited with code ${code}`);
  }

  if (message) {
    throw new Error(message);
  }

  return parseColdSampleOutput(line);
}

async function runColdSamples(
  backend: Backend,
  fields: string[],
  samples: number,
): Promise<{ times: number[]; result: unknown; error: Error | undefined }> {
  const times: number[] = [];
  let result: unknown;

  for (let i = 0; i < samples; i++) {
    try {
      const { duration, count } = await runOneColdSample(backend, fields);
      times.push(duration);
      result = Array.from({ length: count ?? 0 });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return { times, result, error };
    }
  }

  return { times, result, error: undefined };
}

async function runColdSample(): Promise<void> {
  const backend = getArg("--backend");
  if (!backend) {
    console.error("Missing --backend for cold sample.");
    process.exit(1);
  }

  const fields = parseFields(getArg("--fields") ?? "");
  await maybeHangForTest();

  const start = performance.now();
  const { result, error } = await runColdBackend(backend, fields);
  const duration = performance.now() - start;

  const output = error
    ? { error: error.message }
    : { duration, count: Array.isArray(result) ? result.length : null };
  process.stdout.write(JSON.stringify(output) + "\n", () => {
    process.exit(error ? 1 : 0);
  });
}

async function maybeHangForTest(): Promise<void> {
  const hangMs = Number(process.env.SYSUTILS_PS_TEST_COLD_HANG_MS) || 0;
  if (hangMs > 0) {
    await sleep(hangMs);
  }
}

type ColdBackendResult =
  | { result: unknown; error?: never }
  | { result?: never; error: Error };

async function runColdBackend(
  backend: string,
  fields: string[],
): Promise<ColdBackendResult> {
  try {
    const result = await (backend === "ps-list"
      ? runColdPsList()
      : runColdNative(backend, fields));
    return { result } as ColdBackendResult;
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

async function runColdNative(backend: string, fields: string[]): Promise<unknown> {
  const ps = (await import(pathToFileURL(distIndex).href)) as PsModule;
  return ps.listProcesses({ backend, fields });
}

async function runColdPsList(): Promise<unknown> {
  const mod = (await import("ps-list")) as { default?: unknown };
  const psList = mod.default ?? mod;
  if (typeof psList !== "function") {
    throw new TypeError("ps-list did not export a callable function");
  }
  return (psList as () => Promise<unknown[]>)();
}

async function runBenchmarks(
  backends: Backend[],
  fields: string[],
  runs: number,
  warmup: number,
): Promise<Result[]> {
  const results: Result[] = [];
  for (const backend of backends) {
    if (coldArg > 0) {
      const sampleLabel = `${coldArg} fresh-process sample${coldArg === 1 ? "" : "s"}`;
      process.stderr.write(
        `Benchmarking ${backend.name} cold start (${sampleLabel})... `,
      );
      const { times, result, error } = await runColdSamples(
        backend,
        fields,
        coldArg,
      );
      if (error) {
        process.stderr.write(`failed: ${error.message}\n`);
        results.push({ ...backend, error: error.message });
        continue;
      }
      process.stderr.write("done\n");
      const s = stats(times);
      results.push({
        ...backend,
        stats: s,
        count: Array.isArray(result) ? result.length : "n/a",
      });
      continue;
    }

    const warmupLabel = `${warmup} warmup${warmup === 1 ? "" : "s"}`;
    process.stderr.write(
      `Benchmarking ${backend.name} (${runs} runs, ${warmupLabel})... `,
    );
    const { times, result, error } = await runOne(backend.fn, runs, warmup);
    if (error) {
      process.stderr.write(`failed: ${error.message}\n`);
      results.push({ ...backend, error: error.message });
      continue;
    }
    process.stderr.write("done\n");
    const s = stats(times);
    results.push({
      ...backend,
      stats: s,
      count: Array.isArray(result) ? result.length : "n/a",
    });
  }
  return results;
}

function warnWriteError(label: string, target: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to write ${label} to ${target}: ${message}`);
}

function writeOutputs(meta: Meta, results: Result[]): void {
  if (summaryFile) {
    try {
      fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
      fs.appendFileSync(summaryFile, renderHtml(meta, results));
    } catch (e) {
      warnWriteError("summary", summaryFile, e);
    }
  }

  if (svgFile) {
    try {
      fs.mkdirSync(path.dirname(svgFile), { recursive: true });
      fs.writeFileSync(svgFile, renderSvg(meta, results), "utf8");
    } catch (e) {
      warnWriteError("SVG", svgFile, e);
    }
  }
}

async function main(): Promise<void> {
  const ps = (await import(pathToFileURL(distIndex).href)) as PsModule;
  const { listProcesses, getBinaryPath } = ps;
  const fields = parseFields(fieldsArg);
  const backends = await resolveAllBackends(listProcesses, getBinaryPath, fields);

  if (backends.length === 0) {
    console.error(
      "No backends available to benchmark. Run `npm run build:cli` and/or `npm run build:nodeapi` first.",
    );
    process.exit(1);
  }

  const runs = coldArg > 0 ? coldArg : runsArg;
  const warmup = coldArg > 0 ? 0 : warmupArg;
  const results = await runBenchmarks(backends, fields, runs, warmup);
  const meta = buildMeta(fields, runs, warmup, coldArg);
  const payload = { meta, results };

  // Native backend failures are real measurement failures; the optional ps-list
  // comparison is allowed to error without failing the whole run.
  const hasNativeError = results.some(
    (r) => r.error && r.id !== "ps-list",
  );
  const exitCode = hasNativeError ? 1 : 0;

  writeOutputs(meta, results);

  // Write JSON to stdout and exit explicitly. Forcing exit avoids the
  // node-api-dotnet shutdown hang that can occur in some Node.js versions.
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n", () => {
    process.exit(exitCode);
  });
}

function renderHtml(meta: Meta, results: Result[]): string {
  const rows = results
    .map((r) => {
      if (r.error) {
        return `<tr><td>${escapeHtml(r.name)}</td><td colspan="6"><em>${escapeHtml(r.error)}</em></td></tr>`;
      }
      const s = r.stats!;
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
    .join("\n");

  const compareNote = compare
    ? `<p>
  Comparing <code>@sysutils/ps</code> with <code>ps-list</code> (full list, all
  fields), the package it is intended to replace.
</p>`
    : "";

  const coldNote =
    meta.cold && meta.cold > 0
      ? " Each sample ran in a fresh Node.js process to capture the true cold-start cost."
      : "";

  const warmupNote =
    meta.warmup > 0
      ? "The numbers above are measured after <code>" +
        escapeHtml(String(meta.warmup)) +
        "</code> warmup runs, so they reflect steady-state performance."
      : "No warmup runs were performed, so the numbers above include the cold-start cost.";

  const note = warmupNote + coldNote;

  return `
<h2>@sysutils/ps benchmark — ${escapeHtml(meta.rid)}</h2>
<p>
  <strong>Node.js:</strong> ${escapeHtml(meta.node)}<br>
  <strong>Fields:</strong> ${escapeHtml(meta.fields.join(","))}<br>
  <strong>Iterations:</strong> ${meta.runs}<br>
  <strong>Warmup:</strong> ${meta.warmup}<br>
  <strong>Date:</strong> ${escapeHtml(meta.date)}
</p>
${compareNote}
<p>
  <code>@sysutils/ps</code> uses native AOT binaries
  (<code>ps</code> on Unix, <code>ps.exe</code> on Windows) and an optional
  in-process <code>node-api-dotnet</code> backend when available, so no external
  <code>ps</code> or <code>tasklist</code> commands are spawned.
</p>
<p>
  <strong>About the in-process backend:</strong> the first call loads the .NET
  runtime and the native addon, which can take 50–150 ms on a cold start. If you
  plan to call <code>listProcesses</code> repeatedly, use
  <code>await preload({ backend: "dotnet-nodeapi" })</code> during startup to
  pay that cost up front. ${note} Choose the backend that matches your workload:
</p>
<ul>
  <li>
    <strong>/proc (Linux):</strong> best for one-off calls on Linux when the
    package is used without spawning; it reads <code>/proc</code> directly and
    avoids both CLI spawn and node-api startup overhead.
  </li>
  <li>
    <strong>CLI:</strong> best for one-off calls on non-Linux systems or when
    the <code>/proc</code> and node-api backends are unavailable.
  </li>
  <li>
    <strong>In-process:</strong> best when you call
    <code>listProcesses</code> repeatedly in the same Node.js process — the
    addon stays loaded and subsequent calls are typically faster than spawning
    a CLI process or running <code>ps-list</code>.
  </li>
  <li>
    <strong>ps-list:</strong> a pure-JS alternative that is convenient for
    small scripts, but it may spawn external commands and always returns all
    fields.
  </li>
</ul>
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

function renderSvg(meta: Meta, results: Result[]): string {
  const width = 800;
  const margin = { top: 80, right: 120, bottom: 48, left: 230 };
  const chartWidth = width - margin.left - margin.right;
  const groupHeight = 70;
  const barHeight = 13;
  const barGap = 5;
  const chartHeight = results.length * groupHeight;
  const height = margin.top + chartHeight + margin.bottom;

  let title: string;
  if (meta.cold && meta.cold > 0) {
    title = `${meta.rid} — cold start — ${meta.fields.join(',')} — ${meta.cold} sample${meta.cold === 1 ? "" : "s"}`;
  } else {
    title = `${meta.rid} — ${meta.fields.join(',')} — ${meta.runs} runs`;
  }
  const subtitle = `${meta.node} / ${meta.date.slice(0, 19).replace('T', ' ')}`;

  const metrics: { key: 'mean' | 'p95' | 'p99'; label: string; color: string }[] = [
    { key: 'mean', label: 'Mean', color: '#2563eb' },
    { key: 'p95', label: 'P95', color: '#60a5fa' },
    { key: 'p99', label: 'P99', color: '#93c5fd' },
  ];

  function formatAxis(value: number): string {
    if (value === 0) return '0';
    return value.toFixed(2).replace(/\.?0+$/, '');
  }

  function niceCeil(value: number): number {
    if (value <= 0) return 1;
    const exp = Math.floor(Math.log10(value));
    const step = 10 ** exp;
    return Math.ceil(value / step) * step;
  }

  const numeric = results.filter((r) => !r.error && r.stats);
  const maxMs = numeric.length
    ? Math.max(...numeric.flatMap((r) => metrics.map((m) => r.stats![m.key])))
    : 1;
  const xMax = niceCeil(maxMs * 1.15);

  function xScale(ms: number): number {
    return margin.left + (ms / xMax) * chartWidth;
  }

  const tickCount = 5;
  const tickStep = xMax / (tickCount - 1);

  // nosemgrep
  let svg = `<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>
  <rect width='${width}' height='${height}' fill='#ffffff' stroke='#e5e7eb' stroke-width='1' rx='8' />
  <text x='20' y='28' font-size='18' font-weight='700' fill='#111827'>@sysutils/ps benchmark</text>
  <text x='20' y='50' font-size='12' fill='#6b7280'>${escapeXml(title)}</text>`;

  const legendItemWidth = 74;
  const legendRight = width - 20;
  const legendY = 40;
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const x = legendRight - (metrics.length - i) * legendItemWidth;
    // nosemgrep
    svg += `
  <rect x='${x}' y='${legendY}' width='12' height='12' fill='${m.color}' rx='2' />
  <text x='${x + 18}' y='${legendY + 10}' font-size='12' fill='#4b5563'>${m.label}</text>`;
  }

  const tickValues = Array.from({ length: tickCount }, (_, i) => {
    const value = i * tickStep;
    return { value, x: xScale(value) };
  });

  for (const { x } of tickValues) {
    // nosemgrep
    svg += `
  <line x1='${x}' y1='${margin.top}' x2='${x}' y2='${margin.top + chartHeight}' stroke='#f3f4f6' stroke-width='1' />`;
  }

  // nosemgrep
  svg += `
  <line x1='${margin.left}' y1='${margin.top}' x2='${margin.left}' y2='${margin.top + chartHeight}' stroke='#d1d5db' stroke-width='1' />
  <line x1='${margin.left}' y1='${margin.top + chartHeight}' x2='${margin.left + chartWidth}' y2='${margin.top + chartHeight}' stroke='#d1d5db' stroke-width='1' />`;

  for (const { value, x } of tickValues) {
    // nosemgrep
    svg += `
  <text x='${x}' y='${margin.top + chartHeight + 18}' text-anchor='middle' font-size='11' fill='#9ca3af'>${formatAxis(value)} ms</text>`;
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const y = margin.top + i * groupHeight;
    const labelY = y + groupHeight / 2 + 4;
    const name = escapeXml(r.name);

    // nosemgrep
    svg += `
  <text x='${margin.left - 12}' y='${labelY}' text-anchor='end' font-size='12' fill='${r.error ? '#dc2626' : '#111827'}'>${name}</text>`;

    if (r.error) {
      // nosemgrep
      svg += `
  <text x='${margin.left + 8}' y='${labelY}' font-size='12' fill='#dc2626'>${escapeXml(truncate(r.error, 50))}</text>`;
      continue;
    }

    const count = r.count ?? 'n/a';
    // nosemgrep
    svg += `
  <text x='${margin.left - 12}' y='${labelY + 14}' text-anchor='end' font-size='10' fill='#9ca3af'>Processes: ${count}</text>`;

    const s = r.stats;
    if (!s) continue;
    const barsTotal = metrics.length * barHeight + (metrics.length - 1) * barGap;
    const barTop = y + (groupHeight - barsTotal) / 2;

    for (let j = 0; j < metrics.length; j++) {
      const m = metrics[j];
      const value = s[m.key];
      const barWidth = (value / xMax) * chartWidth;
      const by = barTop + j * (barHeight + barGap);
      const labelX = margin.left + barWidth + 6;
      // nosemgrep
      svg += `
  <rect x='${margin.left}' y='${by}' width='${barWidth}' height='${barHeight}' fill='${m.color}' rx='3' />
  <text x='${labelX}' y='${by + barHeight - 2}' font-size='11' fill='#374151'>${format(value)}</text>`;
    }
  }

  // nosemgrep
  svg += `
  <text x='${width - 20}' y='${height - 16}' text-anchor='end' font-size='11' fill='#9ca3af'>${escapeXml(subtitle)}</text>
</svg>`;

  return svg;
}

function escapeHtml(s: unknown): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXml(s: unknown): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function format(ms: number): string {
  return Number(ms).toFixed(3);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

try {
  if (hasArg("--cold-sample")) {
    await runColdSample();
  } else {
    await main();
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
