#!/usr/bin/env node
import { buildTargets, RIDS } from "./build-native-all.ts";

type AllowedKind = "cli" | "nodeapi";

function isAllowedKind(value: string): value is AllowedKind {
  return value === "cli" || value === "nodeapi";
}

function getRid(platform: string, arch: string): string | undefined {
  return RIDS.find((t) => t.platform === platform && t.arch === arch)?.rid;
}

function build(kind: AllowedKind): never {
  const rid = getRid(process.platform, process.arch);
  if (!rid) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    process.exit(1);
  }
  process.exit(buildTargets(kind, [rid]) ? 0 : 1);
}

export { build };

if (import.meta.main) {
  const kind = process.argv[2];
  if (!isAllowedKind(kind)) {
    console.error("Usage: build-native.ts <cli|nodeapi>");
    process.exit(1);
  }
  build(kind);
}
