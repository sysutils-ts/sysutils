#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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

const runsArg = Number.parseInt(
  getArg("--runs") ?? process.env.SYSUTILS_PS_BENCHMARK_RUNS ?? "50",
  10,
);
const warmupArg = Number.parseInt(
  getArg("--warmup") ?? process.env.SYSUTILS_PS_BENCHMARK_WARMUP ?? "3",
  10,
);
const fieldsArg = getArg("--fields") ?? "pid,ppid,name";
const summaryFile = getArg("--summary") ?? process.env.GITHUB_STEP_SUMMARY;
const svgFile = getArg("--svg") ?? process.env.SYSUTILS_PS_BENCHMARK_SVG;
const compare =
  hasArg("--compare") || process.env.SYSUTILS_PS_BENCHMARK_COMPARE === "1";

if (!Number.isFinite(runsArg) || !Number.isInteger(runsArg) || runsArg <= 0) {
  console.error(
    `Invalid --runs value: must be a positive integer (got ${getArg("--runs") ?? process.env.SYSUTILS_PS_BENCHMARK_RUNS ?? "50"}).`,
  );
  process.exit(1);
}

if (
  !Number.isFinite(warmupArg) ||
  !Number.isInteger(warmupArg) ||
  warmupArg < 0
) {
  console.error(
    `Invalid --warmup value: must be a non-negative integer (got ${getArg("--warmup") ?? process.env.SYSUTILS_PS_BENCHMARK_WARMUP ?? "3"}).`,
  );
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function parseFields(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    max: sorted[sorted.length - 1],
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

function buildMeta(fields: string[]): Meta {
  return {
    node: process.version,
    rid: `${process.platform}-${process.arch}`,
    fields,
    runs: runsArg,
    warmup: warmupArg,
    date: new Date().toISOString(),
  };
}

function tryPushBackend(
  backends: Backend[],
  id: string,
  name: string,
  getBinaryPath: PsModule["getBinaryPath"],
  fn: () => Promise<unknown>,
): void {
  if (getBinaryPath(id)) {
    backends.push({ name, id, fn });
  }
}

async function resolveBackends(
  listProcesses: PsModule["listProcesses"],
  getBinaryPath: PsModule["getBinaryPath"],
  fields: string[],
): Promise<Backend[]> {
  const backends: Backend[] = [];

  tryPushBackend(
    backends,
    "dotnet",
    "@sysutils/ps CLI",
    getBinaryPath,
    () => listProcesses({ backend: "dotnet", fields }),
  );

  tryPushBackend(
    backends,
    "dotnet-nodeapi",
    "@sysutils/ps in-process",
    getBinaryPath,
    () => listProcesses({ backend: "dotnet-nodeapi", fields }),
  );

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
      name: "ps-list (all fields)",
      id: "ps-list",
      fn: psList as () => Promise<unknown>,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`ps-list comparison unavailable: ${message}`);
    if (hasArg("--compare")) {
      const err = e instanceof Error ? e : new Error(String(e));
      backends.push({
        name: "ps-list (all fields)",
        id: "ps-list",
        fn: () => {
          throw err;
        },
      });
    }
  }
}

async function runBenchmarks(
  backends: Backend[],
  runs: number,
  warmup: number,
): Promise<Result[]> {
  const results: Result[] = [];
  for (const backend of backends) {
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
  const backends = await resolveBackends(listProcesses, getBinaryPath, fields);

  if (backends.length === 0) {
    console.error(
      "No backends available to benchmark. Run `npm run build:cli` and/or `npm run build:nodeapi` first.",
    );
    process.exit(1);
  }

  const results = await runBenchmarks(backends, runsArg, warmupArg);
  const meta = buildMeta(fields);
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

  return `
<h2>@sysutils/ps benchmark — ${escapeHtml(meta.rid)}</h2>
<p>
  <strong>Node.js:</strong> ${escapeHtml(meta.node)}<br>
  <strong>Fields:</strong> ${escapeHtml(meta.fields.join(","))}<br>
  <strong>Iterations:</strong> ${meta.runs}<br>
  <strong>Warmup:</strong> ${meta.warmup}<br>
  <strong>Date:</strong> ${escapeHtml(meta.date)}
</p>
<p>
  Comparing <code>@sysutils/ps</code> with <code>ps-list</code>, the package it
  is intended to replace. <code>@sysutils/ps</code> uses native AOT binaries
  (<code>ps</code> on Unix, <code>ps.exe</code> on Windows) and an optional
  in-process <code>node-api-dotnet</code> backend when available, so no external
  <code>ps</code> or <code>tasklist</code> commands are spawned.
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

interface SvgHeader {
  x: number;
  label: string;
  align: "start" | "end";
}

function renderSvg(meta: Meta, results: Result[]): string {
  const width = 720;
  const rowHeight = 26;
  const headerHeight = 86;
  const footerHeight = 28;
  const height = headerHeight + rowHeight * (results.length + 1) + footerHeight;

  const header: SvgHeader[] = [
    { x: 20, label: "Backend", align: "start" },
    { x: 360, label: "Mean", align: "end" },
    { x: 440, label: "P95", align: "end" },
    { x: 520, label: "P99", align: "end" },
    { x: 600, label: "Count", align: "end" },
  ];

  const headerRow = header
    .map(
      (h) =>
        `<text x="${h.x}" y="${headerHeight - 22}" text-anchor="${h.align}" font-size="13" font-weight="600" fill="#6b7280">${escapeXml(h.label)}</text>`,
    )
    .join("");

  const title = `${meta.rid} — ${meta.fields.join(",")} — ${meta.runs} runs`;
  const subtitle = `${meta.node} / ${meta.date.slice(0, 19).replaceAll("T", " ")}`;

  const rows = results
    .map((r, i) => {
      const y = headerHeight + rowHeight * (i + 1);
      const bg = i % 2 === 0 ? "#f9fafb" : "#ffffff";
      const s = r.stats;
      const mean = r.error ? "—" : format(s!.mean);
      const p95 = r.error ? "—" : format(s!.p95);
      const p99 = r.error ? "—" : format(s!.p99);
      const count = r.error ? "—" : String(r.count);
      const errorText = r.error
        ? ` (${escapeXml(truncate(r.error, 40))})`
        : "";
      const name = escapeXml(r.name) + errorText;
      const fill = r.error ? "#dc2626" : "#111827";
      return `<rect x="0" y="${y - rowHeight + 4}" width="${width}" height="${rowHeight}" fill="${bg}" />
<text x="20" y="${y}" text-anchor="start" font-size="13" fill="${fill}">${name}</text>
<text x="360" y="${y}" text-anchor="end" font-size="13" fill="${fill}">${mean}</text>
<text x="440" y="${y}" text-anchor="end" font-size="13" fill="${fill}">${p95}</text>
<text x="520" y="${y}" text-anchor="end" font-size="13" fill="${fill}">${p99}</text>
<text x="600" y="${y}" text-anchor="end" font-size="13" fill="${fill}">${count}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" stroke="#e5e7eb" stroke-width="1" rx="6" />
  <text x="20" y="28" font-size="16" font-weight="700" fill="#111827">@sysutils/ps benchmark</text>
  <text x="20" y="48" font-size="12" fill="#6b7280">${escapeXml(title)}</text>
  ${headerRow}
  <line x1="16" y1="${headerHeight - 8}" x2="${width - 16}" y2="${headerHeight - 8}" stroke="#e5e7eb" stroke-width="1" />
  ${rows}
  <text x="${width - 20}" y="${height - 8}" text-anchor="end" font-size="11" fill="#9ca3af">${escapeXml(subtitle)}</text>
</svg>`;
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
