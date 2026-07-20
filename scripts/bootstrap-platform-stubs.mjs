/* eslint-disable no-var */
import fs from "node:fs";
import path from "node:path";

var outDir = path.resolve(process.cwd(), "tmp-platform-stubs");
var version = process.argv[2] || "0.0.0";

var platforms = [
  { platform: "darwin", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "win32", arch: "arm64" },
  { platform: "win32", arch: "x64" },
];

fs.mkdirSync(outDir, { recursive: true });

var workspaces = [];
platforms.forEach(function (entry) {
  var name = "@sysutils/ps-" + entry.platform + "-" + entry.arch;
  workspaces.push("./" + name.replace("@", "").replace("/", "-"));
});

var rootPkg = {
  name: "@sysutils/platform-stubs-root",
  version: "0.0.0",
  "private": true,
  description:
    "Temporary workspace root for bootstrapping @sysutils/ps-* platform packages.",
  workspaces: workspaces,
};

fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify(
    rootPkg,
    function (_key, value) {
      return value;
    },
    2,
  ) + "\n",
  "utf8",
);

platforms.forEach(function (entry) {
  var name = "@sysutils/ps-" + entry.platform + "-" + entry.arch;
  var dir = path.join(outDir, name.replace("@", "").replace("/", "-"));
  fs.mkdirSync(dir, { recursive: true });

  var pkg = {
    name: name,
    version: version,
    description:
      "Stub package for " + name + ". This reserves the package name and marks the supported OS/CPU. The first real release will be published by CI with the native binaries.",
    os: [entry.platform],
    cpu: [entry.arch],
    files: ["README.md"],
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/sysutils-ts/sysutils.git",
      directory: "packages/ps",
    },
  };

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      pkg,
      function (_key, value) {
        return value;
      },
      2,
    ) + "\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(dir, "README.md"),
    "# " +
      name +
      "\n\nStub package that reserves the platform-specific package name for `@sysutils/ps`.\nThe actual native binaries are built and published by CI.\n",
    "utf8",
  );

  console.log("Created " + dir);
});

console.log("\nTo publish all stubs with one command (using npm workspaces):\n");
console.log("  cd tmp-platform-stubs");
console.log("  npm publish --workspaces --access public");
console.log("\nIf you have a granular token with bypass 2FA, set it first:\n");
console.log("  $env:NODE_AUTH_TOKEN = \"npm_...\"   # PowerShell");
console.log("  export NODE_AUTH_TOKEN=npm_...     # bash");
console.log("  cd tmp-platform-stubs && npm publish --workspaces --access public");
console.log("\nOr publish each one individually:\n");
console.log("  for d in tmp-platform-stubs/*; do (cd \"$d\" && npm publish --access public); done");
