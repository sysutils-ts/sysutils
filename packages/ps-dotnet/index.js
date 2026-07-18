import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const binaries = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "binaries.json"), "utf8"),
);

export function getBinaryPath() {
  const key = `${process.platform}-${process.arch}`;
  const entry = binaries[key];
  if (!entry) {
    throw new Error(`Unsupported platform: ${key}`);
  }
  return join(dirname(fileURLToPath(import.meta.url)), entry);
}

export default { getBinaryPath };
