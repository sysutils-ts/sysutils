import { spawnSync } from "node:child_process";

export interface Target {
  rid: string;
  platform: string;
  arch: string;
  bin?: string;
}

export function publishProject(
  target: Target,
  projectFile: string,
  outDir: string,
): boolean {
  const args = [
    "publish",
    projectFile,
    "-c",
    "Release",
    "-r",
    target.rid,
    "-o",
    outDir,
    "--nologo",
  ];
  const r = spawnSync("dotnet", args, { stdio: "inherit" }); // NOSONAR: dotnet is the .NET SDK CLI resolved from PATH; args are generated internally
  if (r.status !== 0) {
    console.error(`dotnet publish failed for ${target.rid}`);
    return false;
  }
  return true;
}

export const RIDS: Target[] = [
  { rid: "win-x64", platform: "win32", arch: "x64" },
  { rid: "win-arm64", platform: "win32", arch: "arm64" },
  { rid: "linux-x64", platform: "linux", arch: "x64" },
  { rid: "linux-arm64", platform: "linux", arch: "arm64" },
  { rid: "osx-x64", platform: "darwin", arch: "x64" },
  { rid: "osx-arm64", platform: "darwin", arch: "arm64" },
];

export function runBuilds(
  targets: Target[],
  buildFn: (target: Target) => boolean,
  argv: string[] = process.argv.slice(2),
): boolean {
  const only = argv;
  if (only.length) {
    const known = new Set(targets.map((t) => t.rid));
    const unknown = only.filter((a) => !known.has(a));
    if (unknown.length) {
      console.error(`Unknown RIDs: ${unknown.join(", ")}`);
      return false;
    }
  }
  const filtered = only.length
    ? targets.filter((t) => only.includes(t.rid))
    : targets;
  if (filtered.length === 0) {
    console.error("No targets selected.");
    return false;
  }
  let ok = true;
  for (const t of filtered) {
    if (!buildFn(t)) ok = false;
  }
  return ok;
}
