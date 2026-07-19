import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(import.meta.dirname, "..", "dist");
if (!fs.existsSync(distDir)) {
  console.error(
    `Test dist directory does not exist: ${distDir}\nRun \`npm run build\` in @sysutils/ps first.`,
  );
  process.exit(1);
}
const files: string[] = fs
  .readdirSync(distDir)
  .filter((name) => name.endsWith(".test.mjs") || name.endsWith(".test.js"))
  .map((name) => path.join(distDir, name));

if (files.length === 0) {
  console.error("No compiled test files found in dist/");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? (result.signal ? 1 : 0));
