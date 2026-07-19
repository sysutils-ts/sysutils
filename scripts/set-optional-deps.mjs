import fs from "node:fs";
import path from "node:path";

const psPackageJsonPath = path.resolve(
  process.cwd(),
  "packages/ps/package.json",
);

const version = process.argv[2];
if (!version) {
  console.error("Usage: set-optional-deps.mjs <version>");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(psPackageJsonPath, "utf8"));

pkg.optionalDependencies = pkg.optionalDependencies || {};
const platforms = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["win32", "arm64"],
  ["win32", "x64"],
];
for (const [platform, arch] of platforms) {
  pkg.optionalDependencies[`@sysutils/ps-${platform}-${arch}`] = version;
}

fs.writeFileSync(psPackageJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`Set platform optional dependencies to ${version} in ${psPackageJsonPath}`);
