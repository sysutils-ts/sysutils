"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const RIDS = [
  { rid: "win-x64", platform: "win32", arch: "x64", bin: "ps-nodeapi.dll" },
  { rid: "win-arm64", platform: "win32", arch: "arm64", bin: "ps-nodeapi.dll" },
  { rid: "linux-x64", platform: "linux", arch: "x64", bin: "ps-nodeapi.dll" },
  {
    rid: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    bin: "ps-nodeapi.dll",
  },
  { rid: "osx-x64", platform: "darwin", arch: "x64", bin: "ps-nodeapi.dll" },
  {
    rid: "osx-arm64",
    platform: "darwin",
    arch: "arm64",
    bin: "ps-nodeapi.dll",
  },
];

const projectFile = path.resolve(__dirname, "..", "native", "nodeapi", "SysUtils.Ps.NodeApi.csproj");

function build(target) {
  console.log(`Building ${target.rid} ...`);
  const args = [
    "publish",
    projectFile,
    "-c",
    "Release",
    "-r",
    target.rid,
    "--nologo",
  ];
  const r = spawnSync("dotnet", args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`dotnet publish failed for ${target.rid}`);
    return false;
  }
  console.log(`  -> bin/nodeapi/${target.rid}/${target.bin}`);
  return true;
}

function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? RIDS.filter((t) => only.includes(t.rid)) : RIDS;
  let ok = true;
  for (const t of targets) {
    if (!build(t)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

main();
